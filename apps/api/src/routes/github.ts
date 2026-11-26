import { githubInstallations, type Database } from "@liman/db";
import {
  cursorSchema,
  type ApiError,
  type BranchPage,
  type ErrorCode,
  type InstallationList,
  type RepoPage,
} from "@liman/shared";
import { asc, eq } from "drizzle-orm";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Config } from "../config/index.js";
import { GitHubApiError, type GitHubApp, type GitHubPage } from "../github/app.js";
import { requireAuth } from "../middleware/session.js";

export interface GitHubRouteDeps {
  config: Config;
  db: Database;
  githubApp: GitHubApp;
}

const setupQuerySchema = z.object({
  installation_id: z
    .string()
    .regex(/^[1-9][0-9]{0,15}$/)
    .optional(),
  setup_action: z.enum(["install", "update", "request"]).optional(),
});

const installationParamsSchema = z.object({ id: z.uuid() });
const repoParamsSchema = z.object({
  id: z.uuid(),
  repoId: z
    .string()
    .regex(/^[1-9][0-9]{0,15}$/)
    .transform(Number),
});
const pageQuerySchema = z.object({ cursor: cursorSchema.optional() });

function sendError(res: Response, status: number, code: ErrorCode, message: string): void {
  const body: ApiError = { error: { code, message } };
  res.status(status).json(body);
}

/** The signed-in user; only call after `requireAuth`. */
function currentUserId(req: Request): string {
  const id = req.auth?.user.id;
  if (!id) {
    throw new Error("requireAuth let an unauthenticated request through");
  }
  return id;
}

function toCursorPage<T>(page: GitHubPage<T>, current: number) {
  return { items: page.items, nextCursor: page.hasNext ? String(current + 1) : null };
}

export function githubRouter(deps: GitHubRouteDeps): Router {
  const { config, db, githubApp } = deps;
  const router = Router();

  /**
   * GitHub redirects here after the App is installed or its repositories change. The
   * `installation_id` in the query is not proof of anything: anyone can type any ID into
   * this URL. So nothing is stored here. The browser goes through sign-in again, which is
   * instant for a user who already authorized the App, and the callback stores what
   * `GET /user/installations` reports with the user's own token (ADR-0002).
   */
  router.get("/github/setup", (req, res) => {
    const query = setupQuerySchema.safeParse(req.query);
    req.log.info(
      query.success
        ? { installationIdHint: query.data.installation_id, setupAction: query.data.setup_action }
        : {},
      "app setup return",
    );
    res.redirect(302, `${config.publicUrl}/api/auth/github/login`);
  });

  router.use("/github/installations", requireAuth);

  router.get("/github/installations", async (req, res) => {
    const rows = await db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.ownerId, currentUserId(req)))
      .orderBy(asc(githubInstallations.accountLogin), asc(githubInstallations.installationId));
    const body: InstallationList = {
      installations: rows.map((row) => ({
        id: row.id,
        installationId: row.installationId,
        accountLogin: row.accountLogin,
        accountType: row.accountType,
        suspended: row.suspendedAt !== null,
      })),
      installUrl: `https://github.com/apps/${config.github.appSlug}/installations/new`,
    };
    res.json(body);
  });

  /**
   * Loads the installation for `:id` and checks the signed-in user owns it. Answers the
   * request itself and returns null when the caller cannot go on.
   */
  async function ownedInstallation(req: Request, res: Response, id: string) {
    const [row] = await db
      .select()
      .from(githubInstallations)
      .where(eq(githubInstallations.id, id))
      .limit(1);
    if (!row) {
      sendError(res, 404, "not_found", "Installation not found");
      return null;
    }
    if (row.ownerId !== currentUserId(req)) {
      sendError(res, 403, "forbidden", "Not your installation");
      return null;
    }
    if (row.suspendedAt !== null) {
      sendError(res, 409, "conflict", "Installation is suspended on GitHub");
      return null;
    }
    return row;
  }

  /** Runs a GitHub call; GitHub failures become a 404 or 502 answer and null. */
  async function callGitHub<T>(
    req: Request,
    res: Response,
    call: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await call();
    } catch (error) {
      if (!(error instanceof GitHubApiError)) {
        throw error;
      }
      req.log.warn({ reason: error.reason, status: error.status }, "github api call failed");
      if (error.reason === "installation_token_http_404") {
        // Uninstalled on GitHub; the row goes at the next sign-in (webhooks in 1.2).
        sendError(res, 404, "not_found", "Installation no longer exists on GitHub");
      } else {
        sendError(res, 502, "upstream_failed", "GitHub request failed");
      }
      return null;
    }
  }

  function validation(res: Response, message: string): void {
    sendError(res, 400, "validation_failed", message);
  }

  router.get("/github/installations/:id/repos", async (req, res) => {
    const params = installationParamsSchema.safeParse(req.params);
    const query = pageQuerySchema.safeParse(req.query);
    if (!params.success || !query.success) {
      validation(res, "Invalid installation ID or cursor");
      return;
    }
    const installation = await ownedInstallation(req, res, params.data.id);
    if (!installation) {
      return;
    }
    const pageNumber = Number(query.data.cursor ?? "1");
    const page = await callGitHub(req, res, () =>
      githubApp.listRepos(installation.installationId, pageNumber),
    );
    if (page) {
      const body: RepoPage = toCursorPage(page, pageNumber);
      res.json(body);
    }
  });

  router.get("/github/installations/:id/repos/:repoId/branches", async (req, res) => {
    const params = repoParamsSchema.safeParse(req.params);
    const query = pageQuerySchema.safeParse(req.query);
    if (!params.success || !query.success) {
      validation(res, "Invalid installation ID, repository ID or cursor");
      return;
    }
    const installation = await ownedInstallation(req, res, params.data.id);
    if (!installation) {
      return;
    }
    const { installationId } = installation;
    // Looking the repository up with this installation's token is the access check: GitHub
    // answers 404 for a repository the installation cannot see.
    const repo = await callGitHub(req, res, async () => ({
      found: await githubApp.getRepo(installationId, params.data.repoId),
    }));
    if (!repo) {
      return;
    }
    if (!repo.found) {
      sendError(res, 404, "not_found", "Repository not found in this installation");
      return;
    }
    const fullName = repo.found.fullName;
    const pageNumber = Number(query.data.cursor ?? "1");
    const page = await callGitHub(req, res, () =>
      githubApp.listBranches(installationId, fullName, pageNumber),
    );
    if (page) {
      const body: BranchPage = toCursorPage(page, pageNumber);
      res.json(body);
    }
  });

  return router;
}
