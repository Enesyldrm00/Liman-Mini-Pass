import { z } from "zod";
import { GITHUB_API, GITHUB_HEADERS, githubFetch, readJson } from "../github/http.js";

// GitHub App user authorization (web flow). The user token never leaves this module: it is
// handed to `withUser`'s callback only through `UserGitHub`, and revoked on GitHub as soon
// as the callback settles. It is never stored or logged (ROADMAP section 7, ADR-0002).

const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const TOKEN_URL = "https://github.com/login/oauth/access_token";

/** `GET /user/installations` pages walked at most; 100 installations each. */
const MAX_INSTALLATION_PAGES = 10;

export interface GitHubUser {
  readonly id: number;
  readonly login: string;
  readonly avatarUrl: string | null;
}

/** An installation of this App the signed-in user can access, as GitHub reports it. */
export interface UserInstallation {
  readonly installationId: number;
  readonly accountLogin: string;
  readonly accountType: string;
  readonly suspendedAt: Date | null;
}

/** What the sign-in callback may do with the user's token while it is alive. */
export interface UserGitHub {
  readonly user: GitHubUser;
  /** Every installation of this App the user can access (`GET /user/installations`). */
  installations(): Promise<UserInstallation[]>;
}

export interface WithUserParams {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  /** Revoking is best effort: sign-in goes on, and the reason (safe to log) lands here. */
  onRevokeFailed?: (reason: string) => void;
}

export interface GitHubAuth {
  /** Where to send the browser to start sign-in. `codeChallenge` is the PKCE S256 challenge. */
  authorizeUrl(params: { state: string; codeChallenge: string; redirectUri: string }): string;
  /**
   * Exchanges the one-time `code` (with the PKCE verifier) for a user token, looks up who
   * signed in and runs `use`. The token is revoked when `use` settles, whether it resolved
   * or threw.
   */
  withUser<T>(params: WithUserParams, use: (github: UserGitHub) => Promise<T>): Promise<T>;
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

const fail = (reason: string) => new GitHubAuthError(reason);

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

const installationPageSchema = z.object({
  total_count: z.number().int().nonnegative(),
  installations: z.array(z.unknown()),
});

const installationSchema = z.object({
  id: z.number().int().positive(),
  account: z.object({ login: z.string().min(1), type: z.string().min(1) }),
  suspended_at: z.iso.datetime({ offset: true }).nullish(),
});

/** Error codes from GitHub are short identifiers; anything else is not echoed into logs. */
const SAFE_REASON = /^[a-z_]{1,64}$/;

export interface GitHubAuthOptions {
  clientId: string;
  clientSecret: string;
  fetch?: typeof fetch;
}

export function createGitHubAuth(options: GitHubAuthOptions): GitHubAuth {
  const fetchImpl = options.fetch ?? fetch;

  const userHeaders = (token: string) => ({ ...GITHUB_HEADERS, authorization: `Bearer ${token}` });

  async function exchangeCode(params: WithUserParams): Promise<string> {
    const response = await githubFetch(
      fetchImpl,
      "token",
      TOKEN_URL,
      {
        method: "POST",
        headers: { accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({
          client_id: options.clientId,
          client_secret: options.clientSecret,
          code: params.code,
          code_verifier: params.codeVerifier,
          redirect_uri: params.redirectUri,
        }),
      },
      fail,
    );
    const token = tokenResponseSchema.safeParse(await readJson(response, "token", fail));
    if (!token.success) {
      throw fail("token_unexpected_response");
    }
    if ("error" in token.data) {
      const reason = token.data.error;
      throw fail(SAFE_REASON.test(reason) ? reason : "token_error");
    }
    return token.data.access_token;
  }

  async function fetchUser(token: string): Promise<GitHubUser> {
    const response = await githubFetch(
      fetchImpl,
      "user",
      `${GITHUB_API}/user`,
      { headers: userHeaders(token) },
      fail,
    );
    const user = userResponseSchema.safeParse(await readJson(response, "user", fail));
    if (!user.success) {
      throw fail("user_unexpected_response");
    }
    return { id: user.data.id, login: user.data.login, avatarUrl: user.data.avatar_url ?? null };
  }

  async function fetchInstallations(token: string): Promise<UserInstallation[]> {
    const found: UserInstallation[] = [];
    for (let page = 1; page <= MAX_INSTALLATION_PAGES; page += 1) {
      const response = await githubFetch(
        fetchImpl,
        "installations",
        `${GITHUB_API}/user/installations?per_page=100&page=${String(page)}`,
        { headers: userHeaders(token) },
        fail,
      );
      const body = installationPageSchema.safeParse(
        await readJson(response, "installations", fail),
      );
      if (!body.success) {
        throw fail("installations_unexpected_response");
      }
      for (const item of body.data.installations) {
        // An entry Liman cannot use (e.g. an enterprise account without a login) is
        // skipped rather than failing the whole sign-in.
        const parsed = installationSchema.safeParse(item);
        if (parsed.success) {
          found.push({
            installationId: parsed.data.id,
            accountLogin: parsed.data.account.login,
            accountType: parsed.data.account.type,
            suspendedAt: parsed.data.suspended_at ? new Date(parsed.data.suspended_at) : null,
          });
        }
      }
      if (body.data.installations.length === 0 || page * 100 >= body.data.total_count) {
        return found;
      }
    }
    // Stopping early would make the sync delete installations it never saw.
    throw fail("installations_too_many");
  }

  /** `DELETE /applications/{client_id}/token`, authenticated with the App's client secret. */
  async function revoke(token: string): Promise<void> {
    const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64");
    const response = await githubFetch(
      fetchImpl,
      "revoke",
      `${GITHUB_API}/applications/${encodeURIComponent(options.clientId)}/token`,
      {
        method: "DELETE",
        headers: {
          ...GITHUB_HEADERS,
          authorization: `Basic ${basic}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ access_token: token }),
      },
      fail,
    );
    await response.body?.cancel().catch(() => undefined);
    if (response.status !== 204) {
      throw fail(`revoke_http_${String(response.status)}`);
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

    async withUser(params, use) {
      const token = await exchangeCode(params);
      try {
        const user = await fetchUser(token);
        return await use({ user, installations: () => fetchInstallations(token) });
      } finally {
        try {
          await revoke(token);
        } catch (error) {
          params.onRevokeFailed?.(error instanceof GitHubAuthError ? error.reason : "revoke_error");
        }
      }
    },
  };
}
