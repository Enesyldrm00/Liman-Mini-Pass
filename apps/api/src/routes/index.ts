import type { Express } from "express";
import { cookieNames } from "../auth/cookies.js";
import { requireSameOrigin } from "../middleware/origin-check.js";
import { loadSession } from "../middleware/session.js";
import { appsRouter, type AppRouteDeps } from "./apps.js";
import { authRouter, type AuthRouteDeps } from "./auth.js";
import { envRouter, type EnvRouteDeps } from "./env.js";
import { githubRouter, type GitHubRouteDeps } from "./github.js";

export type ApiDeps = AuthRouteDeps & GitHubRouteDeps & AppRouteDeps & EnvRouteDeps;

/** Mounts everything under `/api`. Pass the result to `createApp({ registerRoutes })`. */
export function apiRoutes(deps: ApiDeps): (app: Express) => void {
  return (app) => {
    // Order matters: reject cross-origin writes before any session lookup or handler runs.
    app.use("/api", requireSameOrigin(deps.config.publicUrl));
    app.use(
      "/api",
      loadSession({
        store: deps.sessions,
        cookieName: cookieNames(deps.config.nodeEnv).session,
        allowedGithubIds: deps.config.allowedGithubIds,
      }),
    );
    app.use("/api", authRouter(deps));
    app.use("/api", githubRouter(deps));
    // Env first: its larger JSON limit must parse /apps/:id/env before the apps router does.
    app.use("/api", envRouter(deps));
    app.use("/api", appsRouter(deps));
  };
}
