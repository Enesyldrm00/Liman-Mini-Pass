import { createSecretKey, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { EnvDecryptError, createEnvCipher, parseEncryptionKey } from "./crypto.js";

const keyBase64 = randomBytes(32).toString("base64");
const secret = parseEncryptionKey(keyBase64);
if (!secret) throw new Error("test key did not parse");
const cipher = createEnvCipher(secret);

const APP = "0b6f7c8e-1d2a-4c3b-9e8f-7a6b5c4d3e2f";
const OTHER_APP = "5e4d3c2b-1a09-4f8e-8d7c-6b5a49382716";

describe("parseEncryptionKey", () => {
  it("accepts 32 bytes of base64", () => {
    expect(parseEncryptionKey(keyBase64)?.symmetricKeySize).toBe(32);
  });

  it.each([
    ["empty", ""],
    ["16 bytes", randomBytes(16).toString("base64")],
    ["64 bytes", randomBytes(64).toString("base64")],
    ["hex", randomBytes(32).toString("hex")],
    ["base64url alphabet", `${"-".repeat(43)}=`],
    ["no padding", keyBase64.slice(0, 43)],
    ["surrounding space", ` ${keyBase64}`],
  ])("rejects %s", (_name, value) => {
    expect(parseEncryptionKey(value)).toBeNull();
  });
});

describe("createEnvCipher", () => {
  it("refuses a key of the wrong size", () => {
    expect(() => createEnvCipher(createSecretKey(randomBytes(16)))).toThrow(/32 bytes/);
  });
});

describe("encrypt / decrypt", () => {
  it.each([
    ["ascii", "postgres://user:pass@db:5432/app"],
    ["empty string", ""],
    ["unicode", "şifre 🔑 ünïcødé"],
    ["32 KB", "x".repeat(32 * 1024)],
  ])("round-trips %s", (_name, value) => {
    const stored = cipher.encrypt(APP, "DATABASE_URL", value);
    expect(cipher.decrypt(APP, "DATABASE_URL", stored)).toBe(value);
  });

  it("stores a v1-prefixed value that does not contain the plaintext", () => {
    const stored = cipher.encrypt(APP, "API_TOKEN", "super-secret-value");
    expect(stored.startsWith("v1:")).toBe(true);
    expect(stored).not.toContain("super-secret-value");
    expect(Buffer.from(stored.slice(3), "base64").toString("utf8")).not.toContain(
      "super-secret-value",
    );
  });

  it("uses a fresh nonce for every value", () => {
    const a = cipher.encrypt(APP, "K", "same");
    const b = cipher.encrypt(APP, "K", "same");
    expect(a).not.toBe(b);
    expect(Buffer.from(a.slice(3), "base64").subarray(0, 12)).not.toEqual(
      Buffer.from(b.slice(3), "base64").subarray(0, 12),
    );
  });

  it("does not decrypt when the value is moved to another app (AAD)", () => {
    const stored = cipher.encrypt(APP, "API_TOKEN", "secret");
    expect(() => cipher.decrypt(OTHER_APP, "API_TOKEN", stored)).toThrow(EnvDecryptError);
  });

  it("does not decrypt when the value is moved to another key (AAD)", () => {
    const stored = cipher.encrypt(APP, "API_TOKEN", "secret");
    expect(() => cipher.decrypt(APP, "OTHER_TOKEN", stored)).toThrow(EnvDecryptError);
  });

  it("does not decrypt with another encryption key", () => {
    const otherKey = parseEncryptionKey(randomBytes(32).toString("base64"));
    if (!otherKey) throw new Error("no key");
    const stored = cipher.encrypt(APP, "K", "secret");
    expect(() => createEnvCipher(otherKey).decrypt(APP, "K", stored)).toThrow(EnvDecryptError);
  });

  it("rejects a tampered value", () => {
    const stored = cipher.encrypt(APP, "K", "secret");
    const blob = Buffer.from(stored.slice(3), "base64");
    blob[14] = (blob[14] ?? 0) ^ 0x01;
    expect(() => cipher.decrypt(APP, "K", `v1:${blob.toString("base64")}`)).toThrow(
      EnvDecryptError,
    );
  });

  it.each([
    ["no prefix", "abc"],
    ["unknown version", "v2:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"],
    ["too short", "v1:AAAA"],
  ])("rejects %s", (_name, stored) => {
    expect(() => cipher.decrypt(APP, "K", stored)).toThrow(EnvDecryptError);
  });

  it("never puts the value in the error message", () => {
    const stored = cipher.encrypt(APP, "K", "leak-me-not");
    try {
      cipher.decrypt(OTHER_APP, "K", stored);
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain("leak-me-not");
      expect((error as Error).message).toBe("Env value could not be decrypted");
    }
  });
});
