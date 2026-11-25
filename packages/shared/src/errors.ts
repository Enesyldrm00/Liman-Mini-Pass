import { z } from "zod";

/** Error codes used in API responses (ROADMAP section 10). */
export const ERROR_CODES = [
  "validation_failed", // 400
  "unauthenticated", // 401
  "forbidden", // 403: not the owner, or bad Origin
  "not_found", // 404
  "conflict", // 409: subdomain taken, build not cancellable
  "rate_limited", // 429
  "internal", // 500
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Every error response has this shape: `{ error: { code, message, details? } }`. */
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum(ERROR_CODES),
    message: z.string(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
