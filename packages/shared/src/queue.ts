// The one BullMQ queue (ROADMAP section 9). The API adds jobs, the worker processes them.
// Job IDs are the ID of the row the job is about, so adding the same job twice is a no-op.

export const PIPELINE_QUEUE = "liman-pipeline";

export const JOB_NAMES = ["build", "deploy", "cleanup-app"] as const;
export type JobName = (typeof JOB_NAMES)[number];

/** `cleanup-app`: remove an app marked `deleting` (containers, routes, rows). */
export interface CleanupAppJob {
  appId: string;
}
