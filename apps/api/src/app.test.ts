import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { createLogger } from "./logger.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** An app whose JSON log lines are collected in memory. */
function setup() {
  const lines: Record<string, unknown>[] = [];
  const destination = {
    write(chunk: string) {
      lines.push(JSON.parse(chunk) as Record<string, unknown>);
    },
  };
  const logger = createLogger({ logLevel: "info" }, destination);
  return { app: createApp({ logger }), lines };
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
