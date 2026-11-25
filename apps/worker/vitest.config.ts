import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@liman/worker",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
