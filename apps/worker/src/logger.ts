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
  };
  return destination ? pino(options, destination) : pino(options);
}
