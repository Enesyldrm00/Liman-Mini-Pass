import { z } from "zod";

/** Body of `GET /api/me`. */
export const currentUserSchema = z.object({
  id: z.uuid(),
  githubId: z.number().int().positive(),
  login: z.string(),
  avatarUrl: z.string().nullable(),
});
export type CurrentUser = z.infer<typeof currentUserSchema>;

/**
 * Reasons the sign-in callback sends the browser back to the panel with
 * `?login_error=<reason>` instead of opening a session.
 */
export const LOGIN_ERRORS = [
  "denied", // the user cancelled on GitHub
  "not_allowed", // GitHub user ID is not in LIMAN_ALLOWED_GITHUB_IDS
  "github_failed", // code exchange or user lookup failed
] as const;
export type LoginError = (typeof LOGIN_ERRORS)[number];
