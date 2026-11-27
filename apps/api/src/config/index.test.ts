import { generateKeyPairSync, randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EnvValidationError } from "@liman/shared";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "./index.js";

const keyDir = mkdtempSync(join(tmpdir(), "liman-config-"));
afterAll(() => {
  rmSync(keyDir, { recursive: true, force: true });
});

function writeKeyFile(name: string, content: string): string {
  const path = join(keyDir, name);
  writeFileSync(path, content);
  return path;
}

const rsaKeyPath = writeKeyFile(
  "app.pem",
  generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({
    type: "pkcs1",
    format: "pem",
  }),
);

const encryptionKey = randomBytes(32).toString("base64");

const validEnv = {
  NODE_ENV: "development",
  LIMAN_PUBLIC_URL: "http://liman.localhost/",
  LIMAN_BASE_DOMAIN: "localhost",
  LIMAN_ENCRYPTION_KEY: encryptionKey,
  DATABASE_URL: "postgres://liman:liman@localhost:5433/liman",
  REDIS_URL: "redis://localhost:6379",
  LIMAN_ALLOWED_GITHUB_IDS: "12345678, 87654321",
  GITHUB_APP_CLIENT_ID: "Iv23test",
  GITHUB_APP_CLIENT_SECRET: "client-secret-value",
  GITHUB_APP_ID: "123456",
  GITHUB_APP_SLUG: "liman-dev-06",
  GITHUB_APP_PRIVATE_KEY_PATH: rsaKeyPath,
};

describe("loadConfig", () => {
  it("returns a frozen, typed config with defaults", () => {
    const config = loadConfig(validEnv);
    const { privateKey, ...github } = config.github;
    const { encryptionKey: key, ...rest } = config;
    expect(key.export().toString("base64")).toBe(encryptionKey);
    expect({ ...rest, github }).toEqual({
      nodeEnv: "development",
      logLevel: "info",
      port: 3000,
      publicUrl: "http://liman.localhost",
      baseDomain: "localhost",
      databaseUrl: validEnv.DATABASE_URL,
      redisUrl: validEnv.REDIS_URL,
      allowedGithubIds: new Set(["12345678", "87654321"]),
      sessionTtlHours: 168,
      github: {
        clientId: "Iv23test",
        clientSecret: "client-secret-value",
        appId: 123456,
        appSlug: "liman-dev-06",
      },
    });
    expect(privateKey.type).toBe("private");
    expect(privateKey.asymmetricKeyType).toBe("rsa");
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
    "LIMAN_BASE_DOMAIN",
    "LIMAN_ENCRYPTION_KEY",
    "DATABASE_URL",
    "REDIS_URL",
    "LIMAN_ALLOWED_GITHUB_IDS",
    "GITHUB_APP_CLIENT_ID",
    "GITHUB_APP_CLIENT_SECRET",
    "GITHUB_APP_ID",
    "GITHUB_APP_SLUG",
    "GITHUB_APP_PRIVATE_KEY_PATH",
  ])("fails when %s is missing", (name) => {
    const env = Object.fromEntries(Object.entries(validEnv).filter(([key]) => key !== name));
    expect(() => loadConfig(env)).toThrow(new RegExp(`${name}: Required`));
  });

  it.each([
    ["NODE_ENV", "prod"],
    ["LOG_LEVEL", "verbose"],
    ["PORT", "http"],
    ["LIMAN_PUBLIC_URL", "http://liman.localhost/panel"],
    ["LIMAN_BASE_DOMAIN", "Example.com"],
    ["LIMAN_BASE_DOMAIN", ".example.com"],
    ["LIMAN_BASE_DOMAIN", "http://example.com"],
    ["LIMAN_ENCRYPTION_KEY", randomBytes(16).toString("base64")],
    ["LIMAN_ENCRYPTION_KEY", randomBytes(32).toString("hex")],
    ["DATABASE_URL", "mysql://db/liman"],
    ["REDIS_URL", "http://localhost:6379"],
    ["LIMAN_ALLOWED_GITHUB_IDS", "octocat"],
    ["SESSION_TTL_HOURS", "0"],
    ["GITHUB_APP_ID", "abc"],
    ["GITHUB_APP_SLUG", "Liman Dev"],
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

  it("fails when the private key file cannot be read", () => {
    expect(() =>
      loadConfig({ ...validEnv, GITHUB_APP_PRIVATE_KEY_PATH: join(keyDir, "missing.pem") }),
    ).toThrow(/GITHUB_APP_PRIVATE_KEY_PATH: Cannot read the file/);
  });

  it.each([
    ["is not a key", "not a pem file"],
    [
      "holds a public key",
      generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey.export({
        type: "spki",
        format: "pem",
      }),
    ],
    [
      "holds a non-RSA key",
      generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }),
    ],
  ])("fails when the private key file %s", (label, content) => {
    const path = writeKeyFile(`${label.replaceAll(" ", "-")}.pem`, content);
    expect(() => loadConfig({ ...validEnv, GITHUB_APP_PRIVATE_KEY_PATH: path })).toThrow(
      /GITHUB_APP_PRIVATE_KEY_PATH: Must be an RSA private key in PEM form/,
    );
  });

  it("never puts the private key in the error message", () => {
    const path = writeKeyFile("broken.pem", "-----BEGIN RSA PRIVATE KEY-----\nc2VjcmV0\n");
    try {
      loadConfig({ ...validEnv, GITHUB_APP_PRIVATE_KEY_PATH: path });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).not.toContain("c2VjcmV0");
      expect((error as Error).message).not.toContain(path);
    }
  });

  it("never puts the encryption key in the error message", () => {
    const badKey = randomBytes(31).toString("base64");
    try {
      loadConfig({ ...validEnv, LIMAN_ENCRYPTION_KEY: badKey });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/LIMAN_ENCRYPTION_KEY: Must be base64/);
      expect((error as Error).message).not.toContain(badKey);
    }
  });

  it("accepts a dotted base domain", () => {
    expect(loadConfig({ ...validEnv, LIMAN_BASE_DOMAIN: "apps.example.com" }).baseDomain).toBe(
      "apps.example.com",
    );
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
