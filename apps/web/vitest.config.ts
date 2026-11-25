import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@liman/web",
    include: ["src/**/*.test.ts"],
    passWithNoTests: true,
  },
});
