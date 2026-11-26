/**
 * Integration tests for sign-in, sessions, Origin checks and the sign-in rate limit,
 * against real Postgres and Redis (Testcontainers). GitHub is replaced by a fake.
 */
import { generateKeyPairSync } from "node:crypto";
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
import { hashToken, pkceChallenge } from "../auth/tokens.js";
import type { Config } from "../config/index.js";
import { createLogger } from "../logger.js";
import { apiRoutes } from "./index.js";

const PUBLIC_URL = "http://liman.localhost";
const ALLOWED_ID = 1001;
const APP_KEY = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

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
const gh: {
  user: GitHubUser;
  fail: boolean;
  calls: number;
  challenges: Set<string>;
} = {
  user: { id: ALLOWED_ID, login: "enes", avatarUrl: null },
  fail: false,
  calls: 0,
  challenges: new Set(),
};

/** Like GitHub, the fake only redeems a code with the verifier of a challenge it issued. */
const fakeGitHub: GitHubAuth = {
  authorizeUrl: ({ state, codeChallenge, redirectUri }) => {
    gh.challenges.add(codeChallenge);
    const params = new URLSearchParams({
      state,
      code_challenge: codeChallenge,
      redirect_uri: redirectUri,
    });
    return `https://github.test/authorize?${params.toString()}`;
  },
  fetchUser: ({ codeVerifier }) => {
    gh.calls += 1;
    if (gh.fail) {
      return Promise.reject(new GitHubAuthError("bad_verification_code"));
    }
    if (!gh.challenges.has(pkceChallenge(codeVerifier))) {
      return Promise.reject(new GitHubAuthError("invalid_grant"));
    }
    return Promise.resolve(gh.user);
  },
};

beforeEach(async () => {
  await dbClient.db.execute(sql`truncate users, sessions cascade`);
  await redis.flushall();
  gh.user = { id: ALLOWED_ID, login: "enes", avatarUrl: null };
  gh.fail = false;
  gh.calls = 0;
  gh.challenges.clear();
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
    github: {
      clientId: "unused",
      clientSecret: "unused",
      appId: 1,
      appSlug: "liman-test",
      privateKey: APP_KEY,
    },
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

/** The last Set-Cookie for a name: what the browser ends up with. */
function cookieNamed(res: request.Response, name: string): SetCookie | undefined {
  return setCookies(res).findLast((cookie) => cookie.name === name);
}

interface Login {
  state: string;
  /** Value of the sign-in cookie: `<state>.<pkce verifier>`. */
  cookie: string;
  cookieName: string;
}

/** Starts sign-in, checking the redirect and the sign-in cookie agree. */
async function startLogin(app: App, publicUrl = PUBLIC_URL, prefix = ""): Promise<Login> {
  const res = await request(app).get("/api/auth/github/login").expect(302);
  const location = new URL(String(res.headers.location));
  const state = location.searchParams.get("state") ?? "";
  expect(location.searchParams.get("redirect_uri")).toBe(`${publicUrl}/api/auth/github/callback`);
  const cookieName = `${prefix}liman_oauth_state`;
  const cookie = cookieNamed(res, cookieName)?.value ?? "";
  const [cookieState, verifier] = cookie.split(".");
  expect(cookieState).toBe(state);
  expect(location.searchParams.get("code_challenge")).toBe(pkceChallenge(verifier ?? ""));
  return { state, cookie, cookieName };
}

function callback(app: App, login: Login, options: { cookie?: string; extra?: string } = {}) {
  return request(app)
    .get("/api/auth/github/callback")
    .query({ code: "one-time-code", state: login.state })
    .set("Cookie", `${login.cookieName}=${options.cookie ?? login.cookie}${options.extra ?? ""}`);
}

/** Full sign-in; returns the raw session token from the cookie. */
async function signIn(app: App): Promise<string> {
  const login = await startLogin(app);
  const res = await callback(app, login).expect(302);
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
    const login = await startLogin(app);
    const res = await callback(app, login).expect(302);
    const cookie = cookieNamed(res, "liman_session");
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/", maxAge: 7200 });
    expect(cookie?.secure).toBeFalsy();
    expect(cookie?.domain).toBeUndefined();
    // The state cookie is single-use.
    expect(cookieNamed(res, "liman_oauth_state")?.value).toBe("");
  });

  it("signs in with __Host- prefixed, Secure cookies in production", async () => {
    const publicUrl = "https://liman.example.com";
    const app = makeApp(makeConfig({ nodeEnv: "production", publicUrl }));
    const login = await startLogin(app, publicUrl, "__Host-");
    const res = await callback(app, login).expect(302);
    expect(res.headers.location).toBe(`${publicUrl}/`);

    for (const name of ["__Host-liman_oauth_state", "__Host-liman_session"]) {
      const cookie = cookieNamed(res, name);
      expect(cookie).toMatchObject({ secure: true, path: "/", httpOnly: true, sameSite: "lax" });
      expect(cookie?.domain).toBeUndefined();
    }
    const token = cookieNamed(res, "__Host-liman_session")?.value ?? "";
    await request(app).get("/api/me").set("Cookie", `__Host-liman_session=${token}`).expect(200);
    // The unprefixed name, which a sibling subdomain could set, is not accepted.
    await request(app).get("/api/me").set("Cookie", `liman_session=${token}`).expect(401);
  });

  it("rejects a code redeemed without the matching PKCE verifier", async () => {
    const app = makeApp();
    const login = await startLogin(app);
    const res = await callback(app, login, {
      cookie: `${login.state}.not-the-verifier`,
    }).expect(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/?login_error=github_failed`);
    expect(await countSessions()).toBe(0);
  });

  it("rejects a callback whose state does not match the cookie", async () => {
    const app = makeApp();
    const login = await startLogin(app);
    const res = await callback(app, login, {
      cookie: `some-other-state.${login.cookie.split(".")[1] ?? ""}`,
    }).expect(400);
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
    const login = await startLogin(app);
    const res = await callback(app, login).expect(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/?login_error=not_allowed`);
    expect(cookieNamed(res, "liman_session")).toBeUndefined();
    expect(await countUsers()).toBe(0);
    expect(await countSessions()).toBe(0);
  });

  it("sends the browser back with an error when GitHub rejects the code", async () => {
    gh.fail = true;
    const app = makeApp();
    const login = await startLogin(app);
    const res = await callback(app, login).expect(302);
    expect(res.headers.location).toBe(`${PUBLIC_URL}/?login_error=github_failed`);
    expect(await countSessions()).toBe(0);
  });

  it("ends the earlier session even when the new sign-in is rejected", async () => {
    const app = makeApp();
    const before = await signIn(app);
    gh.user = { id: 999, login: "someone-else", avatarUrl: null };
    const login = await startLogin(app);
    const res = await callback(app, login, { extra: `; liman_session=${before}` }).expect(302);

    expect(res.headers.location).toBe(`${PUBLIC_URL}/?login_error=not_allowed`);
    expect(cookieNamed(res, "liman_session")?.value).toBe("");
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
    const login = await startLogin(app);
    await callback(app, login, { extra: `; liman_session=${before}` }).expect(302);

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

describe("session store", () => {
  /** A store whose clock the test moves. */
  function storeAt(start: Date, ttlHours = 1) {
    const clock = { now: start };
    const store = createSessionStore(dbClient.db, { ttlHours, now: () => clock.now });
    const advance = (ms: number) => {
      clock.now = new Date(clock.now.getTime() + ms);
    };
    return { store, advance };
  }

  async function sessionRow() {
    const [row] = await dbClient.db.select().from(sessions);
    if (!row) throw new Error("no session row");
    return row;
  }

  const MINUTE = 60 * 1000;

  it("keeps a fixed lifetime: activity does not extend it", async () => {
    const [user] = await dbClient.db
      .insert(users)
      .values({ githubId: ALLOWED_ID, login: "enes" })
      .returning();
    const { store, advance } = storeAt(new Date("2026-11-25T10:00:00Z"));
    const { token, expiresAt } = await store.create(user?.id ?? "");
    expect(expiresAt.toISOString()).toBe("2026-11-25T11:00:00.000Z");

    for (let i = 0; i < 5; i += 1) {
      advance(10 * MINUTE);
      expect(await store.find(token)).not.toBeNull();
    }
    expect((await sessionRow()).expiresAt.toISOString()).toBe("2026-11-25T11:00:00.000Z");

    advance(10 * MINUTE); // 11:00, the end of the lifetime
    expect(await store.find(token)).toBeNull();
    expect(await countSessions()).toBe(0);
  });

  it("writes last_seen_at at most every 5 minutes", async () => {
    const [user] = await dbClient.db
      .insert(users)
      .values({ githubId: ALLOWED_ID, login: "enes" })
      .returning();
    const { store, advance } = storeAt(new Date("2026-11-25T10:00:00Z"));
    const { token } = await store.create(user?.id ?? "");

    advance(4 * MINUTE);
    await store.find(token);
    expect((await sessionRow()).lastSeenAt.toISOString()).toBe("2026-11-25T10:00:00.000Z");

    advance(2 * MINUTE); // 10:06
    await store.find(token);
    expect((await sessionRow()).lastSeenAt.toISOString()).toBe("2026-11-25T10:06:00.000Z");
  });
});

describe("users table", () => {
  it("stores the numeric GitHub ID", async () => {
    await signIn(makeApp());
    const [row] = await dbClient.db.select().from(users).where(eq(users.githubId, ALLOWED_ID));
    expect(row?.login).toBe("enes");
  });
});
