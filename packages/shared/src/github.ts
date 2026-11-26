import { z } from "zod";

// Response bodies of the `/api/github/*` endpoints (ROADMAP 0.8, section 10).

/** One page of a cursor-paginated list. `nextCursor` is opaque; null on the last page. */
export function cursorPageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
  });
}

/**
 * `?cursor=` query value. Callers treat it as opaque; today it is GitHub's page number,
 * capped so a crafted cursor cannot make the API walk thousands of pages.
 */
export const cursorSchema = z.string().regex(/^[1-9][0-9]{0,2}$/, "Invalid cursor");

/** A GitHub App installation the signed-in user owns in Liman. */
export const installationSchema = z.object({
  /** Liman's id, used in `/api/github/installations/:id/...`. */
  id: z.uuid(),
  /** GitHub's numeric installation ID. */
  installationId: z.number().int().positive(),
  accountLogin: z.string(),
  /** `User` or `Organization`. */
  accountType: z.string(),
  /** A suspended installation cannot list repositories until it is unsuspended on GitHub. */
  suspended: z.boolean(),
});
export type Installation = z.infer<typeof installationSchema>;

/** Body of `GET /api/github/installations`. */
export const installationListSchema = z.object({
  installations: z.array(installationSchema),
  /** Where the panel sends the user to install the App or change its repositories. */
  installUrl: z.url(),
});
export type InstallationList = z.infer<typeof installationListSchema>;

export const repoSchema = z.object({
  /** Stable GitHub repository ID; apps are matched by this, not by name (ROADMAP section 7). */
  id: z.number().int().positive(),
  name: z.string(),
  /** `owner/name`, for display only: it changes when the repository is renamed. */
  fullName: z.string(),
  private: z.boolean(),
  defaultBranch: z.string(),
});
export type Repo = z.infer<typeof repoSchema>;

export const branchSchema = z.object({
  name: z.string(),
  commitSha: z.string(),
});
export type Branch = z.infer<typeof branchSchema>;

/** Body of `GET /api/github/installations/:id/repos`. */
export const repoPageSchema = cursorPageSchema(repoSchema);
export type RepoPage = z.infer<typeof repoPageSchema>;

/** Body of `GET /api/github/installations/:id/repos/:repoId/branches`. */
export const branchPageSchema = cursorPageSchema(branchSchema);
export type BranchPage = z.infer<typeof branchPageSchema>;
