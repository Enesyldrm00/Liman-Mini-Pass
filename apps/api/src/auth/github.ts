import { z } from "zod";

// GitHub App user authorization (web flow). The user token is used for a single
// `GET /user` call inside `fetchUser` and then dropped; it is never stored or logged
// (ROADMAP section 7).

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";
const USER_URL = "https://api.github.com/user";
const TIMEOUT_MS = 10_000;

export interface GitHubUser {
  readonly id: number;
  readonly login: string;
  readonly avatarUrl: string | null;
}

export interface GitHubAuth {
  /** Where to send the browser to start sign-in. `codeChallenge` is the PKCE S256 challenge. */
  authorizeUrl(params: { state: string; codeChallenge: string; redirectUri: string }): string;
  /**
   * Exchanges the one-time `code` (with the PKCE verifier) for a user token and returns
   * who signed in.
   */
  fetchUser(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<GitHubUser>;
}

/** Sign-in failed on GitHub's side or the answer was unusable. `reason` is safe to log. */
export class GitHubAuthError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`GitHub sign-in failed: ${reason}`);
    this.name = "GitHubAuthError";
    this.reason = reason;
  }
}

// GitHub answers token requests with 200 even on failure, with `error` set instead.
const tokenResponseSchema = z.union([
  z.object({ access_token: z.string().min(1) }),
  z.object({ error: z.string() }),
]);

const userResponseSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1),
  avatar_url: z.string().nullish(),
});

/** Error codes from GitHub are short identifiers; anything else is not echoed into logs. */
const SAFE_REASON = /^[a-z_]{1,64}$/;

export interface GitHubAuthOptions {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}

export function createGitHubAuth(options: GitHubAuthOptions): GitHubAuth {
  const baseFetch = options.fetch ?? fetch;

  /** Network failures and timeouts become `GitHubAuthError`, so callers handle one type. */
  async function doFetch(what: string, url: string, init: RequestInit): Promise<Response> {
    try {
      return await baseFetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      throw new GitHubAuthError(`${what}_${timedOut ? "timeout" : "network"}`);
    }
  }

  async function readJson(response: Response, what: string): Promise<unknown> {
    if (!response.ok) {
      throw new GitHubAuthError(`${what}_http_${String(response.status)}`);
    }
    try {
      return await response.json();
    } catch {
      throw new GitHubAuthError(`${what}_invalid_json`);
    }
  }

  return {
    authorizeUrl({ state, codeChallenge, redirectUri }) {
      const url = new URL(AUTHORIZE_URL);
      url.searchParams.set("client_id", options.clientId);
      url.searchParams.set("redirect_uri", redirectUri);
      url.searchParams.set("state", state);
      url.searchParams.set("code_challenge", codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
      return url.toString();
    },

    async fetchUser({ code, codeVerifier, redirectUri }) {
      const tokenResponse = await doFetch("token", TOKEN_URL, {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code,
          code_verifier: codeVerifier,
          redirect_uri: redirectUri,
        }),
      });
      const token = tokenResponseSchema.safeParse(await readJson(tokenResponse, "token"));
      if (!token.success) {
        throw new GitHubAuthError("token_unexpected_response");
      }
      if ("error" in token.data) {
        const reason = token.data.error;
        throw new GitHubAuthError(SAFE_REASON.test(reason) ? reason : "token_error");
      }

      const userResponse = await doFetch("user", USER_URL, {
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${token.data.access_token}`,
          "user-agent": "liman",
          "x-github-api-version": "2022-11-28",
        },
      });
      const user = userResponseSchema.safeParse(await readJson(userResponse, "user"));
      if (!user.success) {
        throw new GitHubAuthError("user_unexpected_response");
      }
      return { id: user.data.id, login: user.data.login, avatarUrl: user.data.avatar_url ?? null };
    },
  };
}
