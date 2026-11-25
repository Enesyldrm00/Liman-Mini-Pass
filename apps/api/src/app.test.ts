import { DrizzleQueryError } from "drizzle-orm";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp, type AppDeps } from "./app.js";
import { createLogger } from "./logger.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** An app whose JSON log lines are collected in memory. */
function setup(registerRoutes?: AppDeps["registerRoutes"]) {
  const lines: Record<string, unknown>[] = [];
  const destination = {
    write(chunk: string) {
      lines.push(JSON.parse(chunk) as Record<string, unknown>);
    },
  };
  const logger = createLogger({ logLevel: "info" }, destination);
  return { app: createApp({ logger, registerRoutes }), lines };
}

describe("api app", () => {
  it("answers health checks without logging them", async () => {
    const { app, lines } = setup();
    const res = await request(app).get("/healthz").expect(200);
    expect(res.body).toEqual({ status: "ok" });
    expect(lines).toHaveLength(0);
  });

  it("returns the shared error shape for unknown routes", async () => {
    const { app } = setup();
    const res = await request(app).get("/nope").expect(404);
    expect(res.body).toEqual({ error: { code: "not_found", message: "Not found" } });
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });
});

describe("error handler", () => {
  it("turns a rejected async handler into the shared 500 shape and logs it", async () => {
    const { app, lines } = setup((app) => {
      app.get("/boom", async () => {
        await Promise.resolve();
        throw new Error("database password is hunter2");
      });
    });

    const res = await request(app).get("/boom").expect(500);
    expect(res.body).toEqual({ error: { code: "internal", message: "Internal server error" } });
    expect(res.text).not.toContain("hunter2");

    const reqId = res.headers["x-request-id"];
    const errorLine = lines.find((line) => line.msg === "unhandled error");
    expect(errorLine).toMatchObject({ level: 50, reqId, err: { type: "Error" } });
  });
});

describe("error handler with database errors", () => {
  it("logs a failed query without its SQL parameters or the values Postgres echoes", async () => {
    const pgError = Object.assign(new Error("duplicate key value: Key (github_id)=(4242) exists"), {
      name: "DatabaseError",
      code: "23505",
      constraint: "users_github_id_unique",
      table: "users",
      detail: "Key (github_id)=(4242) already exists.",
    });
    const { app, lines } = setup((app) => {
      app.get("/db-boom", () => {
        throw new DrizzleQueryError(
          "select * from sessions where token_hash = $1",
          ["secret-token-hash"],
          pgError,
        );
      });
    });

    await request(app).get("/db-boom").expect(500);
    const raw = JSON.stringify(lines);
    expect(raw).not.toContain("secret-token-hash");
    expect(raw).not.toContain("4242");
    expect(raw).not.toContain("token_hash = $1");
    const errorLine = lines.find((line) => line.msg === "unhandled error");
    expect(errorLine).toMatchObject({
      err: {
        type: "DrizzleQueryError",
        cause: {
          type: "DatabaseError",
          code: "23505",
          constraint: "users_github_id_unique",
          table: "users",
        },
      },
    });
  });
});

describe("request ids", () => {
  it("generates an id, returns it and logs it", async () => {
    const { app, lines } = setup();
    const res = await request(app).get("/nope");
    const id = res.headers["x-request-id"];
    expect(id).toMatch(UUID);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ reqId: id, service: "api", level: 40 });
  });

  it("gives each request its own id", async () => {
    const { app } = setup();
    const first = await request(app).get("/nope");
    const second = await request(app).get("/nope");
    expect(first.headers["x-request-id"]).not.toBe(second.headers["x-request-id"]);
  });

  it("keeps a well-formed incoming id", async () => {
    const { app, lines } = setup();
    const res = await request(app).get("/nope").set("X-Request-Id", "trace-abc.123_x");
    expect(res.headers["x-request-id"]).toBe("trace-abc.123_x");
    expect(lines[0]).toMatchObject({ reqId: "trace-abc.123_x" });
  });

  it.each([
    ["too long", "a".repeat(65)],
    ["with spaces", "abc def"],
    ["with quotes", 'abc","level":"fatal'],
  ])("replaces an incoming id that is %s", async (_name, incoming) => {
    const { app } = setup();
    const res = await request(app).get("/nope").set("X-Request-Id", incoming);
    expect(res.headers["x-request-id"]).toMatch(UUID);
  });
});

describe("log redaction", () => {
  it("logs the path without the query string", async () => {
    const { app, lines } = setup();
    await request(app).get("/api/auth/callback?code=secret-code&state=secret-state");
    expect(JSON.stringify(lines)).not.toContain("secret");
    expect(lines[0]).toMatchObject({ req: { url: "/api/auth/callback" } });
  });

  it("logs redirect targets without their query string", async () => {
    const { app, lines } = setup((app) => {
      app.get("/go", (_req, res) => {
        res.redirect(302, "https://github.com/login/oauth/authorize?state=secret-state");
      });
    });
    await request(app).get("/go").expect(302);
    expect(JSON.stringify(lines)).not.toContain("secret");
    expect(lines[0]).toMatchObject({
      res: { headers: { location: "https://github.com/login/oauth/authorize" } },
    });
  });

  it("does not log health checks that carry a query string", async () => {
    const { app, lines } = setup();
    await request(app).get("/healthz?probe=1").expect(200);
    expect(lines).toHaveLength(0);
  });

  it("hides credentials, cookies and webhook signatures", async () => {
    const { app, lines } = setup();
    await request(app)
      .get("/nope")
      .set("Authorization", "Bearer ghs_secret-token")
      .set("Cookie", "__Host-liman_session=secret-session")
      .set("X-Hub-Signature-256", "sha256=secret-signature");

    const raw = JSON.stringify(lines);
    expect(raw).not.toContain("secret");
    expect(lines[0]).toMatchObject({
      req: {
        headers: {
          authorization: "[redacted]",
          cookie: "[redacted]",
          "x-hub-signature-256": "[redacted]",
        },
      },
    });
  });
});
