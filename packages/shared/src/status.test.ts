import { describe, expect, it } from "vitest";
import {
  ACTIVE_BUILD_STATUSES,
  API_CANCELLABLE_BUILD_STATUSES,
  BUILD_STATUSES,
  TERMINAL_BUILD_STATUSES,
  WORKER_CANCELLABLE_BUILD_STATUSES,
  isTerminalBuildStatus,
} from "./status.js";

describe("build statuses", () => {
  it("splits every status into exactly one of active or terminal", () => {
    const active = new Set<string>(ACTIVE_BUILD_STATUSES);
    const terminal = new Set<string>(TERMINAL_BUILD_STATUSES);

    for (const status of BUILD_STATUSES) {
      expect(active.has(status) !== terminal.has(status)).toBe(true);
    }
    expect(active.size + terminal.size).toBe(BUILD_STATUSES.length);
  });

  it("never allows cancelling a deploying build", () => {
    expect(API_CANCELLABLE_BUILD_STATUSES).not.toContain("deploying");
    expect(WORKER_CANCELLABLE_BUILD_STATUSES).not.toContain("deploying");
  });

  it("reports terminal statuses", () => {
    expect(isTerminalBuildStatus("succeeded")).toBe(true);
    expect(isTerminalBuildStatus("cancelled")).toBe(true);
    expect(isTerminalBuildStatus("queued")).toBe(false);
    expect(isTerminalBuildStatus("deploying")).toBe(false);
  });
});
