import { PIPELINE_QUEUE, type CleanupAppJob, type JobName } from "@liman/shared";
import { Queue } from "bullmq";

/** What the API puts on the pipeline queue. Only `cleanup-app` so far (1.1). */
export interface PipelineQueue {
  /**
   * Makes sure a `cleanup-app` job exists for the app. Safe to call again: the job ID is
   * the app ID, so a waiting job is not duplicated, and a job that failed is retried.
   */
  ensureCleanupApp(appId: string): Promise<void>;
  close(): Promise<void>;
}

/** Tries once and fails fast, like the API's other Redis client (see redis.ts). */
export function createPipelineQueue(redisUrl: string): PipelineQueue {
  const queue = new Queue<CleanupAppJob, void, JobName>(PIPELINE_QUEUE, {
    connection: { url: redisUrl, maxRetriesPerRequest: 1, commandTimeout: 2_000 },
    skipWaitingForReady: true,
    defaultJobOptions: {
      // One attempt: a failed job is not retried by itself (ROADMAP section 9).
      attempts: 1,
      removeOnComplete: 1000,
    },
  });
  return pipelineQueueFrom(queue);
}

/** Wraps an existing queue; tests use it with a queue on a test container. */
export function pipelineQueueFrom(queue: Queue<CleanupAppJob, void, JobName>): PipelineQueue {
  return {
    async ensureCleanupApp(appId) {
      const existing = await queue.getJob(appId);
      if (existing && (await existing.isFailed())) {
        await existing.retry();
        return;
      }
      // A waiting, active or completed job with this ID makes `add` a no-op.
      await queue.add("cleanup-app", { appId }, { jobId: appId });
    },
    close: () => queue.close(),
  };
}
