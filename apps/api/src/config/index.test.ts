import { EnvValidationError } from "@liman/shared";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

const validEnv = {
  NODE_ENV: "development",
  LIMAN_PUBLIC_URL: "http://liman.localhost/",
  DATABASE_URL: "postgres://liman:liman@localhost:5433/liman",
  REDIS_URL: "redis://localhost:6379",
};

describe("loadConfig", () => {
  it("returns a frozen, typed config with defaults", () => {
    const config = loadConfig(validEnv);
    expect(config).toEqual({
      nodeEnv: "development",
      logLevel: "info",
      port: 3000,
      publicUrl: "http://liman.localhost",
      databaseUrl: validEnv.DATABASE_URL,
      redisUrl: validEnv.REDIS_URL,
    });
    expect(Object.isFrozen(config)).toBe(true);
  });

  it("reads optional values when given", () => {
    const config = loadConfig({ ...validEnv, LOG_LEVEL: "debug", PORT: "8081" });
    expect(config.logLevel).toBe("debug");
    expect(config.port).toBe(8081);
  });

  it.each(["NODE_ENV", "LIMAN_PUBLIC_URL", "DATABASE_URL", "REDIS_URL"])(
    "fails when %s is missing",
    (name) => {
      const env = Object.fromEntries(Object.entries(validEnv).filter(([key]) => key !== name));
      expect(() => loadConfig(env)).toThrow(new RegExp(`${name}: Required`));
    },
  );

  it.each([
    ["NODE_ENV", "prod"],
    ["LOG_LEVEL", "verbose"],
    ["PORT", "http"],
    ["LIMAN_PUBLIC_URL", "http://liman.localhost/panel"],
    ["DATABASE_URL", "mysql://db/liman"],
    ["REDIS_URL", "http://localhost:6379"],
  ])("fails when %s is invalid", (name, value) => {
    expect(() => loadConfig({ ...validEnv, [name]: value })).toThrow(EnvValidationError);
  });
});
