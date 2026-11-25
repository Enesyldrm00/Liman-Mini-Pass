import { z } from "zod";

export const SUBDOMAIN_MAX_LENGTH = 40;

/** Names used by Liman itself or likely to be confused with it. */
export const RESERVED_SUBDOMAINS = [
  "api",
  "www",
  "admin",
  "liman",
  "grafana",
  "registry",
  "traefik",
] as const;

export type SubdomainError =
  | "empty"
  | "too_long"
  | "invalid_chars"
  | "leading_or_trailing_hyphen"
  | "punycode_prefix"
  | "reserved";

export type SubdomainResult = { ok: true } | { ok: false; reason: SubdomainError };

const ALLOWED = /^[a-z0-9-]+$/;
const reserved: ReadonlySet<string> = new Set(RESERVED_SUBDOMAINS);

/**
 * Checks a subdomain against the rules in ROADMAP 1.1.
 * Returns a machine-readable reason so callers can show their own message.
 */
export function validateSubdomain(value: string): SubdomainResult {
  if (value.length === 0) return { ok: false, reason: "empty" };
  if (value.length > SUBDOMAIN_MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (!ALLOWED.test(value)) return { ok: false, reason: "invalid_chars" };
  if (value.startsWith("-") || value.endsWith("-")) {
    return { ok: false, reason: "leading_or_trailing_hyphen" };
  }
  // "xn--" marks an IDN (punycode) label; it could render as a look-alike of another name.
  if (value.startsWith("xn--")) return { ok: false, reason: "punycode_prefix" };
  if (reserved.has(value)) return { ok: false, reason: "reserved" };
  return { ok: true };
}

export const subdomainSchema = z.string().superRefine((value, ctx) => {
  const result = validateSubdomain(value);
  if (!result.ok) {
    ctx.addIssue({
      code: "custom",
      message: `Invalid subdomain: ${result.reason}`,
      params: { reason: result.reason },
    });
  }
});
