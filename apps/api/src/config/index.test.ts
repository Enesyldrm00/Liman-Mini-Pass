import { EnvValidationError } from "@liman/shared";
import { describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

const validEnv = {
  NODE_ENV: "development",
  LIMAN_PUBLIC_URL: "http://liman.localhost/",
  DATABASE_URL: "postgres://liman:liman@localhost:5433/liman",
  REDIS_URL: "redis://localhost:6379",
  LIMAN_ALLOWED_GITHUB_IDS: "12345678, 87654321",
  GITHUB_APP_CLIENT_ID: "Iv23test",
  GITHUB_APP_CLIENT_SECRET: "client-secret-value",
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
      allowedGithubIds: new Set(["12345678", "87654321"]),
      sessionTtlHours: 168,
      github: { clientId: "Iv23test", clientSecret: "client-secret-value" },
    });
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.github)).toBe(true);
  });

  it("reads optional values when given", () => {
    const config = loadConfig({
      ...validEnv,
      LOG_LEVEL: "debug",
      PORT: "8081",
      SESSION_TTL_HOURS: "24",
    });
    expect(config.logLevel).toBe("debug");
    expect(config.port).toBe(8081);
    expect(config.sessionTtlHours).toBe(24);
  });

  it.each([
    "NODE_ENV",
    "LIMAN_PUBLIC_URL",
    "DATABASE_URL",
    "REDIS_URL",
    "LIMAN_ALLOWED_GITHUB_IDS",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
  ])("fails when %s is missing", (name) => {
    const env = Object.fromEntries(Object.entries(validEnv).filter(([key]) => key !== name));
    expect(() => loadConfig(env)).toThrow(new RegExp(`${name}: Required`));
  });

  it.each([
    ["NODE_ENV", "prod"],
    ["LOG_LEVEL", "verbose"],
    ["PORT", "http"],
    ["LIMAN_PUBLIC_URL", "http://liman.localhost/panel"],
    ["DATABASE_URL", "mysql://db/liman"],
    ["REDIS_URL", "http://localhost:6379"],
    ["LIMAN_ALLOWED_GITHUB_IDS", "octocat"],
    ["SESSION_TTL_HOURS", "0"],
  ])("fails when %s is invalid", (name, value) => {
    expect(() => loadConfig({ ...validEnv, [name]: value })).toThrow(EnvValidationError);
  });

  it("requires an https public URL in production", () => {
    expect(() => loadConfig({ ...validEnv, NODE_ENV: "production" })).toThrow(
      /LIMAN_PUBLIC_URL: Must be an https origin when NODE_ENV is production/,
    );
    const config = loadConfig({
      ...validEnv,
      NODE_ENV: "production",
      LIMAN_PUBLIC_URL: "https://liman.example.com",
    });
    expect(config.publicUrl).toBe("https://liman.example.com");
  });

  it("never puts received values in the error message", () => {
    const env = { ...validEnv, LIMAN_ALLOWED_GITHUB_IDS: "secret-looking-value" };
    expect(() => loadConfig(env)).toThrow(EnvValidationError);
    try {
      loadConfig(env);
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-looking-value");
    }
  });
});
