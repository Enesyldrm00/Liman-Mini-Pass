import { users, type Database } from "@liman/db";
import type { GitHubUser } from "./github.js";
import type { SessionUser } from "./sessions.js";

/**
 * Creates or refreshes the user for a GitHub account. Rows are matched by the numeric
 * GitHub ID, so a renamed login updates the same user instead of creating a new one.
 */
export async function upsertUser(db: Database, gh: GitHubUser, now: Date): Promise<SessionUser> {
  const [row] = await db
    .insert(users)
    .values({ githubId: gh.id, login: gh.login, avatarUrl: gh.avatarUrl, lastLoginAt: now })
    .onConflictDoUpdate({
      target: users.githubId,
      set: { login: gh.login, avatarUrl: gh.avatarUrl, lastLoginAt: now },
    })
    .returning({
      id: users.id,
      githubId: users.githubId,
      login: users.login,
      avatarUrl: users.avatarUrl,
    });
  if (!row) {
    throw new Error("upsertUser: no row returned");
  }
  return row;
}
