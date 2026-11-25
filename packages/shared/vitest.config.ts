import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@liman/shared",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
