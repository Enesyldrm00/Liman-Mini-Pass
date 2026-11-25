import type { ApiError } from "@liman/shared";
import type { RequestHandler } from "express";
import { readCookie } from "../auth/cookies.js";
import type { SessionStore } from "../auth/sessions.js";

export interface SessionMiddlewareOptions {
  store: SessionStore;
  cookieName: string;
  allowedGithubIds: ReadonlySet<string>;
}

/**
 * Resolves the session cookie into `req.auth`. Never rejects a request by itself; routes
 * that need a user add `requireAuth`. A user removed from the allow list loses existing
 * sessions on their next request, not only at the next sign-in.
 */
export function loadSession(options: SessionMiddlewareOptions): RequestHandler {
  return async (req, _res, next) => {
    const token = readCookie(req, options.cookieName);
    if (token) {
      const auth = await options.store.find(token);
      if (auth && options.allowedGithubIds.has(String(auth.user.githubId))) {
        req.auth = auth;
      } else if (auth) {
        await options.store.deleteById(auth.sessionId);
      }
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, res, next) => {
  if (req.auth) {
    next();
    return;
  }
  const body: ApiError = { error: { code: "unauthenticated", message: "Sign in required" } };
  res.status(401).json(body);
};
