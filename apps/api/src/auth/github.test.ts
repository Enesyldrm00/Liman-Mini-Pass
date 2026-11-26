import { describe, expect, it } from "vitest";
import { GitHubAuthError, createGitHubAuth, type WithUserParams } from "./github.js";

const REDIRECT = "http://liman.localhost/api/auth/github/callback";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

type Answer = () => Response;

interface Answers {
  token: Answer;
  user?: Answer;
  installations?: (page: number) => Response;
  revoke?: Answer;
}

/** A fetch that answers GitHub's token, user, installations and revoke endpoints. */
function fakeFetch(answers: Answers) {
  const calls: Call[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    if (url.includes("/login/oauth/access_token")) {
      return Promise.resolve(answers.token());
    }
    if (url.includes("/user/installations")) {
      const page = Number(new URL(url).searchParams.get("page"));
      return Promise.resolve(
        answers.installations?.(page) ?? Response.json({ total_count: 0, installations: [] }),
      );
    }
    if (url.includes("/applications/")) {
      return Promise.resolve(answers.revoke?.() ?? new Response(null, { status: 204 }));
    }
    return Promise.resolve(answers.user?.() ?? Response.json({ id: 42, login: "octocat" }));
  };
  return { impl, calls };
}

const json =
  (body: unknown, status = 200) =>
  () =>
    Response.json(body, { status });

function auth(fetchImpl: typeof fetch) {
  return createGitHubAuth({ clientId: "Iv23test", clientSecret: "s3cret", fetch: fetchImpl });
}

const params = { code: "the-code", codeVerifier: "verifier", redirectUri: REDIRECT };

/** Signs in and returns the user, doing nothing else with the token. */
function signIn(fetchImpl: typeof fetch, extra: Partial<WithUserParams> = {}) {
  return auth(fetchImpl).withUser({ ...params, ...extra }, (github) =>
    Promise.resolve(github.user),
  );
}

const revokeCalls = (calls: Call[]) => calls.filter((call) => call.url.includes("/applications/"));

describe("authorizeUrl", () => {
  it("points at GitHub with client_id, redirect_uri, state and an S256 PKCE challenge", () => {
    const url = new URL(
      auth(fetch).authorizeUrl({
        state: "state-value",
        codeChallenge: "challenge-value",
        redirectUri: REDIRECT,
      }),
    );
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "Iv23test",
      redirect_uri: REDIRECT,
      state: "state-value",
      code_challenge: "challenge-value",
      code_challenge_method: "S256",
    });
  });
});

describe("withUser", () => {
  it("exchanges the code and hands the user to the callback", async () => {
    const { impl, calls } = fakeFetch({
      token: json({ access_token: "ghu_token", token_type: "bearer" }),
      user: json({ id: 42, login: "octocat", avatar_url: "https://avatars/42" }),
    });

    const user = await signIn(impl);

    expect(user).toEqual({ id: 42, login: "octocat", avatarUrl: "https://avatars/42" });
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      client_id: "Iv23test",
      client_secret: "s3cret",
      code: "the-code",
      code_verifier: "verifier",
      redirect_uri: REDIRECT,
    });
    expect(calls[1]?.url).toBe("https://api.github.com/user");
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe("Bearer ghu_token");
  });

  it("revokes the token once the callback is done", async () => {
    const { impl, calls } = fakeFetch({ token: json({ access_token: "ghu_token" }) });
    await signIn(impl);

    const revokes = revokeCalls(calls);
    expect(revokes).toHaveLength(1);
    expect(revokes[0]?.url).toBe("https://api.github.com/applications/Iv23test/token");
    expect(revokes[0]?.init?.method).toBe("DELETE");
    expect(new Headers(revokes[0]?.init?.headers).get("authorization")).toBe(
      `Basic ${Buffer.from("Iv23test:s3cret").toString("base64")}`,
    );
    expect(JSON.parse(revokes[0]?.init?.body as string)).toEqual({ access_token: "ghu_token" });
  });

  it("revokes the token when the callback throws", async () => {
    const { impl, calls } = fakeFetch({ token: json({ access_token: "ghu_token" }) });
    await expect(
      auth(impl).withUser(params, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");
    expect(revokeCalls(calls)).toHaveLength(1);
  });

  it("revokes the token when the user lookup fails", async () => {
    const { impl, calls } = fakeFetch({
      token: json({ access_token: "ghu_token" }),
      user: json({}, 500),
    });
    await expect(signIn(impl)).rejects.toMatchObject({ reason: "user_http_500" });
    expect(revokeCalls(calls)).toHaveLength(1);
  });

  it("finishes sign-in and reports the reason when revoking fails", async () => {
    const { impl } = fakeFetch({
      token: json({ access_token: "ghu_token" }),
      revoke: json({ message: "ghu_token is unknown" }, 422),
    });
    const reasons: string[] = [];
    const user = await signIn(impl, { onRevokeFailed: (reason) => reasons.push(reason) });
    expect(user.id).toBe(42);
    expect(reasons).toEqual(["revoke_http_422"]);
  });

  it("reports GitHub's error code when the code is rejected", async () => {
    const { impl, calls } = fakeFetch({
      token: json({ error: "bad_verification_code", error_description: "The code is incorrect" }),
    });
    const error = await signIn(impl).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubAuthError);
    expect((error as GitHubAuthError).reason).toBe("bad_verification_code");
    // No token, so nothing to revoke.
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["an HTTP error", json({}, 502), "token_http_502"],
    ["an unexpected body", json({ hello: "world" }), "token_unexpected_response"],
    ["an error code that is not a plain identifier", json({ error: "<script>" }), "token_error"],
  ])("fails with a safe reason on %s from the token endpoint", async (_label, token, reason) => {
    const { impl } = fakeFetch({ token });
    await expect(signIn(impl)).rejects.toMatchObject({ reason });
  });

  it("fails when the user lookup does not return a valid user", async () => {
    const { impl } = fakeFetch({
      token: json({ access_token: "ghu_token" }),
      user: json({ login: "no-id" }),
    });
    await expect(signIn(impl)).rejects.toMatchObject({ reason: "user_unexpected_response" });
  });

  it("never puts the user token in the error", async () => {
    const { impl } = fakeFetch({
      token: json({ access_token: "ghu_secret_token" }),
      user: json({ message: "ghu_secret_token" }, 401),
    });
    const error = await signIn(impl).catch((e: unknown) => e);
    expect((error as Error).message).toBe("GitHub sign-in failed: user_http_401");
    expect(JSON.stringify(error)).not.toContain("ghu_secret_token");
  });

  it.each([
    ["a network error", new TypeError("fetch failed"), "token_network"],
    ["a timeout", new DOMException("The operation timed out.", "TimeoutError"), "token_timeout"],
  ])("turns %s into a GitHubAuthError", async (_label, failure, reason) => {
    const failing: typeof fetch = () => Promise.reject(failure);
    const error = await signIn(failing).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubAuthError);
    expect((error as GitHubAuthError).reason).toBe(reason);
  });

  it("maps a missing avatar to null", async () => {
    const { impl } = fakeFetch({
      token: json({ access_token: "t" }),
      user: json({ id: 7, login: "x" }),
    });
    expect((await signIn(impl)).avatarUrl).toBeNull();
  });
});

describe("installations", () => {
  const installation = (id: number, extra: Record<string, unknown> = {}) => ({
    id,
    app_id: 1,
    account: { login: `account-${String(id)}`, id: id * 10, type: "User" },
    suspended_at: null,
    ...extra,
  });

  function listInstallations(fetchImpl: typeof fetch) {
    return auth(fetchImpl).withUser(params, (github) => github.installations());
  }

  it("lists the user's installations with the user token", async () => {
    const { impl, calls } = fakeFetch({
      token: json({ access_token: "ghu_token" }),
      installations: () =>
        Response.json({
          total_count: 2,
          installations: [
            installation(1),
            installation(2, {
              account: { login: "acme", type: "Organization" },
              suspended_at: "2026-11-20T08:00:00Z",
            }),
          ],
        }),
    });

    expect(await listInstallations(impl)).toEqual([
      { installationId: 1, accountLogin: "account-1", accountType: "User", suspendedAt: null },
      {
        installationId: 2,
        accountLogin: "acme",
        accountType: "Organization",
        suspendedAt: new Date("2026-11-20T08:00:00Z"),
      },
    ]);
    const call = calls.find((c) => c.url.includes("/user/installations"));
    expect(call?.url).toBe("https://api.github.com/user/installations?per_page=100&page=1");
    expect(new Headers(call?.init?.headers).get("authorization")).toBe("Bearer ghu_token");
  });

  it("walks every page", async () => {
    const { impl } = fakeFetch({
      token: json({ access_token: "t" }),
      installations: (page) =>
        Response.json({
          total_count: 150,
          installations:
            page === 1
              ? Array.from({ length: 100 }, (_, i) => installation(i + 1))
              : Array.from({ length: 50 }, (_, i) => installation(i + 101)),
        }),
    });
    const all = await listInstallations(impl);
    expect(all).toHaveLength(150);
    expect(all.at(-1)?.installationId).toBe(150);
  });

  it("skips entries it cannot use instead of failing sign-in", async () => {
    const { impl } = fakeFetch({
      token: json({ access_token: "t" }),
      installations: () =>
        Response.json({
          total_count: 2,
          installations: [installation(1), { id: 2, account: null }],
        }),
    });
    expect((await listInstallations(impl)).map((i) => i.installationId)).toEqual([1]);
  });

  it("fails rather than returning a partial list", async () => {
    const { impl } = fakeFetch({
      token: json({ access_token: "t" }),
      installations: (page) =>
        page === 1
          ? Response.json({ total_count: 150, installations: [installation(1)] })
          : Response.json({}, { status: 500 }),
    });
    await expect(listInstallations(impl)).rejects.toMatchObject({
      reason: "installations_http_500",
    });
  });
});
