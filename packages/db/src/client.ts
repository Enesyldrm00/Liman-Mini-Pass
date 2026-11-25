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

export function createDb(connectionString: string): DbClient {
  const pool = new pg.Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
