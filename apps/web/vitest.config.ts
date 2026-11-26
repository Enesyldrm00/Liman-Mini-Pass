import react from "@vitejs/plugin-react";
import { defaultClientConditions } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  // Same resolution as vite.config.ts: workspace packages from source, defaults kept.
  resolve: { conditions: ["liman-source", ...defaultClientConditions] },
  test: {
    name: "@liman/web",
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
  },
});
