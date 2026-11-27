import { z } from "zod";
import { MAX_ENV_VARS, envKeySchema, envValueSchema } from "./env.js";
import { cursorPageSchema } from "./github.js";
import { APP_STATUSES } from "./status.js";
import { subdomainSchema } from "./subdomain.js";

// Request and response bodies of `/api/apps` and `/api/apps/:id/env` (ROADMAP 1.1, §10).

export const APP_NAME_MAX_LENGTH = 60;
export const HEALTH_PATH_MAX_LENGTH = 200;
export const BRANCH_NAME_MAX_LENGTH = 255;

/** Display name; free text without control characters. */
export const appNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(APP_NAME_MAX_LENGTH, `Name must be at most ${String(APP_NAME_MAX_LENGTH)} characters`)
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  .regex(/^[^\u0000-\u001f\u007f]*$/, "Name must not contain control characters");

/**
 * A git branch name, roughly `git check-ref-format --branch`: no spaces, control
 * characters or `~^:?*[\`, no `..`, `//` or `@{`, no leading `-` or `/`, no trailing `/`,
 * `.` or `.lock`.
 */
export const branchNameSchema = z
  .string()
  .min(1, "Branch is required")
  .max(BRANCH_NAME_MAX_LENGTH, "Branch name is too long")
  .regex(
    // eslint-disable-next-line no-control-regex -- control characters are not allowed in refs
    /^(?![-/])(?!.*(?:\.\.|\/\/|@\{))(?!.*(?:\/|\.|\.lock)$)[^\u0000- \u007f~^:?*[\\]+$/,
    "Not a valid branch name",
  );

/** The port the app listens on inside its container. */
export const appPortSchema = z
  .number()
  .int("Port must be a whole number")
  .min(1, "Port must be between 1 and 65535")
  .max(65535, "Port must be between 1 and 65535");

/**
 * Path the worker probes for health (1.5). A plain path only: no query or fragment, no
 * leading `//` (against a base URL that names a new host, e.g. `//redis:6379`), and no
 * `.` or `..` segments.
 */
export const healthPathSchema = z
  .string()
  .max(HEALTH_PATH_MAX_LENGTH, "Health path is too long")
  .regex(/^\/[A-Za-z0-9._~\-/]*$/, "Health path must start with / and contain only a path")
  .refine((path) => !path.startsWith("//"), "Health path must not start with //")
  .refine(
    (path) => !path.split("/").some((segment) => segment === "." || segment === ".."),
    "Health path must not contain . or .. segments",
  );

export const createAppBodySchema = z
  .object({
    name: appNameSchema,
    subdomain: subdomainSchema,
    /** Liman's installation ID (UUID), not GitHub's number. */
    installationId: z.uuid(),
    repoId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    branch: branchNameSchema,
    port: appPortSchema,
    healthPath: healthPathSchema.default("/"),
  })
  .strict();
export type CreateAppBody = z.input<typeof createAppBodySchema>;

/** Only these fields change after creation; the subdomain never does (ROADMAP §10). */
export const updateAppBodySchema = z
  .object({
    branch: branchNameSchema,
    port: appPortSchema,
    healthPath: healthPathSchema,
  })
  .partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, "Nothing to update");
export type UpdateAppBody = z.infer<typeof updateAppBodySchema>;

export const appSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  subdomain: z.string(),
  /** Where the app is served, e.g. `http://blog.localhost`. The panel puts it in an href. */
  url: z.url({ protocol: /^https?$/ }),
  installationId: z.uuid(),
  repoId: z.number(),
  /** For display only; matching uses `repoId`. */
  repoFullName: z.string(),
  branch: z.string(),
  port: z.number(),
  healthPath: z.string(),
  status: z.enum(APP_STATUSES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type App = z.infer<typeof appSchema>;

export const appPageSchema = cursorPageSchema(appSchema);
export type AppPage = z.infer<typeof appPageSchema>;

/** `?cursor=` for the app list: opaque to clients, base64url on the wire. */
export const appCursorSchema = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9_-]+$/, "Invalid cursor");

// --- Env -----------------------------------------------------------------------------

/** Values are never returned: the list shows which keys exist and when they changed. */
export const envVarSchema = z.object({ key: z.string(), updatedAt: z.iso.datetime() });
export const envListSchema = z.object({ vars: z.array(envVarSchema) });
export type EnvList = z.infer<typeof envListSchema>;

/**
 * `PUT /api/apps/:id/env` replaces the whole list. Keys missing from it are deleted. A key
 * sent without a value (or with an empty one) keeps its stored value; a new key needs one.
 */
export const envPutBodySchema = z
  .object({
    vars: z
      .array(
        z
          .object({
            key: envKeySchema,
            value: envValueSchema.optional(),
          })
          .strict(),
      )
      .max(MAX_ENV_VARS, `At most ${String(MAX_ENV_VARS)} variables`),
  })
  .strict()
  .superRefine((body, ctx) => {
    const seen = new Set<string>();
    body.vars.forEach((entry, index) => {
      if (seen.has(entry.key)) {
        ctx.addIssue({ code: "custom", path: ["vars", index, "key"], message: "Duplicate key" });
      }
      seen.add(entry.key);
    });
  });
export type EnvPutBody = z.infer<typeof envPutBodySchema>;
