import { createDb } from "@liman/db";
import { EnvValidationError } from "@liman/shared";
import { Redis } from "ioredis";
import { createApp } from "./app.js";
import { createGitHubAuth } from "./auth/github.js";
import { createSessionStore } from "./auth/sessions.js";
import { loadConfig, type Config } from "./config/index.js";
import { createLogger } from "./logger.js";
import { apiRoutes } from "./routes/index.js";

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

// Driver errors can carry connection details, so only the message is logged.
const dbClient = createDb(config.databaseUrl, {
  onError: (error) => {
    logger.error({ errorMessage: error.message }, "database idle connection error");
  },
});
const redis = new Redis(config.redisUrl);
redis.on("error", (error: Error) => {
  logger.error({ errorMessage: error.message }, "redis connection error");
});

const app = createApp({
  logger,
  registerRoutes: apiRoutes({
    config,
    db: dbClient.db,
    redis,
    github: createGitHubAuth(config.github),
    sessions: createSessionStore(dbClient.db, { ttlHours: config.sessionTtlHours }),
  }),
});

const server = app.listen(config.port, "0.0.0.0", (error?: Error) => {
  if (error) {
    logger.fatal({ err: error }, "failed to start");
    process.exit(1);
  }
  logger.info({ port: config.port, nodeEnv: config.nodeEnv }, "api listening");
});

function shutdown(signal: string): void {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    void Promise.allSettled([dbClient.close(), redis.quit()]).then(() => process.exit(0));
  });
}

process.on("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  shutdown("SIGINT");
});
