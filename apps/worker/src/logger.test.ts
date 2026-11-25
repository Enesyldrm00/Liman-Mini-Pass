import { describe, expect, it } from "vitest";
import { createLogger } from "./logger.js";

function capture() {
  const lines: Record<string, unknown>[] = [];
  const logger = createLogger(
    { logLevel: "info" },
    {
      write(chunk: string) {
        lines.push(JSON.parse(chunk) as Record<string, unknown>);
      },
    },
  );
  return { logger, lines };
}

describe("worker logger", () => {
  it("writes JSON with the service name", () => {
    const { logger, lines } = capture();
    logger.info("hello");
    expect(lines[0]).toMatchObject({ level: 30, service: "worker", msg: "hello" });
  });

  it("redacts secret headers at any supported depth", () => {
    const { logger, lines } = capture();
    logger.error(
      {
        headers: { authorization: "token ghs_top" },
        request: { headers: { authorization: "Bearer ghs_one" } },
        err: { response: { headers: { "set-cookie": "s=ghs_two" } } },
      },
      "github call failed",
    );
    expect(JSON.stringify(lines)).not.toContain("ghs_");
    expect(lines[0]).toMatchObject({
      headers: { authorization: "[redacted]" },
      request: { headers: { authorization: "[redacted]" } },
      err: { response: { headers: { "set-cookie": "[redacted]" } } },
    });
  });
});
