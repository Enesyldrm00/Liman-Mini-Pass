import { describe, expect, it } from "vitest";
import { GitHubAuthError, createGitHubAuth } from "./github.js";

const REDIRECT = "http://liman.localhost/api/auth/github/callback";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A fetch that answers the token and user endpoints from the given responses. */
function fakeFetch(token: () => Response, user: () => Response) {
  const calls: Call[] = [];
  const impl: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    calls.push({ url, init });
    return Promise.resolve(url.includes("/login/oauth/access_token") ? token() : user());
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

describe("authorizeUrl", () => {
  it("points at GitHub with client_id, redirect_uri and state", () => {
    const url = new URL(auth(fetch).authorizeUrl({ state: "state-value", redirectUri: REDIRECT }));
    expect(url.origin + url.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "Iv23test",
      redirect_uri: REDIRECT,
      state: "state-value",
    });
  });
});

describe("fetchUser", () => {
  it("exchanges the code and returns the user", async () => {
    const { impl, calls } = fakeFetch(
      json({ access_token: "ghu_token", token_type: "bearer" }),
      json({ id: 42, login: "octocat", avatar_url: "https://avatars/42" }),
    );

    const user = await auth(impl).fetchUser({ code: "the-code", redirectUri: REDIRECT });

    expect(user).toEqual({ id: 42, login: "octocat", avatarUrl: "https://avatars/42" });
    expect(JSON.parse(calls[0]?.init?.body as string)).toEqual({
      client_id: "Iv23test",
      client_secret: "s3cret",
      code: "the-code",
      redirect_uri: REDIRECT,
    });
    expect(calls[1]?.url).toBe("https://api.github.com/user");
    expect(new Headers(calls[1]?.init?.headers).get("authorization")).toBe("Bearer ghu_token");
  });

  it("reports GitHub's error code when the code is rejected", async () => {
    const { impl, calls } = fakeFetch(
      json({ error: "bad_verification_code", error_description: "The code is incorrect" }),
      json({}),
    );
    const error = await auth(impl)
      .fetchUser({ code: "old", redirectUri: REDIRECT })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubAuthError);
    expect((error as GitHubAuthError).reason).toBe("bad_verification_code");
    expect(calls).toHaveLength(1);
  });

  it.each([
    ["an HTTP error", json({}, 502), "token_http_502"],
    ["an unexpected body", json({ hello: "world" }), "token_unexpected_response"],
    ["an error code that is not a plain identifier", json({ error: "<script>" }), "token_error"],
  ])("fails with a safe reason on %s from the token endpoint", async (_label, token, reason) => {
    const { impl } = fakeFetch(token, json({}));
    await expect(auth(impl).fetchUser({ code: "c", redirectUri: REDIRECT })).rejects.toMatchObject({
      reason,
    });
  });

  it("fails when the user lookup does not return a valid user", async () => {
    const { impl } = fakeFetch(json({ access_token: "ghu_token" }), json({ login: "no-id" }));
    await expect(auth(impl).fetchUser({ code: "c", redirectUri: REDIRECT })).rejects.toMatchObject({
      reason: "user_unexpected_response",
    });
  });

  it("never puts the user token in the error", async () => {
    const { impl } = fakeFetch(json({ access_token: "ghu_secret_token" }), json({}, 401));
    const error = await auth(impl)
      .fetchUser({ code: "c", redirectUri: REDIRECT })
      .catch((e: unknown) => e);
    expect((error as Error).message).toBe("GitHub sign-in failed: user_http_401");
    expect(JSON.stringify(error)).not.toContain("ghu_secret_token");
  });

  it("maps a missing avatar to null", async () => {
    const { impl } = fakeFetch(json({ access_token: "t" }), json({ id: 7, login: "x" }));
    const user = await auth(impl).fetchUser({ code: "c", redirectUri: REDIRECT });
    expect(user.avatarUrl).toBeNull();
  });
});
