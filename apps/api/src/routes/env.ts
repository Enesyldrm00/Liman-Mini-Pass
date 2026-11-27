import { apps, envVars, type Database, type EnvCipher } from "@liman/db";
import { MAX_ENV_VALUE_BYTES, MAX_ENV_VARS, envPutBodySchema, type EnvList } from "@liman/shared";
import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import express, { Router } from "express";
import { requireAuth } from "../middleware/session.js";
import { ownedApp, sendDeleting } from "./apps.js";
import { sendError, sendValidation } from "./helpers.js";

export interface EnvRouteDeps {
  db: Database;
  envCipher: EnvCipher;
}

/**
 * Body limit for `PUT /env`: 100 values of 32 KB each, plus room for keys and JSON. JSON
 * escaping can grow a value, so the per-value byte check in the schema is the real limit.
 * A full list of values made mostly of control characters (`\u0000` is 6 bytes escaped)
 * could still exceed it and get a 413; that is accepted.
 */
const ENV_BODY_LIMIT = MAX_ENV_VARS * MAX_ENV_VALUE_BYTES * 2;

type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];

async function listKeys(db: Database | Tx, appId: string): Promise<EnvList> {
  const rows = await db
    .select({ key: envVars.key, updatedAt: envVars.updatedAt })
    .from(envVars)
    .where(eq(envVars.appId, appId))
    .orderBy(asc(envVars.key));
  return { vars: rows.map((row) => ({ key: row.key, updatedAt: row.updatedAt.toISOString() })) };
}

/**
 * Env values are write-only through the API: they are encrypted before they reach the
 * database and never come back out. The worker decrypts them at deploy time (1.5).
 */
export function envRouter(deps: EnvRouteDeps): Router {
  const { db, envCipher } = deps;
  const router = Router();

  // Mounted before the apps router: its 16 KB JSON parser would otherwise run first. A
  // request parsed here is skipped by that parser.
  router.use("/apps/:id/env", requireAuth, express.json({ limit: ENV_BODY_LIMIT }));

  router.get("/apps/:id/env", async (req, res) => {
    const app = await ownedApp(db, req, res);
    if (app) {
      res.json(await listKeys(db, app.id));
    }
  });

  /**
   * Replaces the whole list in one transaction. Keys left out are deleted. A key sent
   * without a value (or with "") keeps its stored value; a new key must have one.
   */
  router.put("/apps/:id/env", async (req, res) => {
    const app = await ownedApp(db, req, res);
    if (!app) {
      return;
    }
    const parsed = envPutBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidation(res, "Invalid env list", parsed.error);
      return;
    }
    const entries = parsed.data.vars;

    const result = await db.transaction(async (tx) => {
      // Locks the app row: concurrent PUTs for the same app run one after the other, and a
      // DELETE cannot slip in between the status check and the writes. NO KEY UPDATE is
      // enough for both and, unlike FOR UPDATE, does not block inserts of builds or
      // deployments whose foreign key only takes a KEY SHARE lock on this row.
      const [locked] = await tx
        .select({ status: apps.status })
        .from(apps)
        .where(eq(apps.id, app.id))
        .for("no key update");
      if (locked?.status !== "active") {
        return "deleting" as const;
      }

      const existing = new Set(
        (await tx.select({ key: envVars.key }).from(envVars).where(eq(envVars.appId, app.id))).map(
          (row) => row.key,
        ),
      );
      const missing = entries
        .map((entry, index) => ({ ...entry, index }))
        .filter((entry) => !entry.value && !existing.has(entry.key));
      if (missing.length > 0) {
        return { missing: missing.map((entry) => ({ key: entry.key, index: entry.index })) };
      }

      const keys = entries.map((entry) => entry.key);
      await tx
        .delete(envVars)
        .where(
          and(
            eq(envVars.appId, app.id),
            keys.length > 0 ? notInArray(envVars.key, keys) : undefined,
          ),
        );

      const changed = entries.filter(
        (entry): entry is { key: string; value: string } => !!entry.value,
      );
      if (changed.length > 0) {
        await tx
          .insert(envVars)
          .values(
            changed.map((entry) => ({
              appId: app.id,
              key: entry.key,
              valueEnc: envCipher.encrypt(app.id, entry.key, entry.value),
            })),
          )
          .onConflictDoUpdate({
            target: [envVars.appId, envVars.key],
            set: { valueEnc: sql`excluded.value_enc`, updatedAt: sql`now()` },
          });
      }
      // Kept keys are untouched, so their `updated_at` keeps saying when they last changed.
      return listKeys(tx, app.id);
    });

    if (result === "deleting") {
      sendDeleting(res);
      return;
    }
    if ("missing" in result) {
      sendError(
        res,
        400,
        "validation_failed",
        "New keys need a value",
        result.missing.map((entry) => ({
          path: `vars.${String(entry.index)}.value`,
          message: `${entry.key} is new and needs a value`,
        })),
      );
      return;
    }
    // Keys only; the values are never logged.
    req.log.info(
      { appId: app.id, keys: result.vars.length, changed: entries.filter((e) => !!e.value).length },
      "env replaced",
    );
    res.json(result);
  });

  return router;
}
