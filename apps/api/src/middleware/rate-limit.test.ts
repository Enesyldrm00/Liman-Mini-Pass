import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../app.js";
import { createLogger } from "../logger.js";
import { createRedis } from "../redis.js";
import { clientKey, rateLimit } from "./rate-limit.js";

describe("clientKey", () => {
  it.each([
    ["203.0.113.7", "203.0.113.7"],
    ["::ffff:203.0.113.7", "203.0.113.7"],
    ["2001:db8:1:2:aaaa:bbbb:cccc:dddd", "2001:db8:1:2::/64"],
    ["2001:db8:1:2::1", "2001:db8:1:2::/64"],
    ["2001:0db8:0001:0002:ffff::", "2001:db8:1:2::/64"],
    ["2001:db8::1", "2001:db8:0:0::/64"],
    ["::1", "0:0:0:0::/64"],
    ["fe80::1%eth0", "fe80:0:0:0::/64"],
    ["unknown", "unknown"],
  ])("maps %s to %s", (ip, key) => {
    expect(clientKey(ip)).toBe(key);
  });

  it("puts every address of one /64 in the same bucket", () => {
    expect(clientKey("2001:db8:1:2::a")).toBe(clientKey("2001:db8:1:2:ffff:ffff:ffff:ffff"));
    expect(clientKey("2001:db8:1:2::a")).not.toBe(clientKey("2001:db8:1:3::a"));
  });
});

describe("rateLimit without Redis", () => {
  // Nothing listens on port 1, so every command fails.
  const redis = createRedis("redis://127.0.0.1:1");
  redis.on("error", () => {
    // Connection errors are expected here.
  });

  afterAll(() => {
    redis.disconnect();
  });

  it("fails closed and quickly: 500, the handler never runs", async () => {
    let reached = false;
    const app = createApp({
      logger: createLogger({ logLevel: "silent" }),
      registerRoutes: (app) => {
        app.get(
          "/limited",
          rateLimit({ redis, name: "test", limit: 10, windowSeconds: 60 }),
          (_req, res) => {
            reached = true;
            res.json({ ok: true });
          },
        );
      },
    });

    const started = Date.now();
    const res = await request(app).get("/limited").expect(500);
    expect(res.body).toEqual({ error: { code: "internal", message: "Internal server error" } });
    expect(reached).toBe(false);
    expect(Date.now() - started).toBeLessThan(5_000);
  });
});
