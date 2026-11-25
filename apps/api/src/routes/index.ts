import type { Express } from "express";
import { cookieNames } from "../auth/cookies.js";
import { requireSameOrigin } from "../middleware/origin-check.js";
import { loadSession } from "../middleware/session.js";
import { authRouter, type AuthRouteDeps } from "./auth.js";

export type ApiDeps = AuthRouteDeps;

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
  };
}
