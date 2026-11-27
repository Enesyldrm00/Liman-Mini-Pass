/**
 * Integration tests for `/api/apps` and `/api/apps/:id/env` against real Postgres and
 * Redis (Testcontainers). GitHub is an in-memory stand-in for the App client; the real
 * client is covered in github/app.test.ts and github.test.ts. The pipeline queue is a real
 * BullMQ queue, so the tests read the jobs back from Redis.
 */
import { createSecretKey, randomBytes } from "node:crypto";
import { Writable } from "node:stream";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import {
  apps,
  createDb,
  createEnvCipher,
  envVars,
  githubInstallations,
  runMigrations,
  users,
  type DbClient,
} from "@liman/db";
import {
  PIPELINE_QUEUE,
  apiErrorSchema,
  appPageSchema,
  appSchema,
  envListSchema,
  type Branch,
  type CleanupAppJob,
  type JobName,
  type Repo,
} from "@liman/shared";
import { Queue, Worker } from "bullmq";
import { eq, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import type { GitHubAuth } from "../auth/github.js";
import { createSessionStore } from "../auth/sessions.js";
import type { Config } from "../config/index.js";
import { GitHubApiError, type GitHubApp } from "../github/app.js";
import { syncInstallations } from "../github/installations.js";
import { createLogger } from "../logger.js";
import { PIPELINE_JOB_OPTIONS, pipelineQueueFrom } from "../queue.js";
import { APP_PAGE_SIZE } from "./apps.js";
import { apiRoutes } from "./index.js";

const PUBLIC_URL = "http://liman.localhost";
const ALLOWED_ID = 1001;
const OTHER_ID = 2002;

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let dbClient: DbClient;
let redis: Redis;
let queue: Queue<CleanupAppJob, void, JobName>;

beforeAll(async () => {
  [pgContainer, redisContainer] = await Promise.all([
    new PostgreSqlContainer("postgres:18.6-alpine").start(),
    new RedisContainer("redis:8.10.3-alpine").start(),
  ]);
  dbClient = createDb(pgContainer.getConnectionUri());
  await runMigrations(dbClient.db);
  redis = new Redis(redisContainer.getConnectionUrl());
  queue = new Queue(PIPELINE_QUEUE, {
    connection: { url: redisContainer.getConnectionUrl() },
    defaultJobOptions: PIPELINE_JOB_OPTIONS,
  });
});

afterAll(async () => {
  await Promise.all([dbClient.close(), redis.quit(), queue.close()]);
  await Promise.all([pgContainer.stop(), redisContainer.stop()]);
});

// ---------------------------------------------------------------------------------------
// GitHub stand-in: installation ID → repositories, repo ID → branches.

const github = {
  repos: new Map<number, Repo[]>(),
  branches: new Map<number, string[]>(),
  /** Branch name → the name GitHub redirects it to (a renamed branch). */
  renamed: new Map<string, string>(),
  /** When set, `getBranch` waits for it; `onBranchLookup` fires when the wait starts. */
  branchGate: null as Promise<void> | null,
  onBranchLookup: null as (() => void) | null,
  fail: false,
};

const repo = (id: number): Repo => ({
  id,
  name: `repo-${String(id)}`,
  fullName: `enes/repo-${String(id)}`,
  private: false,
  defaultBranch: "main",
});

const fakeGitHubApp: GitHubApp = {
  listRepos: () => Promise.reject(new Error("not used")),
  listBranches: () => Promise.reject(new Error("not used")),
  findInstalledRepo(installationId, repoId) {
    if (github.fail) return Promise.reject(new GitHubApiError("repos_http_500", 500));
    return Promise.resolve(github.repos.get(installationId)?.find((r) => r.id === repoId) ?? null);
  },
  async getBranch(_installationId, fullName, branch): Promise<Branch | null> {
    github.onBranchLookup?.();
    if (github.branchGate) await github.branchGate;
    const id = Number(fullName.split("-").at(-1));
    const name = github.renamed.get(branch) ?? branch;
    const found = github.branches.get(id)?.includes(name);
    return found ? { name, commitSha: "a".repeat(40) } : null;
  },
};

// ---------------------------------------------------------------------------------------
// App under test

const unusedAuth: GitHubAuth = {
  authorizeUrl: () => "https://github.test/authorize",
  withUser: () => Promise.reject(new Error("not used")),
};

const encryptionKey = createSecretKey(randomBytes(32));
const cipher = createEnvCipher(encryptionKey);

const config: Config = {
  nodeEnv: "test",
  logLevel: "debug",
  port: 0,
  publicUrl: PUBLIC_URL,
  baseDomain: "localhost",
  databaseUrl: "unused",
  redisUrl: "unused",
  encryptionKey,
  allowedGithubIds: new Set([String(ALLOWED_ID), String(OTHER_ID)]),
  sessionTtlHours: 1,
  github: {
    clientId: "unused",
    clientSecret: "unused",
    appId: 1,
    appSlug: "liman-test",
    privateKey: createSecretKey(randomBytes(32)),
  },
};

/** Everything the API logged during the current test. */
let logLines: string[] = [];

function makeApp(overrides: Partial<Config> = {}) {
  const destination = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logLines.push(chunk.toString());
      done();
    },
  });
  return createApp({
    logger: createLogger({ logLevel: "debug" }, destination),
    registerRoutes: apiRoutes({
      config: { ...config, ...overrides },
      db: dbClient.db,
      redis,
      github: unusedAuth,
      githubApp: fakeGitHubApp,
      sessions: createSessionStore(dbClient.db, { ttlHours: 1 }),
      envCipher: cipher,
      pipeline: pipelineQueueFrom(queue),
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

/** A signed-in user with installation 11 holding repo 501 (branches main, dev). */
async function setup() {
  const app = makeApp();
  const owner = await userWithSession();
  const installation = await addInstallation(owner.user.id, 11);
  github.repos.set(11, [repo(501)]);
  github.branches.set(501, ["main", "dev", "feature/login"]);
  return { app, owner, installation };
}

const createBody = (installationId: string, extra: Record<string, unknown> = {}) => ({
  name: "Blog",
  subdomain: "blog",
  installationId,
  repoId: 501,
  branch: "main",
  port: 3000,
  ...extra,
});

/** A write request with the panel's Origin, as a browser would send it. */
function write(
  app: App,
  method: "post" | "patch" | "put" | "delete",
  path: string,
  cookie: string,
) {
  return request(app)[method](path).set("Cookie", cookie).set("Origin", PUBLIC_URL);
}

const get = (app: App, path: string, cookie?: string) => {
  const req = request(app).get(path);
  return cookie ? req.set("Cookie", cookie) : req;
};

async function postApp(app: App, cookie: string, installationId: string, extra = {}) {
  const res = await write(app, "post", "/api/apps", cookie)
    .send(createBody(installationId, extra))
    .expect(201);
  return appSchema.parse(res.body);
}

/**
 * Waits until another session is blocked on a row lock, so the test knows the concurrent
 * step really reached the lock instead of finishing early on another path.
 */
async function waitUntilSomeoneWaitsForALock(): Promise<void> {
  for (let i = 0; i < 100; i += 1) {
    const result = await dbClient.pool.query<{ n: string }>(
      "select count(*) as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()",
    );
    if (Number(result.rows[0]?.n) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("nobody started waiting for the lock");
}

const jobsInRedis = async () => {
  const jobs = await queue.getJobs(["waiting", "active", "completed", "failed", "delayed"]);
  return jobs.map((job) => ({ id: job.id, name: job.name, data: job.data }));
};

beforeEach(async () => {
  await dbClient.db.execute(sql`truncate users, sessions, github_installations, apps cascade`);
  await queue.obliterate({ force: true });
  github.repos.clear();
  github.branches.clear();
  github.renamed.clear();
  github.branchGate = null;
  github.onBranchLookup = null;
  github.fail = false;
  logLines = [];
});

// ---------------------------------------------------------------------------------------

describe("POST /api/apps", () => {
  it("requires a session", async () => {
    await request(makeApp()).post("/api/apps").set("Origin", PUBLIC_URL).send({}).expect(401);
  });

  it("rejects a write from another origin before anything else runs (CSRF)", async () => {
    const { app, owner, installation } = await setup();
    const res = await request(app)
      .post("/api/apps")
      .set("Cookie", owner.cookie)
      .set("Origin", "http://evil.localhost")
      .send(createBody(installation.id))
      .expect(403);
    expect(res.body).toEqual({ error: { code: "forbidden", message: "Origin not allowed" } });
    expect(await dbClient.db.$count(apps)).toBe(0);
  });

  it("creates an app for a repository and branch of the user's installation", async () => {
    const { app, owner, installation } = await setup();
    const res = await write(app, "post", "/api/apps", owner.cookie)
      .send(createBody(installation.id, { healthPath: "/healthz" }))
      .expect(201);

    const body = appSchema.parse(res.body);
    expect(body).toMatchObject({
      name: "Blog",
      subdomain: "blog",
      url: "http://blog.localhost",
      installationId: installation.id,
      repoId: 501,
      repoFullName: "enes/repo-501",
      branch: "main",
      port: 3000,
      healthPath: "/healthz",
      status: "active",
    });
    const [row] = await dbClient.db.select().from(apps).where(eq(apps.id, body.id));
    expect(row).toMatchObject({ ownerId: owner.user.id, repoId: 501 });
  });

  it("defaults the health path to /", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    expect(created.healthPath).toBe("/");
  });

  it.each([
    ["reserved subdomain", { subdomain: "api" }, "subdomain"],
    ["upper-case subdomain", { subdomain: "Blog" }, "subdomain"],
    ["leading hyphen", { subdomain: "-blog" }, "subdomain"],
    ["punycode", { subdomain: "xn--blog" }, "subdomain"],
    ["41 characters", { subdomain: "a".repeat(41) }, "subdomain"],
    ["port out of range", { port: 70000 }, "port"],
    ["health path without slash", { healthPath: "healthz" }, "healthPath"],
    ["bad branch name", { branch: "a..b" }, "branch"],
  ])("rejects a %s with 400 and the field", async (_name, extra, field) => {
    const { app, owner, installation } = await setup();
    const res = await write(app, "post", "/api/apps", owner.cookie)
      .send(createBody(installation.id, extra))
      .expect(400);
    const body = apiErrorSchema.parse(res.body);
    expect(body.error.code).toBe("validation_failed");
    expect(body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: field })]),
    );
    expect(await dbClient.db.$count(apps)).toBe(0);
  });

  it("answers 400, not 500, for a body that is not JSON", async () => {
    const { app, owner } = await setup();
    const res = await write(app, "post", "/api/apps", owner.cookie)
      .set("Content-Type", "application/json")
      .send('{"name": "secret-ish')
      .expect(400);
    expect(res.body).toEqual({
      error: { code: "validation_failed", message: "Request body is not valid JSON" },
    });
    expect(logLines.join("")).not.toContain("secret-ish");
  });

  it("answers 413 for a body over the limit", async () => {
    const { app, owner, installation } = await setup();
    await write(app, "post", "/api/apps", owner.cookie)
      .send(createBody(installation.id, { name: "x".repeat(20_000) }))
      .expect(413);
  });

  it("refuses someone else's installation", async () => {
    const { app, owner } = await setup();
    const other = await userWithSession(OTHER_ID);
    const theirs = await addInstallation(other.user.id, 22);
    github.repos.set(22, [repo(501)]);
    await write(app, "post", "/api/apps", owner.cookie).send(createBody(theirs.id)).expect(403);
    expect(await dbClient.db.$count(apps)).toBe(0);
  });

  it("answers 404 for an unknown installation and 409 for a suspended one", async () => {
    const { app, owner } = await setup();
    await write(app, "post", "/api/apps", owner.cookie)
      .send(createBody("00000000-0000-4000-8000-000000000000"))
      .expect(404);
    const suspended = await addInstallation(owner.user.id, 12, { suspendedAt: new Date() });
    await write(app, "post", "/api/apps", owner.cookie).send(createBody(suspended.id)).expect(409);
  });

  it("refuses a repository that is not in the installation (even a public one)", async () => {
    const { app, owner, installation } = await setup();
    github.repos.set(99, [repo(777)]); // someone else's public repo, another installation
    const res = await write(app, "post", "/api/apps", owner.cookie)
      .send(createBody(installation.id, { repoId: 777 }))
      .expect(404);
    expect(apiErrorSchema.parse(res.body).error.message).toBe(
      "Repository not found in this installation",
    );
  });

  it("refuses a branch the repository does not have", async () => {
    const { app, owner, installation } = await setup();
    const res = await write(app, "post", "/api/apps", owner.cookie)
      .send(createBody(installation.id, { branch: "gh-pages" }))
      .expect(400);
    expect(apiErrorSchema.parse(res.body).error.details).toEqual([
      { path: "branch", message: "Branch not found in the repository" },
    ]);
  });

  it("answers 502 when GitHub fails", async () => {
    const { app, owner, installation } = await setup();
    github.fail = true;
    await write(app, "post", "/api/apps", owner.cookie)
      .send(createBody(installation.id))
      .expect(502);
  });

  it("answers 409 for a subdomain that is taken, also by another user", async () => {
    const { app, owner, installation } = await setup();
    await postApp(app, owner.cookie, installation.id);
    const res = await write(app, "post", "/api/apps", owner.cookie)
      .send(createBody(installation.id, { name: "Second" }))
      .expect(409);
    expect(apiErrorSchema.parse(res.body).error.details).toEqual([
      { path: "subdomain", message: "Subdomain is already taken" },
    ]);
  });

  it("refuses the panel's own host as a subdomain", async () => {
    const panel = "http://panel.localhost";
    const { owner, installation } = await setup();
    const app = makeApp({ publicUrl: panel });
    const res = await request(app)
      .post("/api/apps")
      .set("Cookie", owner.cookie)
      .set("Origin", panel)
      .send(createBody(installation.id, { subdomain: "panel" }))
      .expect(400);
    expect(apiErrorSchema.parse(res.body).error.details).toEqual([
      { path: "subdomain", message: "This name is reserved" },
    ]);
    expect(await dbClient.db.$count(apps)).toBe(0);
  });

  it("refuses a branch GitHub only knows under a new name", async () => {
    const { app, owner, installation } = await setup();
    github.renamed.set("old-name", "dev");
    await write(app, "post", "/api/apps", owner.cookie)
      .send(createBody(installation.id, { branch: "old-name" }))
      .expect(400);
  });

  it("lets exactly one of two concurrent requests take a subdomain", async () => {
    const { app, owner, installation } = await setup();
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        write(app, "post", "/api/apps", owner.cookie).send(
          createBody(installation.id, { name: `Race ${String(i)}` }),
        ),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409, 409, 409]);
    expect(await dbClient.db.$count(apps)).toBe(1);
  });

  it("does not break a sign-in sync that runs while the app is being inserted", async () => {
    // 0.8 note: the sync deletes installations GitHub no longer reports, unless an app
    // uses them. An app inserted concurrently used to slip past that check and the
    // RESTRICT foreign key failed the whole sign-in.
    const { owner, installation } = await setup();
    const client = await dbClient.pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from github_installations where id = $1 for key share", [
        installation.id,
      ]);
      await client.query(
        `insert into apps (owner_id, installation_ref, name, subdomain, repo_id, repo_full_name, branch, port)
         values ($1, $2, 'Race', 'race', 501, 'enes/repo-501', 'main', 3000)`,
        [owner.user.id, installation.id],
      );
      // GitHub no longer reports installation 11 for this user.
      const sync = syncInstallations(dbClient.db, owner.user.id, []);
      await waitUntilSomeoneWaitsForALock();
      await client.query("commit");
      await expect(sync).resolves.toMatchObject({ removed: 0, keptWithApps: 1 });
    } finally {
      client.release();
    }
    expect(await dbClient.db.$count(githubInstallations)).toBe(1);
  });

  it("answers 404 when a sync removed the installation just before the insert", async () => {
    const { app, owner, installation } = await setup();
    const client = await dbClient.pool.connect();
    try {
      await client.query("begin");
      await client.query("select id from github_installations where id = $1 for update", [
        installation.id,
      ]);
      const create = write(app, "post", "/api/apps", owner.cookie)
        .send(createBody(installation.id))
        .then((res) => res);
      await waitUntilSomeoneWaitsForALock();
      await client.query("delete from github_installations where id = $1", [installation.id]);
      await client.query("commit");
      const res = await create;
      expect(res.status).toBe(404);
    } finally {
      client.release();
    }
    expect(await dbClient.db.$count(apps)).toBe(0);
  });
});

describe("GET /api/apps", () => {
  it("requires a session", async () => {
    await get(makeApp(), "/api/apps").expect(401);
  });

  it("lists only the user's own apps, by subdomain, page by page", async () => {
    const { app, owner, installation } = await setup();
    const other = await userWithSession(OTHER_ID);
    const theirs = await addInstallation(other.user.id, 22);
    const rows = Array.from({ length: APP_PAGE_SIZE + 3 }, (_, i) => ({
      ownerId: owner.user.id,
      installationRef: installation.id,
      name: `App ${String(i)}`,
      subdomain: `app-${String(i).padStart(3, "0")}`,
      repoId: 501,
      repoFullName: "enes/repo-501",
      branch: "main",
      port: 3000,
    }));
    await dbClient.db.insert(apps).values(rows);
    await dbClient.db.insert(apps).values({
      ...rows[0],
      ownerId: other.user.id,
      installationRef: theirs.id,
      subdomain: "aaa-theirs",
    } as (typeof rows)[number]);

    const first = appPageSchema.parse((await get(app, "/api/apps", owner.cookie).expect(200)).body);
    expect(first.items).toHaveLength(APP_PAGE_SIZE);
    expect(first.items[0]?.subdomain).toBe("app-000");
    expect(first.nextCursor).not.toBeNull();
    const second = appPageSchema.parse(
      (await get(app, `/api/apps?cursor=${first.nextCursor ?? ""}`, owner.cookie).expect(200)).body,
    );
    expect(second.items.map((a) => a.subdomain)).toEqual(["app-050", "app-051", "app-052"]);
    expect(second.nextCursor).toBeNull();
  });

  it("rejects a malformed cursor", async () => {
    const { app, owner } = await setup();
    await get(app, "/api/apps?cursor=not%20valid!", owner.cookie).expect(400);
  });
});

describe("GET /api/apps/:id", () => {
  it("returns the app to its owner only", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    await get(app, `/api/apps/${created.id}`, owner.cookie).expect(200);
    const other = await userWithSession(OTHER_ID);
    await get(app, `/api/apps/${created.id}`, other.cookie).expect(403);
    await get(app, "/api/apps/00000000-0000-4000-8000-000000000000", owner.cookie).expect(404);
    await get(app, "/api/apps/not-a-uuid", owner.cookie).expect(400);
  });
});

describe("PATCH /api/apps/:id", () => {
  it("changes branch, port and health path", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    const res = await write(app, "patch", `/api/apps/${created.id}`, owner.cookie)
      .send({ branch: "feature/login", port: 8080, healthPath: "/up" })
      .expect(200);
    expect(appSchema.parse(res.body)).toMatchObject({
      branch: "feature/login",
      port: 8080,
      healthPath: "/up",
      subdomain: "blog",
    });
  });

  it("checks a new branch on GitHub", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    await write(app, "patch", `/api/apps/${created.id}`, owner.cookie)
      .send({ branch: "gh-pages" })
      .expect(400);
  });

  it.each([
    ["subdomain", { subdomain: "other" }],
    ["name", { name: "Other" }],
    ["nothing", {}],
  ])("does not change %s", async (_name, body) => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    await write(app, "patch", `/api/apps/${created.id}`, owner.cookie).send(body).expect(400);
  });

  it("loses to a DELETE that lands while it checks the branch on GitHub", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    let release: () => void = () => undefined;
    github.branchGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const lookupStarted = new Promise<void>((resolve) => {
      github.onBranchLookup = resolve;
    });

    const patch = write(app, "patch", "/api/apps/" + created.id, owner.cookie)
      .send({ branch: "dev" })
      .then((res) => res);
    await lookupStarted;
    github.branchGate = null;
    await write(app, "delete", "/api/apps/" + created.id, owner.cookie).expect(202);
    release();

    expect((await patch).status).toBe(409);
    const [row] = await dbClient.db.select().from(apps).where(eq(apps.id, created.id));
    expect(row).toMatchObject({ status: "deleting", branch: "main" });
  });

  it("refuses someone else's app", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    const other = await userWithSession(OTHER_ID);
    await write(app, "patch", `/api/apps/${created.id}`, other.cookie)
      .send({ port: 1 })
      .expect(403);
  });

  it("answers 409 once the app is being deleted", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    await write(app, "delete", `/api/apps/${created.id}`, owner.cookie).expect(202);
    await write(app, "patch", `/api/apps/${created.id}`, owner.cookie)
      .send({ port: 1 })
      .expect(409);
  });
});

describe("DELETE /api/apps/:id", () => {
  it("marks the app deleting, queues cleanup-app and answers 202", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    const res = await write(app, "delete", `/api/apps/${created.id}`, owner.cookie).expect(202);

    expect(appSchema.parse(res.body).status).toBe("deleting");
    const [row] = await dbClient.db.select().from(apps).where(eq(apps.id, created.id));
    expect(row?.status).toBe("deleting");
    expect(await jobsInRedis()).toEqual([
      { id: created.id, name: "cleanup-app", data: { appId: created.id } },
    ]);
  });

  it("can be repeated: still 202, still one job", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    await write(app, "delete", `/api/apps/${created.id}`, owner.cookie).expect(202);
    await write(app, "delete", `/api/apps/${created.id}`, owner.cookie).expect(202);
    expect(await jobsInRedis()).toHaveLength(1);
  });

  it("re-queues an app left deleting without a job (API crashed before the queue write)", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    await dbClient.db.update(apps).set({ status: "deleting" }).where(eq(apps.id, created.id));
    expect(await jobsInRedis()).toHaveLength(0);
    await write(app, "delete", `/api/apps/${created.id}`, owner.cookie).expect(202);
    expect(await jobsInRedis()).toHaveLength(1);
  });

  it("retries a cleanup job that failed", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    await write(app, "delete", `/api/apps/${created.id}`, owner.cookie).expect(202);
    // A worker that fails the job (attempts: 1, so it stays failed).
    const worker = new Worker<CleanupAppJob, void, JobName>(
      PIPELINE_QUEUE,
      () => Promise.reject(new Error("worker broke")),
      { connection: { url: redisContainer.getConnectionUrl() } },
    );
    await new Promise<void>((resolve) =>
      worker.once("failed", () => {
        resolve();
      }),
    );
    await worker.close();
    expect(await (await queue.getJob(created.id))?.isFailed()).toBe(true);

    await write(app, "delete", `/api/apps/${created.id}`, owner.cookie).expect(202);
    expect(await (await queue.getJob(created.id))?.isFailed()).toBe(false);
    expect(await jobsInRedis()).toHaveLength(1);
  });

  it("refuses someone else's app and a cross-origin request", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    const other = await userWithSession(OTHER_ID);
    await write(app, "delete", `/api/apps/${created.id}`, other.cookie).expect(403);
    await request(app)
      .delete(`/api/apps/${created.id}`)
      .set("Cookie", owner.cookie)
      .set("Origin", "http://evil.localhost")
      .expect(403);
    expect(await jobsInRedis()).toHaveLength(0);
  });

  it("keeps the subdomain taken while the app is being deleted", async () => {
    const { app, owner, installation } = await setup();
    const created = await postApp(app, owner.cookie, installation.id);
    await write(app, "delete", `/api/apps/${created.id}`, owner.cookie).expect(202);
    await write(app, "post", "/api/apps", owner.cookie)
      .send(createBody(installation.id))
      .expect(409);
  });
});

// ---------------------------------------------------------------------------------------

describe("env", () => {
  const SECRET = "postgres://user:hunter2-very-secret@db/app";

  async function appWithEnv() {
    const ctx = await setup();
    const created = await postApp(ctx.app, ctx.owner.cookie, ctx.installation.id);
    const path = `/api/apps/${created.id}/env`;
    return { ...ctx, created, path };
  }

  const storedRows = (appId: string) =>
    dbClient.db.select().from(envVars).where(eq(envVars.appId, appId)).orderBy(envVars.key);

  it("stores values encrypted and returns keys only", async () => {
    const { app, owner, created, path } = await appWithEnv();
    const res = await write(app, "put", path, owner.cookie)
      .send({
        vars: [
          { key: "DATABASE_URL", value: SECRET },
          { key: "MODE", value: "prod" },
        ],
      })
      .expect(200);

    const body = envListSchema.parse(res.body);
    expect(body.vars.map((v) => v.key)).toEqual(["DATABASE_URL", "MODE"]);
    expect(JSON.stringify(res.body)).not.toContain(SECRET);

    const rows = await storedRows(created.id);
    expect(rows.every((row) => row.valueEnc.startsWith("v1:"))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain("hunter2");
    expect(cipher.decrypt(created.id, "DATABASE_URL", rows[0]?.valueEnc ?? "")).toBe(SECRET);

    const read = await get(app, path, owner.cookie).expect(200);
    expect(read.body).toEqual(body);
    expect(JSON.stringify(read.body)).not.toContain(SECRET);
  });

  it("keeps a value sent without one (or empty) and deletes keys left out", async () => {
    const { app, owner, created, path } = await appWithEnv();
    await write(app, "put", path, owner.cookie)
      .send({
        vars: [
          { key: "A", value: "1" },
          { key: "B", value: "2" },
          { key: "C", value: "3" },
        ],
      })
      .expect(200);
    const before = await storedRows(created.id);

    await write(app, "put", path, owner.cookie)
      .send({ vars: [{ key: "A" }, { key: "B", value: "" }, { key: "D", value: "4" }] })
      .expect(200);

    const after = await storedRows(created.id);
    expect(after.map((row) => row.key)).toEqual(["A", "B", "D"]);
    // Kept values are untouched: same ciphertext, same updated_at.
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual(before[1]);
    expect(cipher.decrypt(created.id, "D", after[2]?.valueEnc ?? "")).toBe("4");
  });

  it("re-encrypts a changed value", async () => {
    const { app, owner, created, path } = await appWithEnv();
    await write(app, "put", path, owner.cookie).send({ vars: [{ key: "A", value: "1" }] });
    await write(app, "put", path, owner.cookie).send({ vars: [{ key: "A", value: "2" }] });
    const [row] = await storedRows(created.id);
    expect(cipher.decrypt(created.id, "A", row?.valueEnc ?? "")).toBe("2");
  });

  it("deletes everything for an empty list", async () => {
    const { app, owner, created, path } = await appWithEnv();
    await write(app, "put", path, owner.cookie).send({ vars: [{ key: "A", value: "1" }] });
    await write(app, "put", path, owner.cookie).send({ vars: [] }).expect(200);
    expect(await storedRows(created.id)).toHaveLength(0);
  });

  it("refuses a new key without a value and changes nothing", async () => {
    const { app, owner, created, path } = await appWithEnv();
    await write(app, "put", path, owner.cookie).send({ vars: [{ key: "A", value: "1" }] });
    const res = await write(app, "put", path, owner.cookie)
      .send({ vars: [{ key: "B", value: "2" }, { key: "NEW" }] })
      .expect(400);
    expect(apiErrorSchema.parse(res.body).error.details).toEqual([
      { path: "vars.1.value", message: "NEW is new and needs a value" },
    ]);
    expect((await storedRows(created.id)).map((row) => row.key)).toEqual(["A"]);
  });

  it.each([
    ["reserved PORT", [{ key: "PORT", value: "1" }]],
    ["reserved LIMAN_ prefix", [{ key: "LIMAN_TOKEN", value: "1" }]],
    ["bad key", [{ key: "lower-case", value: "1" }]],
    [
      "101 variables",
      Array.from({ length: 101 }, (_, i) => ({ key: `K${String(i)}`, value: "v" })),
    ],
    ["value over 32 KB", [{ key: "BIG", value: "x".repeat(32 * 1024 + 1) }]],
  ])("rejects %s", async (_name, vars) => {
    const { app, owner, created, path } = await appWithEnv();
    await write(app, "put", path, owner.cookie).send({ vars }).expect(400);
    expect(await storedRows(created.id)).toHaveLength(0);
  });

  it("accepts a 32 KB value, more than the apps router's JSON limit", async () => {
    const { app, owner, path } = await appWithEnv();
    await write(app, "put", path, owner.cookie)
      .send({ vars: [{ key: "BIG", value: "x".repeat(32 * 1024) }] })
      .expect(200);
  });

  it("never logs or echoes values, also on errors", async () => {
    const { app, owner, path } = await appWithEnv();
    await write(app, "put", path, owner.cookie).send({ vars: [{ key: "A", value: SECRET }] });
    const bad = await write(app, "put", path, owner.cookie)
      .send({ vars: [{ key: "bad key", value: SECRET }] })
      .expect(400);
    expect(JSON.stringify(bad.body)).not.toContain("hunter2");
    expect(logLines.join("\n")).not.toContain("hunter2");
  });

  it("is only for the owner, and not for a cross-origin write", async () => {
    const { app, owner, path } = await appWithEnv();
    const other = await userWithSession(OTHER_ID);
    await get(app, path, other.cookie).expect(403);
    await write(app, "put", path, other.cookie).send({ vars: [] }).expect(403);
    await request(app)
      .put(path)
      .set("Cookie", owner.cookie)
      .set("Origin", "http://evil.localhost")
      .send({ vars: [] })
      .expect(403);
    await get(app, path).expect(401);
  });

  it("answers 409 once the app is being deleted", async () => {
    const { app, owner, created, path } = await appWithEnv();
    await write(app, "delete", `/api/apps/${created.id}`, owner.cookie).expect(202);
    await write(app, "put", path, owner.cookie)
      .send({ vars: [{ key: "A", value: "1" }] })
      .expect(409);
  });

  it("serialises concurrent replaces: the result is one of the lists, not a mix", async () => {
    const { app, owner, created, path } = await appWithEnv();
    const lists = Array.from({ length: 6 }, (_, i) => ({
      vars: [
        { key: `ONLY_${String(i)}`, value: String(i) },
        { key: "SHARED", value: String(i) },
      ],
    }));
    const results = await Promise.all(
      lists.map((body) => write(app, "put", path, owner.cookie).send(body)),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const keys = (await storedRows(created.id)).map((row) => row.key);
    expect(keys).toHaveLength(2);
    expect(keys).toContain("SHARED");
  });
});
