import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const workerDir = fileURLToPath(new URL("..", import.meta.url));

/** Starts the real entry point with only the given variables (plus what Node needs). */
function startWorker(env: Record<string, string>) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", "--conditions=liman-source", "src/index.ts"],
    {
      cwd: workerDir,
      encoding: "utf8",
      timeout: 20_000,
      env: {
        PATH: process.env.PATH ?? "",
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        ...env,
      },
    },
  );
}

describe("worker startup", () => {
  it("exits with code 1 before starting when the environment is invalid", () => {
    const result = startWorker({
      NODE_ENV: "development",
      DATABASE_URL: "mysql://admin:topsecret@db/liman",
    });

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("worker started");
    expect(result.stderr).toContain("REDIS_URL: Required");
    expect(result.stderr).toContain("DATABASE_URL:");
    expect(result.stderr).not.toContain("topsecret");
  }, 30_000);
});
