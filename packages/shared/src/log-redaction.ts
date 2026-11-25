// Structured-log redaction shared by the API and the worker (ROADMAP section 13: secrets
// and tokens never reach the logs). Plain data so that this package stays browser-safe.

/** HTTP headers whose values are credentials or signatures. */
export const SECRET_HEADERS = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-hub-signature",
  "x-hub-signature-256",
] as const;

/**
 * pino `redact` paths. Headers are matched at the top level and up to two levels deep, so
 * `{ req: { headers } }` from pino-http and `{ err: { response: { headers } } }` from an
 * HTTP client error are both covered.
 */
export const LOG_REDACT_PATHS: readonly string[] = SECRET_HEADERS.flatMap((header) => [
  `headers["${header}"]`,
  `*.headers["${header}"]`,
  `*.*.headers["${header}"]`,
]);

export const LOG_REDACT_CENSOR = "[redacted]";
