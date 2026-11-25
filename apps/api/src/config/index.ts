import {
  logLevelSchema,
  nodeEnvSchema,
  originSchema,
  parseEnv,
  portSchema,
  urlSchema,
} from "@liman/shared";
import { z } from "zod";

// Variables the API reads (ROADMAP section 15). Each one joins this schema in the
// subsection that starts using it, so a missing value always means a broken setup.
const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema.default("info"),
  PORT: portSchema.default(3000),
  LIMAN_PUBLIC_URL: originSchema,
  DATABASE_URL: urlSchema(["postgres:", "postgresql:"]),
  REDIS_URL: urlSchema(["redis:", "rediss:"]),
});

export interface Config {
  readonly nodeEnv: z.infer<typeof nodeEnvSchema>;
  readonly logLevel: z.infer<typeof logLevelSchema>;
  readonly port: number;
  /** Panel origin, e.g. `http://liman.localhost`; used for Origin checks and redirects. */
  readonly publicUrl: string;
  readonly databaseUrl: string;
  readonly redisUrl: string;
}

/** Reads and validates the environment once. Throws `EnvValidationError` on bad input. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = parseEnv(envSchema, env);
  return Object.freeze({
    nodeEnv: parsed.NODE_ENV,
    logLevel: parsed.LOG_LEVEL,
    port: parsed.PORT,
    publicUrl: parsed.LIMAN_PUBLIC_URL,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
  });
}
