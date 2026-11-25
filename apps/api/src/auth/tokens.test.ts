import { describe, expect, it } from "vitest";
import { hashToken, newToken, pkceChallenge, safeEqual } from "./tokens.js";

describe("newToken", () => {
  it("returns 32 random bytes as URL-safe base64", () => {
    const token = newToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, "base64url")).toHaveLength(32);
    expect(newToken()).not.toBe(token);
  });
});

describe("hashToken", () => {
  it("is lower-case hex SHA-256, matching the sessions.token_hash check", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(hashToken(newToken())).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("safeEqual", () => {
  it("compares strings", () => {
    expect(safeEqual("same-value", "same-value")).toBe(true);
    expect(safeEqual("same-value", "same-valuf")).toBe(false);
  });

  it("treats different lengths as unequal without throwing", () => {
    expect(safeEqual("short", "longer-value")).toBe(false);
    expect(safeEqual("", "x")).toBe(false);
  });
});

describe("pkceChallenge", () => {
  it("matches the RFC 7636 appendix B example", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });
});
