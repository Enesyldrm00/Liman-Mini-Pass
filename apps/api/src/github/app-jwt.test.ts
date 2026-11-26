import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createAppJwt } from "./app-jwt.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });

function decode(part: string | undefined): unknown {
  return JSON.parse(Buffer.from(part ?? "", "base64url").toString("utf8"));
}

describe("createAppJwt", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const seconds = now.getTime() / 1000;
  const jwt = createAppJwt(123456, privateKey, now);
  const [header, payload, signature] = jwt.split(".");

  it("has an RS256 header and the App ID as issuer", () => {
    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    expect(decode(payload)).toMatchObject({ iss: "123456" });
  });

  it("is backdated 60 seconds and lives at most 10 minutes", () => {
    const { iat, exp } = decode(payload) as { iat: number; exp: number };
    expect(iat).toBe(seconds - 60);
    expect(exp).toBeGreaterThan(seconds);
    expect(exp - iat).toBeLessThanOrEqual(600);
  });

  it("is signed with the App's private key", () => {
    const input = Buffer.from(`${header ?? ""}.${payload ?? ""}`);
    const sig = Buffer.from(signature ?? "", "base64url");
    expect(verify("sha256", input, publicKey, sig)).toBe(true);
    expect(verify("sha256", input, other.publicKey, sig)).toBe(false);
  });

  it("uses URL-safe base64 without padding", () => {
    expect(jwt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });
});
