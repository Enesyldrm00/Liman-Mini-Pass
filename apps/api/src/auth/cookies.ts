import { parseCookie } from "cookie";
import type { CookieOptions, Request } from "express";
import type { Config } from "../config/index.js";

export interface CookieNames {
  readonly session: string;
  readonly oauthState: string;
}

type NodeEnv = Config["nodeEnv"];

/**
 * In production the cookies carry the `__Host-` prefix: the browser then only accepts them
 * when they are Secure, have `Path=/` and no `Domain`, so an app on a sibling subdomain
 * cannot plant a session cookie for the panel (ROADMAP section 13). The prefix needs HTTPS,
 * so development over plain http uses the bare names.
 */
export function cookieNames(nodeEnv: NodeEnv): CookieNames {
  const prefix = nodeEnv === "production" ? "__Host-" : "";
  return { session: `${prefix}liman_session`, oauthState: `${prefix}liman_oauth_state` };
}

/**
 * httpOnly keeps the token away from page scripts. SameSite=Lax still sends the cookie on
 * the top-level redirect back from GitHub, which `Strict` would not. Lax does not stop
 * requests from sibling subdomains (same site), which is why state-changing requests also
 * need a matching Origin.
 */
export function cookieOptions(nodeEnv: NodeEnv, maxAgeMs?: number): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: nodeEnv === "production",
    ...(maxAgeMs === undefined ? {} : { maxAge: maxAgeMs }),
  };
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  return header ? parseCookie(header)[name] : undefined;
}
