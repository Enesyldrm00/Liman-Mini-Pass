import { defineConfig } from "drizzle-kit";

// Used only to generate SQL migrations from src/schema.ts (`pnpm --filter @liman/db generate`).
// Applying them is done by src/migrate.ts, so no database credentials are needed here.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
});
