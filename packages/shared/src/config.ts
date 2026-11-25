import { z } from "zod";

// Building blocks for validating Liman's own process environment (ROADMAP 0.5, section 15).
// Each app composes its own schema from these; this file stays free of Node APIs because
// the browser panel also imports this package.

export const NODE_ENVS = ["development", "test", "production"] as const;
export const nodeEnvSchema = z.enum(NODE_ENVS);

export const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;
export const logLevelSchema = z.enum(LOG_LEVELS);

export const portSchema = z.coerce
  .number("Must be a number")
  .int("Must be an integer")
  .min(1, "Must be between 1 and 65535")
  .max(65535, "Must be between 1 and 65535");

function parseUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}

/** A URL with one of the given protocols (e.g. `["postgres:", "postgresql:"]`). */
export function urlSchema(protocols: readonly string[]) {
  return z.string().refine(
    (value) => {
      const url = parseUrl(value);
      return url !== undefined && protocols.includes(url.protocol) && url.hostname !== "";
    },
    `Must be a URL starting with ${protocols.map((p) => `${p}//`).join(" or ")}`,
  );
}

/**
 * An http(s) origin such as `http://liman.localhost`. A trailing slash is accepted; a path,
 * query, fragment or credentials are not, because the value is compared with the `Origin`
 * header. The result is the normalised origin.
 */
export const originSchema = z
  .string()
  .refine((value) => {
    const url = parseUrl(value);
    return (
      url !== undefined &&
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      url.username === "" &&
      url.password === "" &&
      !value.endsWith("?") &&
      !value.endsWith("#")
    );
  }, "Must be an http(s) origin without path, query or credentials")
  .transform((value) => new URL(value).origin);

const GITHUB_ID = /^[1-9][0-9]{0,18}$/;

/** Comma-separated GitHub user IDs, e.g. `12345678,87654321`. Empty items are ignored. */
export const githubIdListSchema = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item !== ""),
  )
  .refine((ids) => ids.length > 0, "Must contain at least one GitHub user ID")
  .refine((ids) => ids.every((id) => GITHUB_ID.test(id)), "Must be numeric GitHub user IDs")
  .transform((ids): readonly string[] => Object.freeze([...new Set(ids)]));

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Standard base64 that decodes to exactly `bytes` bytes (e.g. a 32-byte AES-256 key). */
export function base64KeySchema(bytes: number) {
  return z
    .string()
    .refine(
      (value) => BASE64.test(value) && decodedLength(value) === bytes,
      `Must be base64 encoding exactly ${String(bytes)} bytes`,
    );
}

function decodedLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** Thrown by {@link parseEnv}. The message names variables and problems, never values. */
export class EnvValidationError extends Error {
  readonly problems: readonly string[];

  constructor(problems: readonly string[]) {
    super(`Invalid environment:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.problems = problems;
  }
}

/**
 * Validates `env` against `schema`. Empty strings count as missing, so `FOO=` in an env
 * file does not silently satisfy a required variable. Error messages never include the
 * received value, which may be a secret.
 */
export function parseEnv<S extends z.ZodType>(
  schema: S,
  env: Readonly<Record<string, string | undefined>>,
): z.output<S> {
  const present = Object.fromEntries(
    Object.entries(env).filter(([, value]) => value !== undefined && value !== ""),
  );
  const result = schema.safeParse(present, { reportInput: false });
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues.map((issue) => {
    const name = issue.path.map(String).join(".") || "(root)";
    const top = issue.path[0];
    const missing = typeof top === "string" && present[top] === undefined;
    const message = missing ? "Required" : issue.message;
    return `${name}: ${message}`;
  });
  throw new EnvValidationError(problems);
}
