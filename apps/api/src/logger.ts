import { pino, type DestinationStream, type Logger } from "pino";
import type { Config } from "./config/index.js";

/**
 * Header values that must never reach the logs: session cookies, credentials and the
 * webhook signature. Paths match pino-http's `req`/`res` serializers.
 */
export const REDACTED_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-hub-signature"]',
  'req.headers["x-hub-signature-256"]',
  'res.headers["set-cookie"]',
];

export function createLogger(
  config: Pick<Config, "logLevel">,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.logLevel,
    base: { service: "api" },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
  };
  return destination ? pino(options, destination) : pino(options);
}
