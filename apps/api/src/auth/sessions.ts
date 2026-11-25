import { sessions, users, type Database } from "@liman/db";
import { and, eq, lte } from "drizzle-orm";
import { hashToken, newToken } from "./tokens.js";

export interface SessionUser {
  readonly id: string;
  readonly githubId: number;
  readonly login: string;
  readonly avatarUrl: string | null;
}

export interface AuthContext {
  readonly sessionId: string;
  readonly user: SessionUser;
}

export interface SessionStore {
  /** Opens a session and returns the raw token for the cookie. Only its hash is stored. */
  create(userId: string): Promise<{ token: string; expiresAt: Date }>;
  /** The live session for a token, or null. An expired session is deleted on the way. */
  find(token: string): Promise<AuthContext | null>;
  /** Deletes the session for a token, if any. */
  delete(token: string): Promise<void>;
  deleteById(sessionId: string): Promise<void>;
}

/** `last_seen_at` is informational, so it is written at most this often per session. */
const LAST_SEEN_INTERVAL_MS = 5 * 60 * 1000;

export interface SessionStoreOptions {
  /** Fixed lifetime from creation; activity does not extend it (ADR-0003). */
  ttlHours: number;
  now?: () => Date;
}

export function createSessionStore(db: Database, options: SessionStoreOptions): SessionStore {
  const now = options.now ?? (() => new Date());
  const ttlMs = options.ttlHours * 60 * 60 * 1000;

  return {
    async create(userId) {
      const createdAt = now();
      const expiresAt = new Date(createdAt.getTime() + ttlMs);
      const token = newToken();
      // Housekeeping: drop this user's expired sessions instead of letting them pile up.
      await db
        .delete(sessions)
        .where(and(eq(sessions.userId, userId), lte(sessions.expiresAt, createdAt)));
      await db.insert(sessions).values({
        userId,
        tokenHash: hashToken(token),
        createdAt,
        expiresAt,
        lastSeenAt: createdAt,
      });
      return { token, expiresAt };
    },

    async find(token) {
      const [row] = await db
        .select({
          sessionId: sessions.id,
          expiresAt: sessions.expiresAt,
          lastSeenAt: sessions.lastSeenAt,
          user: {
            id: users.id,
            githubId: users.githubId,
            login: users.login,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(eq(sessions.tokenHash, hashToken(token)))
        .limit(1);
      if (!row) {
        return null;
      }
      const current = now();
      if (row.expiresAt.getTime() <= current.getTime()) {
        await db.delete(sessions).where(eq(sessions.id, row.sessionId));
        return null;
      }
      const staleBefore = new Date(current.getTime() - LAST_SEEN_INTERVAL_MS);
      if (row.lastSeenAt.getTime() <= staleBefore.getTime()) {
        // The condition is repeated in the UPDATE, so concurrent requests write it once.
        await db
          .update(sessions)
          .set({ lastSeenAt: current })
          .where(and(eq(sessions.id, row.sessionId), lte(sessions.lastSeenAt, staleBefore)));
      }
      return { sessionId: row.sessionId, user: row.user };
    },

    async delete(token) {
      await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
    },

    async deleteById(sessionId) {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    },
  };
}
