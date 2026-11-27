import { parseEncryptionKey } from "@liman/db";
import {
  base64KeySchema,
  githubIdListSchema,
  intSchema,
  logLevelSchema,
  nodeEnvSchema,
  originSchema,
  parseEnv,
  portSchema,
  urlSchema,
} from "@liman/shared";
import { createPrivateKey, type KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

/** GitHub App slugs are lower-case letters, digits and dashes (e.g. `liman-dev-06`). */
const appSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/, "Must be a GitHub App slug");

/**
 * A path to the App's RSA private key in PEM form, read and parsed at startup. A missing or
 * broken key fails here instead of at the first GitHub call. Relative paths resolve against
 * the working directory. The key itself never appears in an error message.
 */
const privateKeyFileSchema = z.string().transform((path, ctx): KeyObject => {
  let pem: string;
  try {
    pem = readFileSync(resolve(path), "utf8");
  } catch {
    ctx.addIssue({ code: "custom", message: "Cannot read the file" });
    return z.NEVER;
  }
  try {
    const key = createPrivateKey(pem);
    if (key.asymmetricKeyType === "rsa") {
      return key;
    }
  } catch {
    // Reported below; the parser's message could quote part of the file.
  }
  ctx.addIssue({ code: "custom", message: "Must be an RSA private key in PEM form" });
  return z.NEVER;
});

/** A bare DNS name such as `localhost` or `apps.example.com`; apps live at `<sub>.<this>`. */
const baseDomainSchema = z
  .string()
  .regex(
    /^(?=.{1,200}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/,
    "Must be a lower-case domain name",
  );

/** AES-256 key for env values (ROADMAP section 7), parsed once at startup. */
const encryptionKeySchema = base64KeySchema(32).transform((value, ctx): KeyObject => {
  const key = parseEncryptionKey(value);
  if (!key) {
    ctx.addIssue({ code: "custom", message: "Must be base64 encoding exactly 32 bytes" });
    return z.NEVER;
  }
  return key;
});

// Variables the API needs (ROADMAP section 15). Settings join this schema in the
// subsection that starts using them.
const envSchema = z
  .object({
    NODE_ENV: nodeEnvSchema,
    LOG_LEVEL: logLevelSchema.default("info"),
    PORT: portSchema.default(3000),
    LIMAN_PUBLIC_URL: originSchema,
    LIMAN_BASE_DOMAIN: baseDomainSchema,
    DATABASE_URL: urlSchema(["postgres:", "postgresql:"]),
    REDIS_URL: urlSchema(["redis:", "rediss:"]),
    LIMAN_ENCRYPTION_KEY: encryptionKeySchema,
    LIMAN_ALLOWED_GITHUB_IDS: githubIdListSchema,
    SESSION_TTL_HOURS: intSchema(1, 8760).default(168),
    GITHUB_APP_CLIENT_ID: z.string(),
    GITHUB_APP_CLIENT_SECRET: z.string(),
    GITHUB_APP_ID: intSchema(1, Number.MAX_SAFE_INTEGER),
    GITHUB_APP_SLUG: appSlugSchema,
    GITHUB_APP_PRIVATE_KEY_PATH: privateKeyFileSchema,
  })
  // Production cookies are Secure and `__Host-` prefixed, which only works over HTTPS.
  // Over plain http sign-in would silently fail, and without the prefix an app on a
  // sibling subdomain could plant a session cookie (ROADMAP section 13).
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.LIMAN_PUBLIC_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["LIMAN_PUBLIC_URL"],
        message: "Must be an https origin when NODE_ENV is production",
      });
    }
  });

export interface Config {
  readonly nodeEnv: z.infer<typeof nodeEnvSchema>;
  readonly logLevel: z.infer<typeof logLevelSchema>;
  readonly port: number;
  /** Panel origin, e.g. `http://liman.localhost`; used for Origin checks and redirects. */
  readonly publicUrl: string;
  /** Apps are served at `<subdomain>.<baseDomain>`. */
  readonly baseDomain: string;
  readonly databaseUrl: string;
  readonly redisUrl: string;
  /** Encrypts env values. Never logged; a KeyObject does not serialise its bytes. */
  readonly encryptionKey: KeyObject;
  /** GitHub user IDs (decimal strings) allowed to sign in. Logins are never used. */
  readonly allowedGithubIds: ReadonlySet<string>;
  readonly sessionTtlHours: number;
  readonly github: {
    readonly clientId: string;
    readonly clientSecret: string;
    readonly appId: number;
    readonly appSlug: string;
    /** Signs App JWTs. Never logged; a KeyObject does not serialise its key material. */
    readonly privateKey: KeyObject;
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
    baseDomain: parsed.LIMAN_BASE_DOMAIN,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    encryptionKey: parsed.LIMAN_ENCRYPTION_KEY,
    allowedGithubIds: new Set(parsed.LIMAN_ALLOWED_GITHUB_IDS),
    sessionTtlHours: parsed.SESSION_TTL_HOURS,
    github: Object.freeze({
      clientId: parsed.GITHUB_APP_CLIENT_ID,
      clientSecret: parsed.GITHUB_APP_CLIENT_SECRET,
      appId: parsed.GITHUB_APP_ID,
      appSlug: parsed.GITHUB_APP_SLUG,
      privateKey: parsed.GITHUB_APP_PRIVATE_KEY_PATH,
    }),
  });
}
