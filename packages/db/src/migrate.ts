/**
 * One-shot migration runner, used by the `migrate` service in infra/compose.
 * Exits non-zero on failure so the services that wait for it do not start.
 */
import { createDb } from "./client.js";
import { runMigrations } from "./migrator.js";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: DATABASE_URL is not set");
  process.exit(1);
}

const client = createDb(url);
try {
  await runMigrations(client.db);
  console.log("migrate: database is up to date");
} catch (error) {
  // Log only the message: the error object may carry connection details.
  console.error("migrate: failed:", error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await client.close();
}
