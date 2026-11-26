import { sign, type KeyObject } from "node:crypto";

/**
 * GitHub accepts App JWTs that live at most 10 minutes. `iat` is moved 60 seconds into the
 * past so a server clock slightly ahead of GitHub's does not produce a token "from the
 * future"; `exp` stays within the 10-minute window measured from that `iat`.
 */
export const JWT_BACKDATE_SECONDS = 60;
export const JWT_LIFETIME_SECONDS = 9 * 60;

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

/**
 * A JSON Web Token that authenticates as the GitHub App itself (RS256, signed with the
 * App's private key). It is only good for App endpoints such as minting installation
 * tokens; it cannot read repositories.
 */
export function createAppJwt(appId: number, privateKey: KeyObject, now: Date): string {
  const seconds = Math.floor(now.getTime() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iat: seconds - JWT_BACKDATE_SECONDS,
    exp: seconds + JWT_LIFETIME_SECONDS,
    iss: String(appId),
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const signature = sign("sha256", Buffer.from(signingInput), privateKey);
  return `${signingInput}.${base64url(signature)}`;
}
