import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api/client";
import { shouldRetry } from "./queryClient";

describe("shouldRetry", () => {
  it.each([
    ["a network error", new ApiRequestError(0, "internal", "offline"), true],
    ["a 502", new ApiRequestError(502, "upstream_failed", "GitHub"), true],
    ["a 409", new ApiRequestError(409, "conflict", "suspended"), false],
    ["a 401", new ApiRequestError(401, "unauthenticated", "signed out"), false],
    ["a 200 that failed validation", new ApiRequestError(200, "internal", "bad body"), false],
  ])("retries %s: %s", (_label, error, expected) => {
    expect(shouldRetry(0, error)).toBe(expected);
  });

  it("gives up after two retries", () => {
    const error = new ApiRequestError(502, "upstream_failed", "GitHub");
    expect(shouldRetry(1, error)).toBe(true);
    expect(shouldRetry(2, error)).toBe(false);
  });
});
