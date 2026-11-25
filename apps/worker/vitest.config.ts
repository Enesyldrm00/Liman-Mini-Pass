import { defineConfig } from "vitest/config";

export default defineConfig({
  // Load workspace packages from source instead of dist/.
  resolve: { conditions: ["liman-source"] },
  ssr: { resolve: { conditions: ["liman-source"] } },
  test: {
    name: "@liman/worker",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
