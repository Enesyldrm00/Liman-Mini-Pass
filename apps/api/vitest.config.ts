import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@liman/api",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
