import { githubInstallations, type Database } from "@liman/db";
import {
  MAX_CURSOR_PAGE,
  cursorSchema,
  type BranchPage,
  type InstallationList,
  type RepoPage,
} from "@liman/shared";
import { asc, eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import type { Config } from "../config/index.js";
import type { GitHubApp, GitHubPage } from "../github/app.js";
import { requireAuth } from "../middleware/session.js";
import {
  callGitHub,
  currentUserId,
  ownedInstallation,
  sendError,
  sendValidation,
} from "./helpers.js";

export interface GitHubRouteDeps {
  config: Config;
  db: Database;
  githubApp: GitHubApp;
}

const setupQuerySchema = z.object({
  installation_id: z
    .string()
    .regex(/^[1-9][0-9]{0,14}$/)
    .optional(),
  setup_action: z.enum(["install", "update", "request"]).optional(),
});

const installationParamsSchema = z.object({ id: z.uuid() });
const repoParamsSchema = z.object({
  id: z.uuid(),
  // At most 15 digits, so the number stays exact (below Number.MAX_SAFE_INTEGER).
  repoId: z
    .string()
    .regex(/^[1-9][0-9]{0,14}$/)
    .transform(Number),
});
const pageQuerySchema = z.object({ cursor: cursorSchema.optional() });

/** Never hands out a cursor that `cursorSchema` would reject on the next request. */
export function toCursorPage<T>(page: GitHubPage<T>, current: number) {
  const hasNext = page.hasNext && current < MAX_CURSOR_PAGE;
  return { items: page.items, nextCursor: hasNext ? String(current + 1) : null };
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

  router.get("/github/installations/:id/repos", async (req, res) => {
    const params = installationParamsSchema.safeParse(req.params);
    const query = pageQuerySchema.safeParse(req.query);
    if (!params.success || !query.success) {
      sendValidation(res, "Invalid installation ID or cursor");
      return;
    }
    const installation = await ownedInstallation(db, req, res, params.data.id);
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
      sendValidation(res, "Invalid installation ID, repository ID or cursor");
      return;
    }
    const installation = await ownedInstallation(db, req, res, params.data.id);
    if (!installation) {
      return;
    }
    const { installationId } = installation;
    // The access check: the repository must be in the installation's own list. A direct
    // lookup by ID would also succeed for any public repository (ADR-0002).
    const repo = await callGitHub(req, res, async () => ({
      found: await githubApp.findInstalledRepo(installationId, params.data.repoId),
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
