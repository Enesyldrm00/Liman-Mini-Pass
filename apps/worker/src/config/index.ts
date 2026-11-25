import { logLevelSchema, nodeEnvSchema, parseEnv, urlSchema } from "@liman/shared";
import { z } from "zod";

// Variables the worker needs (ROADMAP section 15). Connection settings for the local stack
// are checked from the start; feature settings (GitHub App, encryption key, ...) join this
// schema in the subsection that starts using them.
const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema.default("info"),
  DATABASE_URL: urlSchema(["postgres:", "postgresql:"]),
  REDIS_URL: urlSchema(["redis:", "rediss:"]),
});

export interface Config {
  readonly nodeEnv: z.infer<typeof nodeEnvSchema>;
  readonly logLevel: z.infer<typeof logLevelSchema>;
  readonly databaseUrl: string;
  readonly redisUrl: string;
}

/** Reads and validates the environment once. Throws `EnvValidationError` on bad input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = parseEnv(envSchema, env);
  return Object.freeze({
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
  });
}
