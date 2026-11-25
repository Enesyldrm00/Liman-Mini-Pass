import type { Database } from "@liman/db";
import type { ApiError, CurrentUser, LoginError } from "@liman/shared";
import { Router, type Response } from "express";
import type { Redis } from "ioredis";
import { z } from "zod";
import { cookieNames, cookieOptions, readCookie } from "../auth/cookies.js";
import { GitHubAuthError, type GitHubAuth } from "../auth/github.js";
import type { SessionStore } from "../auth/sessions.js";
import { newToken, pkceChallenge, safeEqual } from "../auth/tokens.js";
import { upsertUser } from "../auth/users.js";
import type { Config } from "../config/index.js";
import { rateLimit } from "../middleware/rate-limit.js";
import { requireAuth } from "../middleware/session.js";

export interface AuthRouteDeps {
  config: Config;
  db: Database;
  redis: Redis;
  github: GitHubAuth;
  sessions: SessionStore;
  now?: () => Date;
}

/** The sign-in round trip to GitHub must finish within this time. */
const STATE_TTL_MS = 10 * 60 * 1000;

/** Per client IP, for each of the two sign-in endpoints. */
const SIGN_IN_LIMIT = { limit: 10, windowSeconds: 60 };

/**
 * The sign-in cookie holds `<state>.<pkce verifier>`. Both are base64url, which has no `.`.
 * The verifier never leaves the server except in this httpOnly cookie, so a leaked `code`
 * cannot be redeemed without it.
 */
function parseSignInCookie(value: string | undefined): { state: string; verifier: string } | null {
  const [state, verifier, extra] = (value ?? "").split(".");
  return state && verifier && extra === undefined ? { state, verifier } : null;
}

const callbackQuerySchema = z.object({
  code: z.string().min(1).max(512),
  state: z.string().min(1).max(512),
});

export function authRouter(deps: AuthRouteDeps): Router {
  const { config, sessions } = deps;
  const now = deps.now ?? (() => new Date());
  const names = cookieNames(config.nodeEnv);
  const redirectUri = `${config.publicUrl}/api/auth/github/callback`;
  const router = Router();

  function backToPanel(res: Response, error?: LoginError): void {
    res.redirect(302, error ? `${config.publicUrl}/?login_error=${error}` : `${config.publicUrl}/`);
  }

  router.get(
    "/auth/github/login",
    rateLimit({ redis: deps.redis, name: "auth-login", ...SIGN_IN_LIMIT }),
    (_req, res) => {
      const state = newToken();
      const verifier = newToken();
      res.cookie(
        names.oauthState,
        `${state}.${verifier}`,
        cookieOptions(config.nodeEnv, STATE_TTL_MS),
      );
      res.redirect(
        302,
        deps.github.authorizeUrl({ state, codeChallenge: pkceChallenge(verifier), redirectUri }),
      );
    },
  );

  router.get(
    "/auth/github/callback",
    rateLimit({ redis: deps.redis, name: "auth-callback", ...SIGN_IN_LIMIT }),
    async (req, res) => {
      // The state cookie is single-use, whatever happens next.
      const expected = parseSignInCookie(readCookie(req, names.oauthState));
      res.clearCookie(names.oauthState, cookieOptions(config.nodeEnv));

      if (typeof req.query.error === "string") {
        backToPanel(res, "denied");
        return;
      }

      const query = callbackQuerySchema.safeParse(req.query);
      if (!query.success || !expected || !safeEqual(query.data.state, expected.state)) {
        // A missing or different state means this callback was not started by this
        // browser (login CSRF), or the round trip took longer than the cookie lives.
        const body: ApiError = {
          error: { code: "validation_failed", message: "Invalid sign-in state" },
        };
        res.status(400).json(body);
        return;
      }

      // A session from before this sign-in is never reused (session fixation). It ends here,
      // before GitHub answers, so a rejected sign-in does not leave the old account signed in.
      const previous = readCookie(req, names.session);
      if (previous) {
        await sessions.delete(previous);
        res.clearCookie(names.session, cookieOptions(config.nodeEnv));
      }

      let ghUser;
      try {
        ghUser = await deps.github.fetchUser({
          code: query.data.code,
          codeVerifier: expected.verifier,
          redirectUri,
        });
      } catch (error) {
        if (error instanceof GitHubAuthError) {
          req.log.warn({ reason: error.reason }, "github sign-in failed");
          backToPanel(res, "github_failed");
          return;
        }
        throw error;
      }

      // Allow list by numeric ID: logins can be renamed and then claimed by someone else.
      if (!config.allowedGithubIds.has(String(ghUser.id))) {
        req.log.warn({ githubId: ghUser.id }, "sign-in rejected: not on the allow list");
        backToPanel(res, "not_allowed");
        return;
      }

      const user = await upsertUser(deps.db, ghUser, now());
      const { token } = await sessions.create(user.id);
      res.cookie(
        names.session,
        token,
        cookieOptions(config.nodeEnv, config.sessionTtlHours * 60 * 60 * 1000),
      );
      req.log.info({ userId: user.id, githubId: user.githubId }, "signed in");
      backToPanel(res);
    },
  );

  router.post("/auth/logout", async (req, res) => {
    const token = readCookie(req, names.session);
    if (token) {
      await sessions.delete(token);
    }
    res.clearCookie(names.session, cookieOptions(config.nodeEnv));
    res.status(204).end();
  });

  router.get("/me", requireAuth, (req, res) => {
    // requireAuth guarantees req.auth.
    const user = req.auth?.user;
    if (!user) {
      throw new Error("requireAuth let an unauthenticated request through");
    }
    const body: CurrentUser = {
      id: user.id,
      githubId: user.githubId,
      login: user.login,
      avatarUrl: user.avatarUrl,
    };
    res.json(body);
  });

  return router;
}
