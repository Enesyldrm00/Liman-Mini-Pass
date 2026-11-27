/**
 * Integration tests for the installation, repository and branch endpoints against real
 * Postgres and Redis (Testcontainers). The GitHub App client is the real one; only GitHub's
 * HTTP API is faked, and the fake checks the App JWT signature like GitHub would.
 */
import { createSecretKey, generateKeyPairSync, randomBytes, verify } from "node:crypto";
import { Writable } from "node:stream";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { createDb, githubInstallations, runMigrations, users, type DbClient } from "@liman/db";
import { MAX_CURSOR_PAGE, apiErrorSchema, branchPageSchema, repoPageSchema } from "@liman/shared";
import { sql } from "drizzle-orm";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { GitHubAuth } from "../auth/github.js";
import { createSessionStore } from "../auth/sessions.js";
import type { Config } from "../config/index.js";
import { createGitHubApp } from "../github/app.js";
import { createLogger } from "../logger.js";
import { toCursorPage } from "./github.js";
import { apiRoutes } from "./index.js";

const PUBLIC_URL = "http://liman.localhost";
const ALLOWED_ID = 1001;
const APP_ID = 4242;
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let dbClient: DbClient;
let redis: Redis;

beforeAll(async () => {
  [pgContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer("postgres:18.6-alpine").start(),
    new RedisContainer("redis:8.10.3-alpine").start(),
  ]);
  dbClient = createDb(pgContainer.getConnectionUri());
  await runMigrations(dbClient.db);
  redis = new Redis(redisContainer.getConnectionUrl());
});

afterAll(async () => {
  await Promise.all([dbClient.close(), redis.quit()]);
  await Promise.all([pgContainer.stop(), redisContainer.stop()]);
});

// ---------------------------------------------------------------------------------------
// Fake GitHub REST API

interface FakeRepo {
  id: number;
  full_name: string;
  private: boolean;
  default_branch: string;
  branches: string[];
}

const github: {
  /** GitHub installation ID → repositories it can access. */
  installations: Map<number, FakeRepo[]>;
  /** Tokens GitHub handed out, and for which installation. */
  tokens: Map<string, number>;
  tokenRequests: number;
  /** Answer every repository call with this status instead. */
  failWith: number | null;
  /** Installations suspended on GitHub: token requests answer 403. */
  suspended: Set<number>;
} = {
  installations: new Map(),
  tokens: new Map(),
  tokenRequests: 0,
  failWith: null,
  suspended: new Set(),
};

const PAGE_SIZE = 100;

function jwtIsValid(authorization: string | null): boolean {
  const [header = "", payload = "", signature = ""] = (authorization ?? "")
    .replace(/^Bearer /, "")
    .split(".");
  const signed = verify(
    "sha256",
    Buffer.from(`${header}.${payload}`),
    publicKey,
    Buffer.from(signature, "base64url"),
  );
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as { iss?: string };
  return signed && claims.iss === String(APP_ID);
}

function paged<T>(url: URL, items: T[]): { items: T[]; headers: Record<string, string> } {
  const page = Number(url.searchParams.get("page") ?? "1");
  const slice = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const last = page * PAGE_SIZE >= items.length;
  return {
    items: slice,
    headers: last
      ? {}
      : { link: `<${url.origin}${url.pathname}?page=${String(page + 1)}>; rel="next"` },
  };
}

const repoBody = (repo: FakeRepo) => ({
  id: repo.id,
  name: repo.full_name.split("/")[1],
  full_name: repo.full_name,
  private: repo.private,
  default_branch: repo.default_branch,
});

const fakeFetch: typeof fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const authorization = new Headers(init?.headers).get("authorization");
  const answer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    Promise.resolve(Response.json(body, { status, headers }));

  const tokenMatch = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
  if (tokenMatch && init?.method === "POST") {
    if (!jwtIsValid(authorization)) {
      return answer({ message: "A JSON web token could not be decoded" }, 401);
    }
    const installationId = Number(tokenMatch[1]);
    if (!github.installations.has(installationId)) {
      return answer({ message: "Not Found" }, 404);
    }
    if (github.suspended.has(installationId)) {
      return answer({ message: "This installation has been suspended" }, 403);
    }
    github.tokenRequests += 1;
    const token = `ghs_secret_${String(installationId)}_${String(github.tokenRequests)}`;
    github.tokens.set(token, installationId);
    return answer({ token, expires_at: new Date(Date.now() + 3600_000).toISOString() }, 201);
  }

  const installationId = github.tokens.get((authorization ?? "").replace(/^Bearer /, ""));
  if (installationId === undefined) {
    return answer({ message: "Bad credentials" }, 401);
  }
  if (github.failWith !== null) {
    return answer({ message: `upstream broke; token was ${authorization ?? ""}` }, github.failWith);
  }
  const repos = github.installations.get(installationId) ?? [];

  if (url.pathname === "/installation/repositories") {
    const { items, headers } = paged(url, repos);
    return answer({ total_count: repos.length, repositories: items.map(repoBody) }, 200, headers);
  }
  const repoMatch = /^\/repositories\/(\d+)$/.exec(url.pathname);
  if (repoMatch) {
    // Like GitHub: any token can read any public repository by ID.
    const repo = [...github.installations.values()]
      .flat()
      .find((r) => r.id === Number(repoMatch[1]) && !r.private);
    return repo ? answer(repoBody(repo)) : answer({ message: "Not Found" }, 404);
  }
  const branchMatch = /^\/repos\/([^/]+)\/([^/]+)\/branches$/.exec(url.pathname);
  if (branchMatch) {
    const fullName = `${decodeURIComponent(branchMatch[1] ?? "")}/${decodeURIComponent(branchMatch[2] ?? "")}`;
    // Like GitHub: public repositories are readable with any token.
    const repo = [...github.installations.values()]
      .flat()
      .find((r) => r.full_name === fullName && (!r.private || repos.includes(r)));
    if (!repo) {
      return answer({ message: "Not Found" }, 404);
    }
    const { items, headers } = paged(url, repo.branches);
    const body = items.map((name, i) => ({ name, commit: { sha: String(i).padStart(40, "0") } }));
    return answer(body, 200, headers);
  }
  return answer({ message: "Not Found" }, 404);
};

const fakeRepo = (id: number, branches = ["main"]): FakeRepo => ({
  id,
  full_name: `enes/repo-${String(id)}`,
  private: false,
  default_branch: "main",
  branches,
});

// ---------------------------------------------------------------------------------------
// App under test

/** Sign-in is covered in auth.test.ts; sessions here are created directly. */
const unusedAuth: GitHubAuth = {
  authorizeUrl: () => "https://github.test/authorize",
  withUser: () => Promise.reject(new Error("not used")),
};

const config: Config = {
  nodeEnv: "test",
  logLevel: "debug",
  port: 0,
  publicUrl: PUBLIC_URL,
  baseDomain: "localhost",
  databaseUrl: "unused",
  redisUrl: "unused",
  encryptionKey: createSecretKey(randomBytes(32)),
  allowedGithubIds: new Set([String(ALLOWED_ID), "2002"]),
  sessionTtlHours: 1,
  github: {
    clientId: "unused",
    clientSecret: "unused",
    appId: APP_ID,
    appSlug: "liman-test",
    privateKey,
  },
};

/** Everything the API logged during the current test, one JSON line each. */
let logLines: string[] = [];

function makeApp() {
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logLines.push(chunk.toString());
      done();
    },
  });
  return createApp({
    logger: createLogger({ logLevel: "debug" }, destination),
    registerRoutes: apiRoutes({
      config,
      db: dbClient.db,
      redis,
      github: unusedAuth,
      githubApp: createGitHubApp({ appId: APP_ID, privateKey, fetch: fakeFetch }),
      sessions: createSessionStore(dbClient.db, { ttlHours: 1 }),
    }),
  });
}

type App = ReturnType<typeof makeApp>;

async function userWithSession(githubId = ALLOWED_ID) {
  const [user] = await dbClient.db
    .insert(users)
    .values({ githubId, login: `user-${String(githubId)}` })
    .returning();
  if (!user) throw new Error("no user");
  const { token } = await createSessionStore(dbClient.db, { ttlHours: 1 }).create(user.id);
  return { user, cookie: `liman_session=${token}` };
}

async function addInstallation(ownerId: string, installationId: number, extra = {}) {
  const [row] = await dbClient.db
    .insert(githubInstallations)
    .values({
      installationId,
      ownerId,
      accountLogin: `account-${String(installationId)}`,
      accountType: "User",
      ...extra,
    })
    .returning();
  if (!row) throw new Error("no installation");
  return row;
}

const get = (app: App, path: string, cookie?: string) => {
  const req = request(app).get(path);
  return cookie ? req.set("Cookie", cookie) : req;
};

beforeEach(async () => {
  await dbClient.db.execute(sql`truncate users, sessions, github_installations, apps cascade`);
  github.installations.clear();
  github.tokens.clear();
  github.tokenRequests = 0;
  github.failWith = null;
  github.suspended.clear();
  logLines = [];
});

// ---------------------------------------------------------------------------------------

describe("GET /api/github/installations", () => {
  it("requires a session", async () => {
    const res = await get(makeApp(), "/api/github/installations").expect(401);
    expect(res.body).toEqual({ error: { code: "unauthenticated", message: "Sign in required" } });
  });

  it("lists only the user's own installations, with the install link", async () => {
    const app = makeApp();
    const { user, cookie } = await userWithSession();
    const other = await userWithSession(2002);
    const mine = await addInstallation(user.id, 11);
    await addInstallation(user.id, 12, { suspendedAt: new Date() });
    await addInstallation(other.user.id, 13);

    const res = await get(app, "/api/github/installations", cookie).expect(200);
    expect(res.body).toEqual({
      installations: [
        {
          id: mine.id,
          installationId: 11,
          accountLogin: "account-11",
          accountType: "User",
          suspended: false,
        },
        expect.objectContaining({ installationId: 12, suspended: true }),
      ],
      installUrl: "https://github.com/apps/liman-test/installations/new",
    });
  });
});

describe("GET /api/github/installations/:id/repos", () => {
  it("lists repositories page by page with one installation token", async () => {
    const app = makeApp();
    const { user, cookie } = await userWithSession();
    const row = await addInstallation(user.id, 11);
    github.installations.set(
      11,
      Array.from({ length: 150 }, (_, i) => fakeRepo(i + 1)),
    );

    const first = await get(app, `/api/github/installations/${row.id}/repos`, cookie).expect(200);
    expect(repoPageSchema.parse(first.body).items).toHaveLength(100);
    expect(repoPageSchema.parse(first.body).items[0]).toEqual({
      id: 1,
      name: "repo-1",
      fullName: "enes/repo-1",
      private: false,
      defaultBranch: "main",
    });
    expect(repoPageSchema.parse(first.body).nextCursor).toBe("2");

    const second = await get(
      app,
      `/api/github/installations/${row.id}/repos?cursor=2`,
      cookie,
    ).expect(200);
    expect(repoPageSchema.parse(second.body).items).toHaveLength(50);
    expect(repoPageSchema.parse(second.body).nextCursor).toBeNull();

    // The second request reused the cached token.
    expect(github.tokenRequests).toBe(1);
  });

  it("requires a session", async () => {
    const { user } = await userWithSession();
    const row = await addInstallation(user.id, 11);
    await get(makeApp(), `/api/github/installations/${row.id}/repos`).expect(401);
  });

  it("answers 403 for another user's installation, without calling GitHub", async () => {
    const app = makeApp();
    const { cookie } = await userWithSession();
    const other = await userWithSession(2002);
    const row = await addInstallation(other.user.id, 13);
    github.installations.set(13, [fakeRepo(1)]);

    const res = await get(app, `/api/github/installations/${row.id}/repos`, cookie).expect(403);
    expect(apiErrorSchema.parse(res.body).error.code).toBe("forbidden");
    expect(github.tokenRequests).toBe(0);
  });

  it("answers 404 for an unknown installation", async () => {
    const { cookie } = await userWithSession();
    await get(
      makeApp(),
      "/api/github/installations/00000000-0000-4000-8000-000000000000/repos",
      cookie,
    ).expect(404);
  });

  it.each([
    ["a malformed ID", "/api/github/installations/11/repos"],
    [
      "a malformed cursor",
      "/api/github/installations/00000000-0000-4000-8000-000000000000/repos?cursor=0",
    ],
    [
      "a cursor past the cap",
      "/api/github/installations/00000000-0000-4000-8000-000000000000/repos?cursor=1000",
    ],
  ])("answers 400 for %s", async (_label, path) => {
    const { cookie } = await userWithSession();
    const res = await get(makeApp(), path, cookie).expect(400);
    expect(apiErrorSchema.parse(res.body).error.code).toBe("validation_failed");
  });

  it("answers 409 for a suspended installation", async () => {
    const { user, cookie } = await userWithSession();
    const row = await addInstallation(user.id, 11, { suspendedAt: new Date() });
    await get(makeApp(), `/api/github/installations/${row.id}/repos`, cookie).expect(409);
  });

  it("answers 409 when GitHub suspended the installation after the last sign-in", async () => {
    const { user, cookie } = await userWithSession();
    const row = await addInstallation(user.id, 11); // not suspended in Liman's row
    github.installations.set(11, [fakeRepo(1)]);
    github.suspended.add(11);
    const res = await get(makeApp(), `/api/github/installations/${row.id}/repos`, cookie).expect(
      409,
    );
    expect(apiErrorSchema.parse(res.body).error.message).toBe(
      "Installation is suspended on GitHub",
    );
  });

  it("answers 404 when the App was uninstalled on GitHub", async () => {
    const { user, cookie } = await userWithSession();
    const row = await addInstallation(user.id, 11); // GitHub does not know 11
    const res = await get(makeApp(), `/api/github/installations/${row.id}/repos`, cookie).expect(
      404,
    );
    expect(apiErrorSchema.parse(res.body).error.message).toBe(
      "Installation no longer exists on GitHub",
    );
  });

  it("answers 502 when GitHub fails, and keeps tokens out of the logs", async () => {
    const app = makeApp();
    const { user, cookie } = await userWithSession();
    const row = await addInstallation(user.id, 11);
    github.installations.set(11, [fakeRepo(1)]);
    github.failWith = 500;

    const res = await get(app, `/api/github/installations/${row.id}/repos`, cookie).expect(502);
    expect(res.body).toEqual({
      error: { code: "upstream_failed", message: "GitHub request failed" },
    });

    const logs = logLines.join("");
    expect(logs).toContain('"reason":"repos_http_500"');
    expect(github.tokens.size).toBe(1);
    for (const token of github.tokens.keys()) {
      expect(logs).not.toContain(token);
    }
    expect(logs).not.toContain("ghs_");
  });
});

describe("GET /api/github/installations/:id/repos/:repoId/branches", () => {
  it("lists the branches of a repository the installation can access", async () => {
    const app = makeApp();
    const { user, cookie } = await userWithSession();
    const row = await addInstallation(user.id, 11);
    github.installations.set(11, [fakeRepo(5, ["main", "dev"])]);

    const res = await get(
      app,
      `/api/github/installations/${row.id}/repos/5/branches`,
      cookie,
    ).expect(200);
    expect(res.body).toEqual({
      items: [
        { name: "main", commitSha: "0".repeat(40) },
        { name: "dev", commitSha: `${"0".repeat(39)}1` },
      ],
      nextCursor: null,
    });
  });

  it("answers 404 for a public repository outside the installation", async () => {
    const app = makeApp();
    const { user, cookie } = await userWithSession();
    const mine = await addInstallation(user.id, 11);
    github.installations.set(11, [fakeRepo(5)]);
    // Public and in another installation: GitHub would serve it to installation 11's token.
    github.installations.set(12, [fakeRepo(6)]);

    const res = await get(
      app,
      `/api/github/installations/${mine.id}/repos/6/branches`,
      cookie,
    ).expect(404);
    expect(apiErrorSchema.parse(res.body).error.message).toBe(
      "Repository not found in this installation",
    );
  });

  it("answers 403 for another user's installation", async () => {
    const { cookie } = await userWithSession();
    const other = await userWithSession(2002);
    const row = await addInstallation(other.user.id, 13);
    github.installations.set(13, [fakeRepo(5)]);
    await get(makeApp(), `/api/github/installations/${row.id}/repos/5/branches`, cookie).expect(
      403,
    );
    expect(github.tokenRequests).toBe(0);
  });

  it("pages through branches", async () => {
    const app = makeApp();
    const { user, cookie } = await userWithSession();
    const row = await addInstallation(user.id, 11);
    github.installations.set(11, [
      fakeRepo(
        5,
        Array.from({ length: 120 }, (_, i) => `b${String(i)}`),
      ),
    ]);
    const path = `/api/github/installations/${row.id}/repos/5/branches`;

    const first = branchPageSchema.parse((await get(app, path, cookie).expect(200)).body);
    expect(first.items).toHaveLength(100);
    expect(first.nextCursor).toBe("2");
    const second = branchPageSchema.parse(
      (await get(app, `${path}?cursor=2`, cookie).expect(200)).body,
    );
    expect(second.items.map((b) => b.name)).toEqual(
      Array.from({ length: 20 }, (_, i) => `b${String(i + 100)}`),
    );
    expect(second.nextCursor).toBeNull();
  });

  it("answers 502 when the repository lookup fails on GitHub", async () => {
    const { user, cookie } = await userWithSession();
    const row = await addInstallation(user.id, 11);
    github.installations.set(11, [fakeRepo(5)]);
    github.failWith = 503;
    const res = await get(
      makeApp(),
      `/api/github/installations/${row.id}/repos/5/branches`,
      cookie,
    ).expect(502);
    expect(apiErrorSchema.parse(res.body).error.code).toBe("upstream_failed");
  });

  it("answers 400 for a repository ID too large to be exact", async () => {
    const { user, cookie } = await userWithSession();
    const row = await addInstallation(user.id, 11);
    await get(
      makeApp(),
      `/api/github/installations/${row.id}/repos/9007199254740993/branches`,
      cookie,
    ).expect(400);
  });

  it("answers 400 for a malformed repository ID", async () => {
    const { user, cookie } = await userWithSession();
    const row = await addInstallation(user.id, 11);
    await get(makeApp(), `/api/github/installations/${row.id}/repos/abc/branches`, cookie).expect(
      400,
    );
  });
});

describe("toCursorPage", () => {
  it("points at the next page while there is one", () => {
    expect(toCursorPage({ items: [1], hasNext: true }, 3)).toEqual({ items: [1], nextCursor: "4" });
    expect(toCursorPage({ items: [1], hasNext: false }, 3).nextCursor).toBeNull();
  });

  it("stops at the last page a cursor can address", () => {
    expect(toCursorPage({ items: [], hasNext: true }, MAX_CURSOR_PAGE).nextCursor).toBeNull();
  });
});
