import { EnvValidationError } from "@liman/shared";
import { createApp } from "./app.js";
import { loadConfig, type Config } from "./config/index.js";
import { createLogger } from "./logger.js";

function readConfig(): Config {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      // No logger yet: the log level itself comes from the config.
      process.stderr.write(`api: ${error.message}\n`);
      process.exit(1);
    }
    throw error;
  }
}

const config = readConfig();
const logger = createLogger(config);
const app = createApp({ logger });

const server = app.listen(config.port, "0.0.0.0", (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, "failed to start");
    process.exit(1);
  }
  logger.info({ port: config.port, nodeEnv: config.nodeEnv }, "api listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close(() => process.exit(0));
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
