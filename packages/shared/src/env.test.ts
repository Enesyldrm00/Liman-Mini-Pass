import { describe, expect, it } from "vitest";
import { MAX_ENV_VALUE_BYTES, envKeySchema, envValueSchema } from "./env.js";

describe("envKeySchema", () => {
  it.each(["DATABASE_URL", "A", "_SECRET", "API_KEY_2", "NODE_ENV"])("accepts %s", (key) => {
    expect(envKeySchema.safeParse(key).success).toBe(true);
  });

  it.each(["", "database_url", "1KEY", "MY-KEY", "MY KEY", "KEY.X", "ÇAY"])("rejects %j", (key) => {
    expect(envKeySchema.safeParse(key).success).toBe(false);
  });

  it.each(["PORT", "LIMAN_", "LIMAN_SECRET"])("rejects reserved key %s", (key) => {
    const result = envKeySchema.safeParse(key);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Env key is reserved");
  });

  it("allows keys that only contain a reserved word", () => {
    expect(envKeySchema.safeParse("PORTAL").success).toBe(true);
    expect(envKeySchema.safeParse("MY_LIMAN_KEY").success).toBe(true);
  });
});

describe("envValueSchema", () => {
  it("accepts empty and maximum-size values", () => {
    expect(envValueSchema.safeParse("").success).toBe(true);
    expect(envValueSchema.safeParse("a".repeat(MAX_ENV_VALUE_BYTES)).success).toBe(true);
  });

  it("rejects values over the byte limit", () => {
    expect(envValueSchema.safeParse("a".repeat(MAX_ENV_VALUE_BYTES + 1)).success).toBe(false);
  });

  it("counts bytes, not characters", () => {
    // "ç" is 2 bytes in UTF-8, so half the limit in characters already fills it.
    const half = MAX_ENV_VALUE_BYTES / 2;
    expect(envValueSchema.safeParse("ç".repeat(half)).success).toBe(true);
    expect(envValueSchema.safeParse("ç".repeat(half + 1)).success).toBe(false);
  });
});
