import { describe, expect, it } from "vitest";
import {
  appNameSchema,
  appSchema,
  branchNameSchema,
  createAppBodySchema,
  envPutBodySchema,
  healthPathSchema,
  updateAppBodySchema,
} from "./apps.js";

const validCreate = {
  name: "Blog",
  subdomain: "blog",
  installationId: "0b6f7c8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f",
  repoId: 123,
  branch: "main",
  port: 3000,
};

describe("appNameSchema", () => {
  it("trims and accepts free text", () => {
    expect(appNameSchema.parse("  My blog ✨ ")).toBe("My blog ✨");
  });

  it.each([
    ["empty", "   "],
    ["too long", "x".repeat(61)],
    ["control character", "a\nb"],
  ])("rejects %s", (_name, value) => {
    expect(appNameSchema.safeParse(value).success).toBe(false);
  });
});

describe("branchNameSchema", () => {
  it.each(["main", "feature/login", "release-1.2", "v2.x", "a_b"])("accepts %s", (value) => {
    expect(branchNameSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    "",
    "-main",
    "/main",
    "main/",
    "main.",
    "main.lock",
    "a..b",
    "a//b",
    "a@{b",
    "has space",
    "a~b",
    "a^b",
    "a:b",
    "a?b",
    "a*b",
    "a[b",
    "a\\b",
    "x".repeat(256),
  ])("rejects %j", (value) => {
    expect(branchNameSchema.safeParse(value).success).toBe(false);
  });
});

describe("healthPathSchema", () => {
  it.each(["/", "/healthz", "/api/v1/health", "/_status.json", "/a.b/..c"])(
    "accepts %s",
    (value) => {
      expect(healthPathSchema.safeParse(value).success).toBe(true);
    },
  );

  it.each([
    "",
    "healthz",
    "/health?full=1",
    "/health#x",
    "/a b",
    "/%2e%2e",
    "//redis:6379",
    "//postgres/x",
    "/..",
    "/a/../b",
    "/./health",
    "/a/.",
  ])("rejects %j", (value) => {
    expect(healthPathSchema.safeParse(value).success).toBe(false);
  });
});

describe("createAppBodySchema", () => {
  it("defaults the health path to /", () => {
    expect(createAppBodySchema.parse(validCreate).healthPath).toBe("/");
  });

  it.each([
    ["reserved subdomain", { subdomain: "api" }],
    ["punycode subdomain", { subdomain: "xn--abc" }],
    ["port 0", { port: 0 }],
    ["port as string", { port: "3000" }],
    ["fractional port", { port: 80.5 }],
    ["repo id as string", { repoId: "123" }],
    ["installation id not a uuid", { installationId: "11" }],
    ["unknown field", { status: "deleting" }],
  ])("rejects %s", (_name, patch) => {
    expect(createAppBodySchema.safeParse({ ...validCreate, ...patch }).success).toBe(false);
  });
});

describe("updateAppBodySchema", () => {
  it("accepts a subset of branch, port and health path", () => {
    expect(updateAppBodySchema.parse({ port: 8080 })).toEqual({ port: 8080 });
  });

  it.each([
    ["empty body", {}],
    ["subdomain change", { subdomain: "other" }],
    ["name change", { name: "Other" }],
  ])("rejects %s", (_name, body) => {
    expect(updateAppBodySchema.safeParse(body).success).toBe(false);
  });
});

describe("envPutBodySchema", () => {
  it("accepts keys with and without values", () => {
    const body = { vars: [{ key: "A", value: "1" }, { key: "B" }, { key: "C", value: "" }] };
    expect(envPutBodySchema.parse(body)).toEqual(body);
  });

  it("accepts an empty list (delete everything)", () => {
    expect(envPutBodySchema.parse({ vars: [] })).toEqual({ vars: [] });
  });

  it.each([
    ["reserved PORT", [{ key: "PORT", value: "1" }]],
    ["reserved LIMAN_ prefix", [{ key: "LIMAN_X", value: "1" }]],
    ["lower-case key", [{ key: "api_key", value: "1" }]],
    ["key starting with a digit", [{ key: "1A", value: "1" }]],
    ["key over 128 characters", [{ key: "K".repeat(129), value: "1" }]],
    ["value over 32 KB", [{ key: "A", value: "é".repeat(16 * 1024 + 1) }]],
    [
      "duplicate keys",
      [
        { key: "A", value: "1" },
        { key: "A", value: "2" },
      ],
    ],
    [
      "101 variables",
      Array.from({ length: 101 }, (_, i) => ({ key: `K${String(i)}`, value: "v" })),
    ],
    ["unknown field", [{ key: "A", value: "1", secret: true }]],
  ])("rejects %s", (_name, vars) => {
    expect(envPutBodySchema.safeParse({ vars }).success).toBe(false);
  });

  it("does not echo values in validation messages", () => {
    const result = envPutBodySchema.safeParse({
      vars: [{ key: "lower", value: "hunter2-secret" }],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues.map((i) => i.message))).not.toContain(
      "hunter2-secret",
    );
  });
});

describe("appSchema", () => {
  const app = {
    id: "0b6f7c8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f",
    name: "Blog",
    subdomain: "blog",
    url: "http://blog.localhost",
    installationId: "0b6f7c8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f",
    repoId: 1,
    repoFullName: "enes/blog",
    branch: "main",
    port: 3000,
    healthPath: "/",
    status: "active",
    createdAt: "2026-11-27T10:00:00.000Z",
    updatedAt: "2026-11-27T10:00:00.000Z",
  };

  it("accepts an http(s) url", () => {
    expect(appSchema.safeParse(app).success).toBe(true);
    expect(appSchema.safeParse({ ...app, url: "https://blog.example.com" }).success).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "blog.localhost"])(
    "rejects %s, which the panel would put in an href",
    (url) => {
      expect(appSchema.safeParse({ ...app, url }).success).toBe(false);
    },
  );
});
