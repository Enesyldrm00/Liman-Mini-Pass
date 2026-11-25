/**
 * Status constants shared by API, worker and panel.
 * Each list is the single source of truth; the matching union type is derived from it.
 * See ROADMAP section 8 for the state machines.
 */

export const BUILD_STATUSES = [
  "queued",
  "cloning",
  "building",
  "pushing",
  "deploying",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

/** Statuses in which a build is still in progress (used for the partial index and the reaper). */
export const ACTIVE_BUILD_STATUSES = [
  "queued",
  "cloning",
  "building",
  "pushing",
  "deploying",
] as const satisfies readonly BuildStatus[];

export const TERMINAL_BUILD_STATUSES = [
  "succeeded",
  "failed",
  "cancelled",
] as const satisfies readonly BuildStatus[];

/** The API may only cancel a build directly while it is still queued; later stages use the cancel flag. */
export const API_CANCELLABLE_BUILD_STATUSES = ["queued"] as const satisfies readonly BuildStatus[];

/** Stages the worker can cancel via the cancel flag. `deploying` is never cancelled. */
export const WORKER_CANCELLABLE_BUILD_STATUSES = [
  "cloning",
  "building",
  "pushing",
] as const satisfies readonly BuildStatus[];

export const BUILD_STAGES = ["cloning", "building", "pushing", "deploying"] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];

export const BUILD_TRIGGERS = ["push", "manual"] as const;
export type BuildTrigger = (typeof BUILD_TRIGGERS)[number];

export const DEPLOYMENT_STATUSES = ["pending", "active", "superseded", "failed"] as const;
export type DeploymentStatus = (typeof DEPLOYMENT_STATUSES)[number];

export const DEPLOYMENT_KINDS = ["build", "rollback", "redeploy"] as const;
export type DeploymentKind = (typeof DEPLOYMENT_KINDS)[number];

export const APP_STATUSES = ["active", "deleting"] as const;
export type AppStatus = (typeof APP_STATUSES)[number];

export const LOG_STREAMS = ["stdout", "stderr", "system"] as const;
export type LogStream = (typeof LOG_STREAMS)[number];

const terminal: ReadonlySet<BuildStatus> = new Set(TERMINAL_BUILD_STATUSES);

export function isTerminalBuildStatus(status: BuildStatus): boolean {
  return terminal.has(status);
}
