/**
 * Integration tests for sign-in, sessions, Origin checks and the sign-in rate limit,
 * against real Postgres and Redis (Testcontainers). GitHub is replaced by a fake.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer, type StartedRedisContainer } from "@testcontainers/redis";
import { createDb, runMigrations, sessions, users, type DbClient } from "@liman/db";
import { parseSetCookie, type SetCookie } from "cookie";
import { eq, sql } from "drizzle-orm";
import { Redis } from "ioredis";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { GitHubAuthError, type GitHubAuth, type GitHubUser } from "../auth/github.js";
import { createSessionStore } from "../auth/sessions.js";
import { hashToken } from "../auth/tokens.js";
import type { Config } from "../config/index.js";
import { createLogger } from "../logger.js";
import { apiRoutes } from "./index.js";

const PUBLIC_URL = "http://liman.localhost";
const ALLOWED_ID = 1001;

let pgContainer: StartedPostgreSqlContainer;
let redisContainer: StartedRedisContainer;
let dbClient: DbClient;
let redis: Redis;

beforeAll(async () => {
  // Same images as infra/compose.
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

/** What the fake GitHub answers; reset before every test. */
const gh: { user: GitHubUser; fail: boolean; calls: number } = {
  user: { id: ALLOWED_ID, login: "enes", avatarUrl: null },
  fail: false,
  calls: 0,
};

const fakeGitHub: GitHubAuth = {
  authorizeUrl: ({ state, redirectUri }) =>
    `https://github.test/authorize?${new URLSearchParams({ state, redirect_uri: redirectUri }).toString()}`,
  fetchUser: () => {
    gh.calls += 1;
    return gh.fail
      ? Promise.reject(new GitHubAuthError("bad_verification_code"))
      : Promise.resolve(gh.user);
  },
};

beforeEach(async () => {
  await dbClient.db.execute(sql`truncate users, sessions cascade`);
  await redis.flushall();
  gh.user = { id: ALLOWED_ID, login: "enes", avatarUrl: null };
  gh.fail = false;
  gh.calls = 0;
});

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    nodeEnv: "test",
    logLevel: "silent",
    port: 0,
    publicUrl: PUBLIC_URL,
    databaseUrl: "unused",
    redisUrl: "unused",
    allowedGithubIds: new Set([String(ALLOWED_ID)]),
    sessionTtlHours: 1,
    github: { clientId: "unused", clientSecret: "unused" },
    ...overrides,
  };
}

function makeApp(config: Config = makeConfig()) {
  const logger = createLogger({ logLevel: "silent" });
  return createApp({
    logger,
    registerRoutes: apiRoutes({
      config,
      db: dbClient.db,
      redis,
      github: fakeGitHub,
      sessions: createSessionStore(dbClient.db, { ttlHours: config.sessionTtlHours }),
    }),
  });
}

type App = ReturnType<typeof makeApp>;

function setCookies(res: request.Response): SetCookie[] {
  const raw: unknown = res.headers["set-cookie"];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === "string" ? [raw] : [];
  return list.map((header) => parseSetCookie(header));
}

function cookieNamed(res: request.Response, name: string): SetCookie | undefined {
  return setCookies(res).find((cookie) => cookie.name === name);
}

/** Starts sign-in and returns the state from the redirect, checking it matches the cookie. */
async function startLogin(app: App): Promise<string> {
  const res = await request(app).get("/api/auth/github/login").expect(302);
  const location = new URL(String(res.headers.location));
  const state = location.searchParams.get("state") ?? "";
  expect(location.searchParams.get("redirect_uri")).toBe(`${PUBLIC_URL}/api/auth/github/callback`);
  expect(cookieNamed(res, "liman_oauth_state")?.value).toBe(state);
  return state;
}

function callback(app: App, state: string, cookieState = state, extraCookie = "") {
  return request(app)
    .get("/api/auth/github/callback")
    .query({ code: "one-time-code", state })
    .set("Cookie", `liman_oauth_state=${cookieState}${extraCookie}`);
}

/** Full sign-in; returns the raw session token from the cookie. */
async function signIn(app: App): Promise<string> {
  const state = await startLogin(app);
  const res = await callback(app, state).expect(302);
  expect(res.headers.location).toBe(`${PUBLIC_URL}/`);
  const token = cookieNamed(res, "liman_session")?.value;
  expect(token).toBeTruthy();
  return token ?? "";
}

const countSessions = async () => (await dbClient.db.select().from(sessions)).length;
const countUsers = async () => (await dbClient.db.select().from(users)).length;

describe("sign-in", () => {
  it("opens a session and /api/me returns the user", async () => {
    const app = makeApp();
    const token = await signIn(app);

    const me = await request(app)
      .get("/api/me")
      .set("Cookie", `liman_session=${token}`)
      .expect(200);
    expect(me.body).toMatchObject({ githubId: ALLOWED_ID, login: "enes", avatarUrl: null });

    // Only the hash of the token is stored.
    const [row] = await dbClient.db.select().from(sessions);
    expect(row?.tokenHash).toBe(hashToken(token));
    expect(row?.tokenHash).not.toBe(token);
  });

  it("sets the session cookie httpOnly, SameSite=Lax, Path=/ and for the session lifetime", async () => {
    const app = makeApp(makeConfig({ sessionTtlHours: 2 }));
    const state = await startLogin(app);
    const res = await callback(app, state).expect(302);
    const cookie = cookieNamed(res, "liman_session");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 7200 });
    expect(cookie?.secure).toBeFalsy();
    expect(cookie?.domain).toBeUndefined();
    // The state cookie is single-use.
    expect(cookieNamed(res, "liman_oauth_state")?.value).toBe("");
  });

  it("uses __Host- prefixed, Secure cookies in production", async () => {
    const app = makeApp(makeConfig({ nodeEnv: "production" }));
    const res = await request(app).get("/api/auth/github/login").expect(302);
    const cookie = cookieNamed(res, "__Host-liman_oauth_state");
    expect(cookie).toMatchObject({ secure: true, path: "/", httpOnly: true });
    expect(cookie?.domain).toBeUndefined();
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const app = makeApp();
    const state = await startLogin(app);
    const res = await callback(app, state, "some-other-state").expect(400);
    expect(res.body).toEqual({
      error: { code: "validation_failed", message: "Invalid sign-in state" },
    });
    expect(cookieNamed(res, "liman_session")).toBeUndefined();
    expect(gh.calls).toBe(0);
    expect(await countSessions()).toBe(0);
  });

  it("rejects a callback without a state cookie", async () => {
    const app = makeApp();
    await request(app)
      .get("/api/auth/github/callback")
      .query({ code: "c", state: "anything" })
      .expect(400);
    expect(gh.calls).toBe(0);
  });

  it("does not create a user for a GitHub ID that is not on the allow list", async () => {
    gh.user = { id: 999, login: "enes", avatarUrl: null }; // same login, other account
    const app = makeApp();
    const state = await startLogin(app);
    const res = await callback(app, state).expect(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/?login_error=not_allowed`);
    expect(cookieNamed(res, "liman_session")).toBeUndefined();
    expect(await countUsers()).toBe(0);
    expect(await countSessions()).toBe(0);
  });

  it("sends the browser back with an error when GitHub rejects the code", async () => {
    gh.fail = true;
    const app = makeApp();
    const state = await startLogin(app);
    const res = await callback(app, state).expect(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/?login_error=github_failed`);
    expect(await countSessions()).toBe(0);
  });

  it("handles the user cancelling on GitHub", async () => {
    const app = makeApp();
    const res = await request(app)
      .get("/api/auth/github/callback")
      .query({ error: "access_denied", state: "s" })
      .expect(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/?login_error=denied`);
    expect(gh.calls).toBe(0);
  });

  it("keeps one user per GitHub ID when the login is renamed", async () => {
    const app = makeApp();
    await signIn(app);
    gh.user = { id: ALLOWED_ID, login: "enes-renamed", avatarUrl: "https://avatars/1" };
    const token = await signIn(app);

    const all = await dbClient.db.select().from(users);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ login: "enes-renamed", avatarUrl: "https://avatars/1" });
    const me = await request(app)
      .get("/api/me")
      .set("Cookie", `liman_session=${token}`)
      .expect(200);
    expect(me.body).toMatchObject({ login: "enes-renamed" });
  });

  it("drops the session the browser had before signing in (no session fixation)", async () => {
    const app = makeApp();
    const before = await signIn(app);
    const state = await startLogin(app);
    await callback(app, state, state, `; liman_session=${before}`).expect(302);

    await request(app).get("/api/me").set("Cookie", `liman_session=${before}`).expect(401);
    expect(await countSessions()).toBe(1);
  });
});

describe("sessions", () => {
  it("returns 401 without a cookie or with an unknown token", async () => {
    const app = makeApp();
    const res = await request(app).get("/api/me").expect(401);
    expect(res.body).toEqual({ error: { code: "unauthenticated", message: "Sign in required" } });
    await request(app).get("/api/me").set("Cookie", "liman_session=not-a-real-token").expect(401);
  });

  it("rejects and deletes an expired session", async () => {
    const app = makeApp();
    const token = await signIn(app);
    await dbClient.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });

    await request(app).get("/api/me").set("Cookie", `liman_session=${token}`).expect(401);
    expect(await countSessions()).toBe(0);
  });

  it("ends existing sessions of a user removed from the allow list", async () => {
    const token = await signIn(makeApp());
    const stricter = makeApp(makeConfig({ allowedGithubIds: new Set(["5"]) }));

    await request(stricter).get("/api/me").set("Cookie", `liman_session=${token}`).expect(401);
    expect(await countSessions()).toBe(0);
  });

  it("logout deletes the session and clears the cookie", async () => {
    const app = makeApp();
    const token = await signIn(app);

    const res = await request(app)
      .post("/api/auth/logout")
      .set("Origin", PUBLIC_URL)
      .set("Cookie", `liman_session=${token}`)
      .expect(204);
    expect(cookieNamed(res, "liman_session")?.value).toBe("");
    expect(await countSessions()).toBe(0);
    await request(app).get("/api/me").set("Cookie", `liman_session=${token}`).expect(401);
  });
});

describe("Origin check", () => {
  it.each([
    ["a sibling subdomain", "http://evil.localhost"],
    ["another scheme", "https://liman.localhost"],
    ["a null origin", "null"],
  ])("rejects a POST from %s with 403 and changes nothing", async (_label, origin) => {
    const app = makeApp();
    const token = await signIn(app);

    const res = await request(app)
      .post("/api/auth/logout")
      .set("Origin", origin)
      .set("Cookie", `liman_session=${token}`)
      .expect(403);
    expect(res.body).toEqual({ error: { code: "forbidden", message: "Origin not allowed" } });
    expect(await countSessions()).toBe(1);
  });

  it("rejects a POST without an Origin header", async () => {
    const app = makeApp();
    const token = await signIn(app);
    await request(app).post("/api/auth/logout").set("Cookie", `liman_session=${token}`).expect(403);
    expect(await countSessions()).toBe(1);
  });

  it("does not apply to GET requests", async () => {
    const app = makeApp();
    const token = await signIn(app);
    await request(app)
      .get("/api/me")
      .set("Origin", "http://evil.localhost")
      .set("Cookie", `liman_session=${token}`)
      .expect(200);
  });
});

describe("sign-in rate limit", () => {
  it("answers 429 with Retry-After after 10 requests per minute from one IP", async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i += 1) {
      await request(app).get("/api/auth/github/login").expect(302);
    }
    const res = await request(app).get("/api/auth/github/login").expect(429);
    expect(res.body).toEqual({ error: { code: "rate_limited", message: "Too many requests" } });
    const retryAfter = Number(res.headers["retry-after"]);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);
  });

  it("counts clients separately by the address Traefik reports", async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i += 1) {
      await request(app).get("/api/auth/github/login").set("X-Forwarded-For", "203.0.113.1");
    }
    await request(app)
      .get("/api/auth/github/login")
      .set("X-Forwarded-For", "203.0.113.1")
      .expect(429);
    await request(app)
      .get("/api/auth/github/login")
      .set("X-Forwarded-For", "203.0.113.2")
      .expect(302);
  });

  it("does not let a client pick its address by prepending to X-Forwarded-For", async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i += 1) {
      await request(app)
        .get("/api/auth/github/login")
        .set("X-Forwarded-For", `198.51.100.${String(i)}, 203.0.113.1`);
    }
    await request(app)
      .get("/api/auth/github/login")
      .set("X-Forwarded-For", "198.51.100.99, 203.0.113.1")
      .expect(429);
  });

  it("limits the callback too", async () => {
    const app = makeApp();
    for (let i = 0; i < 10; i += 1) {
      await request(app).get("/api/auth/github/callback").query({ code: "c", state: "s" });
    }
    await request(app)
      .get("/api/auth/github/callback")
      .query({ code: "c", state: "s" })
      .expect(429);
  });

  it("keys the counter with an expiry in Redis", async () => {
    const app = makeApp();
    await request(app).get("/api/auth/github/login").expect(302);
    const keys = await redis.keys("ratelimit:auth-login:*");
    expect(keys).toHaveLength(1);
    const ttl = await redis.ttl(keys[0] ?? "");
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(60);
    expect(await redis.get(keys[0] ?? "")).toBe("1");
  });
});

describe("users table", () => {
  it("stores the numeric GitHub ID", async () => {
    await signIn(makeApp());
    const [row] = await dbClient.db.select().from(users).where(eq(users.githubId, ALLOWED_ID));
    expect(row?.login).toBe("enes");
  });
});
