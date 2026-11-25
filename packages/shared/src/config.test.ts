import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  EnvValidationError,
  base64KeySchema,
  githubIdListSchema,
  logLevelSchema,
  nodeEnvSchema,
  intSchema,
  originSchema,
  parseEnv,
  portSchema,
  urlSchema,
} from "./config.js";

describe("portSchema", () => {
  it("coerces numeric strings", () => {
    expect(portSchema.parse("3000")).toBe(3000);
  });

  it.each(["0", "65536", "3000.5", "abc", "-1", "0x1F90", "1e3", " 3000 "])(
    "rejects %s",
    (value) => {
      expect(portSchema.safeParse(value).success).toBe(false);
    },
  );
});

describe("intSchema", () => {
  const hours = intSchema(1, 8760);

  it("coerces whole numbers within the range", () => {
    expect(hours.parse("1")).toBe(1);
    expect(hours.parse("168")).toBe(168);
    expect(hours.parse("8760")).toBe(8760);
  });

  it.each(["0", "8761", "1.5", "abc", "-1", "0x10", "1e2", " 168 "])("rejects %s", (value) => {
    expect(hours.safeParse(value).success).toBe(false);
  });
});

describe("nodeEnvSchema and logLevelSchema", () => {
  it("accept known values only", () => {
    expect(nodeEnvSchema.parse("production")).toBe("production");
    expect(nodeEnvSchema.safeParse("prod").success).toBe(false);
    expect(logLevelSchema.parse("debug")).toBe("debug");
    expect(logLevelSchema.safeParse("verbose").success).toBe(false);
  });
});

describe("urlSchema", () => {
  const postgres = urlSchema(["postgres:", "postgresql:"]);

  it("accepts the listed protocols", () => {
    expect(postgres.parse("postgres://u:p@localhost:5433/liman")).toBe(
      "postgres://u:p@localhost:5433/liman",
    );
    expect(postgres.safeParse("postgresql://db/liman").success).toBe(true);
  });

  it.each(["mysql://db/liman", "not a url", "postgres://", "localhost:5432"])(
    "rejects %s",
    (value) => {
      expect(postgres.safeParse(value).success).toBe(false);
    },
  );
});

describe("originSchema", () => {
  it.each([
    ["http://liman.localhost", "http://liman.localhost"],
    ["http://liman.localhost/", "http://liman.localhost"],
    ["https://Liman.Example.com:8443", "https://liman.example.com:8443"],
  ])("normalises %s", (value, expected) => {
    expect(originSchema.parse(value)).toBe(expected);
  });

  it.each([
    "ftp://liman.localhost",
    "http://liman.localhost/panel",
    "http://liman.localhost?x=1",
    "http://liman.localhost/?",
    "http://liman.localhost#top",
    "http://user:pass@liman.localhost",
    "liman.localhost",
  ])("rejects %s", (value) => {
    expect(originSchema.safeParse(value).success).toBe(false);
  });
});

describe("githubIdListSchema", () => {
  it("splits, trims, drops empty items and deduplicates", () => {
    expect(githubIdListSchema.parse(" 12345678, 42 ,,12345678")).toEqual(["12345678", "42"]);
  });

  it.each(["", " , ", "octocat", "12a", "0", "-5", "1.5"])("rejects %j", (value) => {
    expect(githubIdListSchema.safeParse(value).success).toBe(false);
  });
});

describe("base64KeySchema", () => {
  const key32 = base64KeySchema(32);

  it("accepts a 32-byte key", () => {
    const key = Buffer.alloc(32, 7).toString("base64");
    expect(key32.parse(key)).toBe(key);
  });

  it.each([
    ["too short", Buffer.alloc(16).toString("base64")],
    ["too long", Buffer.alloc(33).toString("base64")],
    ["not base64", "%".repeat(44)],
    ["url-safe alphabet", Buffer.alloc(32, 0xfb).toString("base64url")],
  ])("rejects a key that is %s", (_name, value) => {
    expect(key32.safeParse(value).success).toBe(false);
  });
});

describe("parseEnv", () => {
  const schema = z.object({
    DATABASE_URL: urlSchema(["postgres:"]),
    PORT: portSchema.default(3000),
  });

  it("returns typed values and applies defaults", () => {
    expect(parseEnv(schema, { DATABASE_URL: "postgres://db/liman" })).toEqual({
      DATABASE_URL: "postgres://db/liman",
      PORT: 3000,
    });
  });

  it("treats empty strings as missing", () => {
    expect(() => parseEnv(schema, { DATABASE_URL: "" })).toThrow(/DATABASE_URL: Required/);
    expect(parseEnv(schema, { DATABASE_URL: "postgres://db/liman", PORT: "" }).PORT).toBe(3000);
  });

  it("lists every problem without leaking values", () => {
    const secret = "mysql://admin:s3cr3t-password@db/liman";
    let error: unknown;
    try {
      parseEnv(schema, { DATABASE_URL: secret, PORT: "99999" });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(EnvValidationError);
    const { message, problems } = error as EnvValidationError;
    expect(problems).toHaveLength(2);
    expect(message).toContain("DATABASE_URL:");
    expect(message).toContain("PORT:");
    expect(message).not.toContain("s3cr3t");
    expect(message).not.toContain("99999");
  });
});
