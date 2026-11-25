import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS } from "@liman/shared";
import { pino, type DestinationStream, type Logger } from "pino";
import type { Config } from "./config/index.js";

export function createLogger(
  config: Pick<Config, "logLevel">,
  destination?: DestinationStream,
): Logger {
  const options = {
    level: config.logLevel,
    base: { service: "worker" },
    timestamp: pino.stdTimeFunctions.isoTime,
    // Same header redaction as the API, e.g. for HTTP client errors from GitHub calls.
    redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR },
  };
  return destination ? pino(options, destination) : pino(options);
}
