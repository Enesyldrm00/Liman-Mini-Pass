import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 32 random bytes, URL-safe base64. Used for session tokens and OAuth `state`. */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Lower-case hex SHA-256. Only this digest of a session token is stored (ROADMAP section 7),
 * so a leaked `sessions` table cannot be replayed as cookies.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** Constant-time string comparison. Different lengths compare unequal right away. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

/**
 * PKCE S256 challenge for a verifier (RFC 7636): base64url(sha256(verifier)). A verifier
 * from {@link newToken} is 43 URL-safe characters, the minimum length the RFC allows.
 */
export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
