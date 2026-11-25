import { Redis } from "ioredis";

/**
 * The API's Redis client. Commands fail fast when Redis is unreachable: ioredis would
 * otherwise queue them and retry for a long time, keeping sign-in requests hanging. The
 * rate limiter then answers 500 instead of letting the request through.
 */
export function createRedis(url: string): Redis {
  return new Redis(url, { maxRetriesPerRequest: 1, commandTimeout: 2_000 });
}
