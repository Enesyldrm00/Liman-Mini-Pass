import { apps, githubInstallations, type Database } from "@liman/db";
import { and, eq, notExists, notInArray, sql } from "drizzle-orm";
import type { UserInstallation } from "../auth/github.js";

export interface SyncResult {
  /** Installations inserted or refreshed for this user. */
  readonly synced: number;
  /** Rows of this user that GitHub no longer reports, and were deleted. */
  readonly removed: number;
  /** Rows GitHub no longer reports but apps still point at; left for 1.2's webhook sync. */
  readonly keptWithApps: number;
  /** Installations GitHub reports that another Liman user already owns; not taken over. */
  readonly ownedByOthers: number;
}

/**
 * Makes `github_installations` match what GitHub says this user can access. GitHub's list
 * is the only source: an `installation_id` from a query string is never written here
 * (ADR-0002). Runs in one transaction, so a failed sync leaves the old rows in place.
 */
export async function syncInstallations(
  db: Database,
  ownerId: string,
  installations: readonly UserInstallation[],
): Promise<SyncResult> {
  // One entry per installation (page boundaries can shift and repeat one), in a fixed
  // order: two concurrent syncs then lock shared rows in the same order and cannot deadlock.
  const unique = [...new Map(installations.map((item) => [item.installationId, item])).values()];
  unique.sort((x, y) => x.installationId - y.installationId);

  return db.transaction(async (tx) => {
    let synced = 0;
    for (const item of unique) {
      const values = {
        accountLogin: item.accountLogin,
        accountType: item.accountType,
        suspendedAt: item.suspendedAt,
      };
      // On conflict, update only this user's row. Someone else's row is left alone and
      // RETURNING yields nothing for it.
      const rows = await tx
        .insert(githubInstallations)
        .values({ installationId: item.installationId, ownerId, ...values })
        .onConflictDoUpdate({
          target: githubInstallations.installationId,
          set: values,
          setWhere: eq(githubInstallations.ownerId, ownerId),
        })
        .returning({ id: githubInstallations.id });
      synced += rows.length;
    }

    const ids = unique.map((item) => item.installationId);
    const gone = and(
      eq(githubInstallations.ownerId, ownerId),
      ids.length > 0 ? notInArray(githubInstallations.installationId, ids) : undefined,
    );
    // `apps.installation_ref` is ON DELETE RESTRICT, so rows with apps must not be deleted
    // here; the condition skips them instead of letting the whole transaction fail.
    const removed = await tx
      .delete(githubInstallations)
      .where(
        and(
          gone,
          notExists(
            tx
              .select({ one: sql`1` })
              .from(apps)
              .where(eq(apps.installationRef, githubInstallations.id)),
          ),
        ),
      )
      .returning({ id: githubInstallations.id });
    const kept = await tx.$count(githubInstallations, gone);

    return {
      synced,
      removed: removed.length,
      keptWithApps: kept,
      ownedByOthers: unique.length - synced,
    };
  });
}
