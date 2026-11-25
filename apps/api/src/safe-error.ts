import { DrizzleQueryError } from "drizzle-orm";

/** The Postgres error fields that never carry row values. */
function postgresSummary(error: Error): Record<string, unknown> {
  const fields: Record<string, unknown> = { type: error.name };
  for (const key of ["code", "constraint", "table", "column"] as const) {
    const value: unknown = (error as unknown as Record<string, unknown>)[key];
    if (typeof value === "string") {
      fields[key] = value;
    }
  }
  return fields;
}

/**
 * What of an unhandled error is safe to log. A failed Drizzle query puts its SQL parameters
 * into the message, the stack and a `params` field, which would put session token hashes,
 * user data and later env values into the logs. Postgres errors themselves echo values in
 * `message` and `detail` (e.g. `Key (github_id)=(…) already exists`). For those only the
 * error code and the names of the constraint, table and column are kept.
 */
export function safeError(error: unknown): unknown {
  if (error instanceof DrizzleQueryError) {
    return {
      type: "DrizzleQueryError",
      ...(error.cause ? { cause: postgresSummary(error.cause) } : {}),
    };
  }
  return error;
}
