import { currentUserSchema } from "@liman/shared";
import { describe, expect, it, vi } from "vitest";
import { apiError, stubFetch } from "../test/fetch";
import { ApiRequestError, getJson, post } from "./client";
import { fetchMe, fetchRepos } from "./endpoints";

const user = {
  id: "0b0c2f6e-5c39-4a8e-9a43-1f0c6a8f2b11",
  githubId: 42,
  login: "octocat",
  avatarUrl: null,
};

describe("getJson", () => {
  it("returns the body when it matches the schema", async () => {
    stubFetch({ "GET /api/me": { body: user } });
    await expect(getJson("/api/me", currentUserSchema)).resolves.toEqual(user);
  });

  it("sends same-origin credentials and asks for JSON", async () => {
    const mock = stubFetch({ "GET /api/me": { body: user } });
    await getJson("/api/me", currentUserSchema);
    const init = mock.mock.calls[0]?.[1];
    expect(init?.credentials).toBe("same-origin");
    expect(init?.headers).toMatchObject({ Accept: "application/json" });
  });

  it("turns the API error shape into an ApiRequestError", async () => {
    stubFetch({ "GET /api/me": apiError(409, "conflict", "Installation is suspended") });
    const error: unknown = await getJson("/api/me", currentUserSchema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: "conflict" });
  });

  it("handles an error body that is not the API's shape", async () => {
    stubFetch({ "GET /api/me": { status: 502, body: "Bad Gateway" } });
    await expect(getJson("/api/me", currentUserSchema)).rejects.toMatchObject({
      status: 502,
      code: "internal",
    });
  });

  it("rejects a body that does not match the schema", async () => {
    stubFetch({ "GET /api/me": { body: { id: "nope" } } });
    await expect(getJson("/api/me", currentUserSchema)).rejects.toMatchObject({
      code: "internal",
      message: "Unexpected response from the API",
    });
  });

  it("reports a network failure as status 0", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(getJson("/api/me", currentUserSchema)).rejects.toMatchObject({ status: 0 });
  });
});

describe("post", () => {
  it("accepts a 204 without a body", async () => {
    stubFetch({ "POST /api/auth/logout": { status: 204 } });
    await expect(post("/api/auth/logout")).resolves.toBeUndefined();
  });
});

describe("fetchMe", () => {
  it("returns null on 401", async () => {
    stubFetch({ "GET /api/me": apiError(401, "unauthenticated") });
    await expect(fetchMe()).resolves.toBeNull();
  });

  it("rethrows other errors", async () => {
    stubFetch({ "GET /api/me": apiError(500, "internal") });
    await expect(fetchMe()).rejects.toMatchObject({ status: 500 });
  });
});

describe("fetchRepos", () => {
  it("passes the cursor as a query parameter", async () => {
    const id = "6d1f2b0a-3e4c-4f5a-8b9c-0d1e2f3a4b5c";
    const mock = stubFetch({
      [`GET /api/github/installations/${id}/repos?cursor=2`]: {
        body: { items: [], nextCursor: null },
      },
    });
    await expect(fetchRepos(id, "2")).resolves.toEqual({ items: [], nextCursor: null });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});
