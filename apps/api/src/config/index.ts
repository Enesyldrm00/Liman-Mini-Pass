import {
  githubIdListSchema,
  intSchema,
  logLevelSchema,
  nodeEnvSchema,
  originSchema,
  parseEnv,
  portSchema,
  urlSchema,
} from "@liman/shared";
import { z } from "zod";

// Variables the API needs (ROADMAP section 15). Settings join this schema in the
// subsection that starts using them; the encryption key and App private key come later.
const envSchema = z.object({
  NODE_ENV: nodeEnvSchema,
  LOG_LEVEL: logLevelSchema.default("info"),
  PORT: portSchema.default(3000),
  LIMAN_PUBLIC_URL: originSchema,
  DATABASE_URL: urlSchema(["postgres:", "postgresql:"]),
  REDIS_URL: urlSchema(["redis:", "rediss:"]),
  LIMAN_ALLOWED_GITHUB_IDS: githubIdListSchema,
  SESSION_TTL_HOURS: intSchema(1, 8760).default(168),
  GITHUB_APP_CLIENT_ID: z.string(),
  GITHUB_APP_CLIENT_SECRET: z.string(),
});

export interface Config {
  readonly nodeEnv: z.infer<typeof nodeEnvSchema>;
  readonly logLevel: z.infer<typeof logLevelSchema>;
  readonly port: number;
  /** Panel origin, e.g. `http://liman.localhost`; used for Origin checks and redirects. */
  readonly publicUrl: string;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** GitHub user IDs (decimal strings) allowed to sign in. Logins are never used. */
  readonly allowedGithubIds: ReadonlySet<string>;
  readonly sessionTtlHours: number;
  readonly github: {
    readonly clientId: string;
    readonly clientSecret: string;
  };
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
    allowedGithubIds: new Set(parsed.LIMAN_ALLOWED_GITHUB_IDS),
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    github: Object.freeze({
      clientId: parsed.GITHUB_APP_CLIENT_ID,
      clientSecret: parsed.GITHUB_APP_CLIENT_SECRET,
    }),
  });
}
