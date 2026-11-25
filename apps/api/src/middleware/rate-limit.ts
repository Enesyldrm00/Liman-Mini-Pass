import { isIPv4, isIPv6 } from "node:net";
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
 * The part of a client address that identifies one client. An IPv6 user usually controls a
 * whole /64 and can pick a new address per request, so IPv6 addresses count per /64.
 * IPv4-mapped IPv6 (`::ffff:203.0.113.1`) counts as the IPv4 address.
 */
export function clientKey(ip: string): string {
  const mapped = /^::ffff:(.+)$/i.exec(ip)?.[1];
  if (mapped && isIPv4(mapped)) {
    return mapped;
  }
  const address = ip.split("%", 1)[0] ?? "";
  if (!isIPv6(address)) {
    return ip;
  }
  // A trailing dotted IPv4 part stands for two 16-bit groups.
  const groupsOf = (part: string) =>
    part === "" ? [] : part.split(":").flatMap((g) => (g.includes(".") ? ["0", "0"] : [g]));
  const [head = "", tail] = address.split("::");
  const left = groupsOf(head);
  const right = tail === undefined ? [] : groupsOf(tail);
  const groups =
    tail === undefined
      ? left
      : [...left, ...Array<string>(8 - left.length - right.length).fill("0"), ...right];
  const prefix = groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16));
  return `${prefix.join(":")}::/64`;
}

/**
 * Fixed-window limit per client IP, counted in Redis so it survives restarts and is shared
 * by every API process. `SET … NX EX` and `INCR` run in one MULTI: the window always gets
 * an expiry, even if the process dies between the two commands.
 *
 * If Redis is down the request fails (500) instead of skipping the limit; the client from
 * `createRedis` gives up quickly instead of queueing the command.
 */
export function rateLimit(options: RateLimitOptions): RequestHandler {
  return async (req, res, next) => {
    const key = `ratelimit:${options.name}:${clientKey(req.ip ?? "unknown")}`;
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
