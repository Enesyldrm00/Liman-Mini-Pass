import { describe, expect, it } from "vitest";
import { apiErrorSchema } from "./errors.js";

describe("apiErrorSchema", () => {
  it("accepts the standard error shape", () => {
    const body = { error: { code: "conflict", message: "Subdomain is taken" } };
    expect(apiErrorSchema.parse(body)).toEqual(body);
  });

  it("keeps optional details", () => {
    const body = {
      error: { code: "validation_failed", message: "Bad input", details: [{ path: "port" }] },
    };
    expect(apiErrorSchema.parse(body).error.details).toEqual([{ path: "port" }]);
  });

  it("rejects unknown codes", () => {
    expect(apiErrorSchema.safeParse({ error: { code: "oops", message: "x" } }).success).toBe(false);
  });
});
