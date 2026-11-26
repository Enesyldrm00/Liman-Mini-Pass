import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GitHubApiError, MAX_REPO_SCAN_PAGES, createGitHubApp } from "./app.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const NOW = new Date("2026-11-26T12:00:00Z");

interface Call {
  method: string;
  url: string;
  authorization: string | null;
}

type Handler = (call: Call) => Response;

/** A fetch that records each call and answers from `handler`. */
function fakeFetch(handler: Handler) {
  const calls: Call[] = [];
  const impl: typeof fetch = (input, init) => {
    const call = {
      method: init?.method ?? "GET",
      url: input instanceof Request ? input.url : String(input),
      authorization: new Headers(init?.headers).get("authorization"),
    };
    calls.push(call);
    return Promise.resolve(handler(call));
  };
  return { impl, calls };
}

let minted = 0;
/** Answers token requests with `ghs_<n>`, valid for an hour. */
function tokenResponse(): Response {
  minted += 1;
  return Response.json(
    {
      token: `ghs_${String(minted)}`,
      expires_at: new Date(NOW.getTime() + 3600_000).toISOString(),
    },
    { status: 201 },
  );
}

const isTokenCall = (call: Call) => call.url.endsWith("/access_tokens");

function app(handler: Handler) {
  const fake = fakeFetch((call) => (isTokenCall(call) ? tokenResponse() : handler(call)));
  return {
    ...fake,
    gh: createGitHubApp({ appId: 99, privateKey, fetch: fake.impl, now: () => NOW }),
  };
}

const repo = (id: number) => ({
  id,
  name: `repo-${String(id)}`,
  full_name: `enes/repo-${String(id)}`,
  private: id % 2 === 0,
  default_branch: "main",
  owner: { login: "enes" },
});

describe("installation tokens", () => {
  it("mints a token with a valid App JWT and reuses it", async () => {
    const { gh, calls } = app(() => Response.json({ repositories: [] }));
    await gh.listRepos(7, 1);
    await gh.listRepos(7, 1);

    const tokenCalls = calls.filter(isTokenCall);
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]).toMatchObject({
      method: "POST",
      url: "https://api.github.com/app/installations/7/access_tokens",
    });
    const jwt = (tokenCalls[0]?.authorization ?? "").replace(/^Bearer /, "");
    const [header = "", payload = "", signature = ""] = jwt.split(".");
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);

    const repoCalls = calls.filter((call) => !isTokenCall(call));
    expect(repoCalls.map((call) => call.authorization)).toEqual(["Bearer ghs_1", "Bearer ghs_1"]);
  });

  it("drops a token GitHub rejects with 401 and mints a new one next time", async () => {
    let reject = true;
    const { gh, calls } = app(() => {
      if (reject) {
        reject = false;
        return new Response(null, { status: 401 });
      }
      return Response.json({ repositories: [] });
    });
    await expect(gh.listRepos(7, 1)).rejects.toMatchObject({ reason: "repos_http_401" });
    await gh.listRepos(7, 1);
    expect(calls.filter(isTokenCall)).toHaveLength(2);
  });

  it("reports a removed installation as a 404", async () => {
    const fake = fakeFetch(() => new Response(null, { status: 404 }));
    const gh = createGitHubApp({ appId: 99, privateKey, fetch: fake.impl, now: () => NOW });
    const error = await gh.listRepos(7, 1).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GitHubApiError);
    expect(error).toMatchObject({ reason: "installation_token_http_404", status: 404 });
  });

  it("never puts a token in an error", async () => {
    const { gh } = app(() => Response.json({ message: "Bad credentials ghs_1" }, { status: 500 }));
    const error = await gh.listRepos(7, 1).catch((e: unknown) => e);
    expect((error as Error).message).toBe("GitHub API call failed: repos_http_500");
    expect(JSON.stringify(error)).not.toContain("ghs_");
  });
});

describe("listRepos", () => {
  it("maps repositories and follows the Link header", async () => {
    const { gh, calls } = app(() =>
      Response.json(
        { total_count: 150, repositories: [repo(1), repo(2)] },
        {
          headers: {
            link: '<https://api.github.com/installation/repositories?page=3>; rel="next"',
          },
        },
      ),
    );
    const page = await gh.listRepos(7, 2);
    expect(page).toEqual({
      items: [
        { id: 1, name: "repo-1", fullName: "enes/repo-1", private: false, defaultBranch: "main" },
        { id: 2, name: "repo-2", fullName: "enes/repo-2", private: true, defaultBranch: "main" },
      ],
      hasNext: true,
    });
    expect(calls.at(-1)?.url).toBe(
      "https://api.github.com/installation/repositories?per_page=100&page=2",
    );
  });

  it("knows the last page", async () => {
    const { gh } = app(() =>
      Response.json(
        { repositories: [] },
        { headers: { link: '<https://api.github.com/x?page=1>; rel="prev"' } },
      ),
    );
    expect((await gh.listRepos(7, 2)).hasNext).toBe(false);
  });

  it("rejects an unexpected body", async () => {
    const { gh } = app(() => Response.json({ repositories: [{ id: "x" }] }));
    await expect(gh.listRepos(7, 1)).rejects.toMatchObject({ reason: "repos_unexpected_response" });
  });

  it("turns a timeout into a GitHubApiError", async () => {
    const fake = fakeFetch(() => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });
    const gh = createGitHubApp({ appId: 99, privateKey, fetch: fake.impl, now: () => NOW });
    await expect(gh.listRepos(7, 1)).rejects.toMatchObject({
      reason: "installation_token_timeout",
    });
  });
});

describe("findInstalledRepo", () => {
  /** An installation with `count` repositories (IDs 1…count), served 100 per page. */
  function installationWith(count: number) {
    return app((call) => {
      const page = Number(new URL(call.url).searchParams.get("page"));
      const ids = Array.from({ length: count }, (_, i) => i + 1).slice(
        (page - 1) * 100,
        page * 100,
      );
      const last = page * 100 >= count;
      return Response.json(
        { total_count: count, repositories: ids.map(repo) },
        {
          headers: last
            ? {}
            : { link: `<https://api.github.com/x?page=${String(page + 1)}>; rel="next"` },
        },
      );
    });
  }

  const repoCalls = (calls: Call[]) => calls.filter((call) => !isTokenCall(call));

  it("finds a repository in the installation's own list, on a later page", async () => {
    const { gh, calls } = installationWith(250);
    expect(await gh.findInstalledRepo(7, 205)).toMatchObject({
      id: 205,
      fullName: "enes/repo-205",
    });
    expect(repoCalls(calls).map((call) => call.url)).toEqual(
      [1, 2, 3].map(
        (page) =>
          `https://api.github.com/installation/repositories?per_page=100&page=${String(page)}`,
      ),
    );
  });

  it("stops at the first page that has it", async () => {
    const { gh, calls } = installationWith(250);
    await gh.findInstalledRepo(7, 5);
    expect(repoCalls(calls)).toHaveLength(1);
  });

  it("returns null for a repository outside the installation, never asking for it by ID", async () => {
    // GitHub would answer GET /repositories/:id with 200 for any public repository.
    const { gh, calls } = installationWith(3);
    expect(await gh.findInstalledRepo(7, 2325298)).toBeNull();
    expect(repoCalls(calls).some((call) => call.url.includes("/repositories/"))).toBe(false);
  });

  it("gives up past the page limit instead of scanning forever", async () => {
    const { gh, calls } = installationWith(5000);
    await expect(gh.findInstalledRepo(7, 4999)).rejects.toMatchObject({
      reason: "installation_repos_too_many",
    });
    expect(repoCalls(calls)).toHaveLength(MAX_REPO_SCAN_PAGES);
  });
});

describe("listBranches", () => {
  it("lists branches with their head commit", async () => {
    const { gh, calls } = app(() =>
      Response.json([
        { name: "main", commit: { sha: "a".repeat(40) }, protected: false },
        { name: "dev", commit: { sha: "b".repeat(40) }, protected: false },
      ]),
    );
    expect(await gh.listBranches(7, "enes/my app", 1)).toEqual({
      items: [
        { name: "main", commitSha: "a".repeat(40) },
        { name: "dev", commitSha: "b".repeat(40) },
      ],
      hasNext: false,
    });
    expect(calls.at(-1)?.url).toBe(
      "https://api.github.com/repos/enes/my%20app/branches?per_page=100&page=1",
    );
  });

  it.each(["enes/app/../../x", "../x", "enes/..", "enes", "/app"])(
    "refuses the repository name %j, which would change the path",
    async (name) => {
      const { gh, calls } = app(() => Response.json([]));
      await expect(gh.listBranches(7, name, 1)).rejects.toMatchObject({
        reason: "invalid_repo_name",
      });
      expect(calls.filter((call) => !isTokenCall(call))).toHaveLength(0);
    },
  );
});
