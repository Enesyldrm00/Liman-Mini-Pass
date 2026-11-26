import { expect, it } from "vitest";

// Temporary: proves a failing test turns CI red (0.10). Reverted in the next commit.
it("fails on purpose", () => {
  expect(1).toBe(2);
});
