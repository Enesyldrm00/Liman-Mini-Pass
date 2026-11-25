import type { ApiError } from "@liman/shared";
import type { RequestHandler } from "express";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for state-changing requests (ROADMAP section 13). User apps run on sibling
 * subdomains, which browsers treat as the same site, so SameSite=Lax cookies alone do not
 * stop a form posted from `evil.localhost`. Browsers always send `Origin` on such requests
 * and pages cannot forge it, so it must equal the panel origin exactly. A missing or
 * `null` Origin is rejected too.
 */
export function requireSameOrigin(publicUrl: string): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method) || req.get("origin") === publicUrl) {
      next();
      return;
    }
    const body: ApiError = { error: { code: "forbidden", message: "Origin not allowed" } };
    res.status(403).json(body);
  };
}
