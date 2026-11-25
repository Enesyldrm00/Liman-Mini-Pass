import type { ApiError } from "@liman/shared";
import type { RequestHandler } from "express";
import type { Redis } from "ioredis";

export interface RateLimitOptions {
  redis: Redis;
  /** Bucket name, part of the Redis key. */
  name: string;
  /** Requests allowed per client IP and window. */
  limit: number;
  windowSeconds: number;
}

/**
 * Fixed-window limit per client IP, counted in Redis so it survives restarts and is shared
 * by every API process. `SET … NX EX` and `INCR` run in one MULTI: the window always gets
 * an expiry, even if the process dies between the two commands.
 *
 * If Redis is down the request fails (500) instead of skipping the limit.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const key = `ratelimit:${options.name}:${req.ip ?? "unknown"}`;
    const results = await options.redis
      .multi()
      .set(key, 0, "EX", options.windowSeconds, "NX")
      .incr(key)
      .ttl(key)
      .exec();
    const failed = !results || results.some(([error]) => error !== null);
    if (failed) {
      throw new Error(`rate limit: redis transaction failed for ${options.name}`);
    }
    const count = Number(results[1]?.[1]);
    if (count <= options.limit) {
      next();
      return;
    }
    const ttl = Number(results[2]?.[1]);
    res.setHeader("retry-after", String(ttl > 0 ? ttl : options.windowSeconds));
    const body: ApiError = { error: { code: "rate_limited", message: "Too many requests" } };
    res.status(429).json(body);
  };
}
