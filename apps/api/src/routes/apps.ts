import { apps, githubInstallations, type Database } from "@liman/db";
import {
  appCursorSchema,
  createAppBodySchema,
  updateAppBodySchema,
  type App,
  type AppPage,
} from "@liman/shared";
import { and, asc, eq, gt, isNull } from "drizzle-orm";
import express, { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Config } from "../config/index.js";
import type { GitHubApp } from "../github/app.js";
import { requireAuth } from "../middleware/session.js";
import type { PipelineQueue } from "../queue.js";
import {
  callGitHub,
  currentUserId,
  ownedInstallation,
  postgresCode,
  postgresConstraint,
  sendError,
  sendValidation,
} from "./helpers.js";

export interface AppRouteDeps {
  config: Config;
  db: Database;
  githubApp: GitHubApp;
  pipeline: PipelineQueue;
}

export const APP_PAGE_SIZE = 50;

type AppRow = typeof apps.$inferSelect;

const appParamsSchema = z.object({ id: z.uuid() });
const listQuerySchema = z.object({ cursor: appCursorSchema.optional() });

/** The app list is ordered by subdomain; the cursor is the last subdomain, base64url. */
const encodeCursor = (subdomain: string) => Buffer.from(subdomain).toString("base64url");
const decodeCursor = (cursor: string) => Buffer.from(cursor, "base64url").toString("utf8");

export function toApiApp(row: AppRow, config: Config): App {
  const protocol = new URL(config.publicUrl).protocol;
  return {
    id: row.id,
    name: row.name,
    subdomain: row.subdomain,
    url: `${protocol}//${row.subdomain}.${config.baseDomain}`,
    installationId: row.installationRef,
    repoId: row.repoId,
    repoFullName: row.repoFullName,
    branch: row.branch,
    port: row.port,
    healthPath: row.healthPath,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Loads `:id` and checks the signed-in user owns it. Answers 400, 404 or 403 and returns
 * null otherwise. Used by the env routes as well.
 */
export async function ownedApp(db: Database, req: Request, res: Response) {
  const params = appParamsSchema.safeParse(req.params);
  if (!params.success) {
    sendValidation(res, "Invalid app ID", params.error);
    return null;
  }
  const [row] = await db.select().from(apps).where(eq(apps.id, params.data.id)).limit(1);
  if (!row) {
    sendError(res, 404, "not_found", "App not found");
    return null;
  }
  if (row.ownerId !== currentUserId(req)) {
    sendError(res, 403, "forbidden", "Not your app");
    return null;
  }
  return row;
}

/**
 * True when `<subdomain>.<baseDomain>` is the panel's own host, e.g. `panel` with
 * `LIMAN_PUBLIC_URL=https://panel.example.com`. The shared reserved list only covers the
 * default `liman`; an app on the panel host would get the panel's origin and cookies.
 */
export function isPanelHost(config: Config, subdomain: string): boolean {
  return `${subdomain}.${config.baseDomain}` === new URL(config.publicUrl).hostname;
}

function sendBranchNotFound(res: Response): void {
  sendError(res, 400, "validation_failed", "Branch not found in the repository", [
    { path: "branch", message: "Branch not found in the repository" },
  ]);
}

export function sendDeleting(res: Response): void {
  sendError(res, 409, "conflict", "App is being deleted");
}

export function appsRouter(deps: AppRouteDeps): Router {
  const { config, db, githubApp, pipeline } = deps;
  const router = Router();

  router.use("/apps", requireAuth, express.json({ limit: "16kb" }));

  router.get("/apps", async (req, res) => {
    const query = listQuerySchema.safeParse(req.query);
    if (!query.success) {
      sendValidation(res, "Invalid cursor", query.error);
      return;
    }
    const after = query.data.cursor ? decodeCursor(query.data.cursor) : undefined;
    const rows = await db
      .select()
      .from(apps)
      .where(
        and(eq(apps.ownerId, currentUserId(req)), after ? gt(apps.subdomain, after) : undefined),
      )
      .orderBy(asc(apps.subdomain))
      .limit(APP_PAGE_SIZE + 1);
    const items = rows.slice(0, APP_PAGE_SIZE);
    const last = items.at(-1);
    const body: AppPage = {
      items: items.map((row) => toApiApp(row, config)),
      nextCursor: rows.length > APP_PAGE_SIZE && last ? encodeCursor(last.subdomain) : null,
    };
    res.json(body);
  });

  router.post("/apps", async (req, res) => {
    const parsed = createAppBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidation(res, "Invalid app", parsed.error);
      return;
    }
    const input = parsed.data;
    if (isPanelHost(config, input.subdomain)) {
      sendError(res, 400, "validation_failed", "Invalid app", [
        { path: "subdomain", message: "This name is reserved" },
      ]);
      return;
    }
    const installation = await ownedInstallation(db, req, res, input.installationId);
    if (!installation) {
      return;
    }
    const { installationId } = installation;

    // The repository must be in the installation's own list: a lookup by ID would also
    // succeed for any public repository (ADR-0002). Only its ID is stored; the name is
    // for display and can change on GitHub.
    const repo = await callGitHub(req, res, async () => ({
      found: await githubApp.findInstalledRepo(installationId, input.repoId),
    }));
    if (!repo) {
      return;
    }
    if (!repo.found) {
      sendError(res, 404, "not_found", "Repository not found in this installation");
      return;
    }
    const repoFullName = repo.found.fullName;
    const branch = await callGitHub(req, res, async () => ({
      found: await githubApp.getBranch(installationId, repoFullName, input.branch),
    }));
    if (!branch) {
      return;
    }
    // GitHub redirects a renamed branch to its new name; only the exact name counts.
    if (branch.found?.name !== input.branch) {
      sendBranchNotFound(res);
      return;
    }

    try {
      const row = await db.transaction(async (tx) => {
        // Holds the installation row until commit, like the foreign key would. A sign-in
        // sync that wants to delete this row waits for us and then sees the new app
        // (installations.ts). If the sync won, the row is gone and we stop here.
        const [locked] = await tx
          .select({ id: githubInstallations.id })
          .from(githubInstallations)
          .where(
            and(
              eq(githubInstallations.id, installation.id),
              eq(githubInstallations.ownerId, currentUserId(req)),
              isNull(githubInstallations.suspendedAt),
            ),
          )
          .for("key share");
        if (!locked) {
          return null;
        }
        const [inserted] = await tx
          .insert(apps)
          .values({
            ownerId: currentUserId(req),
            installationRef: installation.id,
            name: input.name,
            subdomain: input.subdomain,
            repoId: input.repoId,
            repoFullName,
            branch: input.branch,
            port: input.port,
            healthPath: input.healthPath,
          })
          .returning();
        return inserted ?? null;
      });
      if (!row) {
        sendError(res, 404, "not_found", "Installation not found");
        return;
      }
      req.log.info({ appId: row.id, subdomain: row.subdomain }, "app created");
      res.status(201).json(toApiApp(row, config));
    } catch (error) {
      if (
        postgresCode(error) === "23505" &&
        postgresConstraint(error) === "apps_subdomain_unique"
      ) {
        sendError(res, 409, "conflict", "Subdomain is already taken", [
          { path: "subdomain", message: "Subdomain is already taken" },
        ]);
        return;
      }
      throw error;
    }
  });

  router.get("/apps/:id", async (req, res) => {
    const row = await ownedApp(db, req, res);
    if (row) {
      res.json(toApiApp(row, config));
    }
  });

  router.patch("/apps/:id", async (req, res) => {
    const row = await ownedApp(db, req, res);
    if (!row) {
      return;
    }
    const parsed = updateAppBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidation(res, "Invalid update", parsed.error);
      return;
    }
    if (row.status !== "active") {
      sendDeleting(res);
      return;
    }
    const changes = parsed.data;
    if (changes.branch !== undefined && changes.branch !== row.branch) {
      const installation = await ownedInstallation(db, req, res, row.installationRef);
      if (!installation) {
        return;
      }
      const newBranch = changes.branch;
      const branch = await callGitHub(req, res, async () => ({
        found: await githubApp.getBranch(installation.installationId, row.repoFullName, newBranch),
      }));
      if (!branch) {
        return;
      }
      if (branch.found?.name !== newBranch) {
        sendBranchNotFound(res);
        return;
      }
    }
    // Conditional: a DELETE that won the race leaves the app `deleting`, and it stays so.
    const [updated] = await db
      .update(apps)
      .set(changes)
      .where(and(eq(apps.id, row.id), eq(apps.status, "active")))
      .returning();
    if (!updated) {
      sendDeleting(res);
      return;
    }
    res.json(toApiApp(updated, config));
  });

  /**
   * Marks the app `deleting` and queues `cleanup-app` (ROADMAP 1.1); the worker removes
   * containers, routes and rows. Calling it again on a `deleting` app re-queues the job,
   * so an API crash between the commit and the queue write is fixed by retrying.
   */
  router.delete("/apps/:id", async (req, res) => {
    const row = await ownedApp(db, req, res);
    if (!row) {
      return;
    }
    const [updated] = await db
      .update(apps)
      .set({ status: "deleting" })
      .where(and(eq(apps.id, row.id), eq(apps.status, "active")))
      .returning();
    // 0 rows: it was already `deleting` (by us earlier, or a concurrent request).
    const current = updated ?? { ...row, status: "deleting" as const };
    await pipeline.ensureCleanupApp(row.id);
    req.log.info({ appId: row.id, alreadyDeleting: !updated }, "app cleanup queued");
    res.status(202).json(toApiApp(current, config));
  });

  return router;
}
