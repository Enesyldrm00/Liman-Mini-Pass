import { EnvValidationError } from "@liman/shared";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

const validEnv = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://liman:liman@postgres:5432/liman",
  REDIS_URL: "redis://redis:6379",
};

describe("loadConfig", () => {
  it("returns a frozen, typed config with defaults", () => {
    const config = loadConfig(validEnv);
    expect(config).toEqual({
      nodeEnv: "production",
      logLevel: "info",
      databaseUrl: validEnv.DATABASE_URL,
      redisUrl: validEnv.REDIS_URL,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it.each(["NODE_ENV", "DATABASE_URL", "REDIS_URL"])("fails when %s is missing", (name) => {
    const env = Object.fromEntries(Object.entries(validEnv).filter(([key]) => key !== name));
    expect(() => loadConfig(env)).toThrow(new RegExp(`${name}: Required`));
  });

  it("fails on an invalid value", () => {
    expect(() => loadConfig({ ...validEnv, REDIS_URL: "localhost:6379" })).toThrow(
      EnvValidationError,
    );
  });
});
