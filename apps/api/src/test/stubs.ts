import type { PipelineQueue } from "../queue.js";

/** For tests that never delete apps; any call fails the test. */
export const unusedPipeline: PipelineQueue = {
  ensureCleanupApp: () => Promise.reject(new Error("pipeline queue not used in this test")),
  close: () => Promise.resolve(),
};
