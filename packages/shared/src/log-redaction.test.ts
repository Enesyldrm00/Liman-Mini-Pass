import { describe, expect, it } from "vitest";
import { LOG_REDACT_PATHS, SECRET_HEADERS } from "./log-redaction.js";

describe("LOG_REDACT_PATHS", () => {
  it("covers every secret header at three depths", () => {
    expect(LOG_REDACT_PATHS).toHaveLength(SECRET_HEADERS.length * 3);
    expect(LOG_REDACT_PATHS).toContain('*.headers["authorization"]');
    expect(LOG_REDACT_PATHS).toContain('*.*.headers["x-hub-signature-256"]');
  });
});
