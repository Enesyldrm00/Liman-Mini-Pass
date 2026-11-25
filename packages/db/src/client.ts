import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export type Database = NodePgDatabase<typeof schema>;

export interface DbClient {
  db: Database;
  /** The underlying pool; also used for session-level work such as advisory locks. */
  pool: pg.Pool;
  close: () => Promise<void>;
}

export interface CreateDbOptions {
  /**
   * Called when an idle pooled connection fails (e.g. Postgres restarted). The pool drops
   * that connection and opens a new one on the next query. Without a listener Node treats
   * the event as unhandled and the whole process exits.
   */
  onError?: (error: Error) => void;
}

// Only the message: driver errors can carry connection details. Replaced by pino in 0.5.
const logPoolError = (error: Error): void => {
  console.error("db: idle connection error:", error.message);
};

export function createDb(connectionString: string, options: CreateDbOptions = {}): DbClient {
  const pool = new pg.Pool({ connectionString });
  pool.on("error", options.onError ?? logPoolError);
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
