import { z } from "zod";

export const MAX_ENV_VARS = 100;
/** Limit is in bytes (UTF-8), because it protects storage, not the number of characters. */
export const MAX_ENV_VALUE_BYTES = 32 * 1024;

/** Upper-case letters, digits and underscores; must not start with a digit. */
const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
/** `PORT` is set by Liman; the `LIMAN_` prefix is kept for Liman's own variables. */
const RESERVED_ENV_KEY = /^(PORT$|LIMAN_)/;

export const MAX_ENV_KEY_LENGTH = 128;

export const envKeySchema = z
  .string()
  .max(MAX_ENV_KEY_LENGTH, `Env key must be at most ${String(MAX_ENV_KEY_LENGTH)} characters`)
  .regex(ENV_KEY_PATTERN, "Env key must be upper-case letters, digits and underscores")
  .refine((key) => !RESERVED_ENV_KEY.test(key), "Env key is reserved");

// TextEncoder instead of Buffer: this package is also used by the browser panel.
const encoder = new TextEncoder();

export const envValueSchema = z
  .string()
  .refine(
    (value) => encoder.encode(value).byteLength <= MAX_ENV_VALUE_BYTES,
    `Env value must be at most ${String(MAX_ENV_VALUE_BYTES)} bytes`,
  );
