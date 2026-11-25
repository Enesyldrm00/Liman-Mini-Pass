import { EnvValidationError } from "@liman/shared";
import { loadConfig, type Config } from "./config/index.js";
import { createLogger } from "./logger.js";

// Placeholder worker: stays alive until the BullMQ processor arrives in 1.3.

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // No logger yet: the log level itself comes from the config.
      process.stderr.write(`worker: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = createLogger(config);

logger.info({ nodeEnv: config.nodeEnv }, "worker started, waiting for jobs (none yet)");

const keepAlive = setInterval(() => undefined, 60_000);

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  clearInterval(keepAlive);
  process.exit(0);
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
