import { defineConfig } from "vitest/config";

export default defineConfig({
  // Load workspace packages from source instead of dist/.
  resolve: { conditions: ["liman-source"] },
  ssr: { resolve: { conditions: ["liman-source"] } },
  test: {
    name: "@liman/db",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
    // Integration tests start a Postgres container; pulling the image can take a while.
    hookTimeout: 120_000,
    testTimeout: 30_000,
  },
});
