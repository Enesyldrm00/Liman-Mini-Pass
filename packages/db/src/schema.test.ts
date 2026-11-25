/**
 * Integration tests: apply the real migrations to a throwaway Postgres (Testcontainers)
 * and check that the constraints from ROADMAP section 7 are enforced by the database.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { ACTIVE_BUILD_STATUSES, TERMINAL_BUILD_STATUSES } from "@liman/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type DbClient } from "./client.js";
import { runMigrations } from "./migrator.js";
import {
  apps,
  buildLogs,
  builds,
  deployments,
  envVars,
  githubInstallations,
  sessions,
  users,
  webhookDeliveries,
} from "./schema.js";

let container: StartedPostgreSqlContainer;
let client: DbClient;

beforeAll(async () => {
  // Same major version as infra/compose.
  container = await new PostgreSqlContainer("postgres:18.6-alpine").start();
  client = createDb(container.getConnectionUri());
  await runMigrations(client.db);
});

afterAll(async () => {
  await client.close();
  await container.stop();
});

beforeEach(async () => {
  await client.db.execute(
    sql`truncate users, sessions, github_installations, apps, env_vars, builds, build_logs, deployments, webhook_deliveries cascade`,
  );
});

/** Postgres error code of a failed query (drizzle wraps the driver error in `cause`). */
async function pgErrorCode(query: PromiseLike<unknown>): Promise<string | undefined> {
  try {
    await query;
  } catch (error) {
    const cause: unknown = error instanceof Error && error.cause ? error.cause : error;
    if (cause && typeof cause === "object" && "code" in cause && typeof cause.code === "string") {
      return cause.code;
    }
    throw error;
  }
  return undefined;
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
// ON DELETE RESTRICT reports restrict_violation, not foreign_key_violation (23503).
const RESTRICT_VIOLATION = "23001";
const CHECK_VIOLATION = "23514";

let counter = 0;
const next = () => ++counter;

async function seedApp() {
  const n = next();
  const [user] = await client.db
    .insert(users)
    .values({ githubId: 1000 + n, login: `user-${String(n)}` })
    .returning();
  if (!user) throw new Error("user not inserted");
  const [installation] = await client.db
    .insert(githubInstallations)
    .values({
      installationId: 5000 + n,
      ownerId: user.id,
      accountLogin: user.login,
      accountType: "User",
    })
    .returning();
  if (!installation) throw new Error("installation not inserted");
  const [app] = await client.db
    .insert(apps)
    .values({
      ownerId: user.id,
      installationRef: installation.id,
      name: `app-${String(n)}`,
      subdomain: `app-${String(n)}`,
      repoId: 9000 + n,
      repoFullName: `user/app-${String(n)}`,
      branch: "main",
      port: 3000,
    })
    .returning();
  if (!app) throw new Error("app not inserted");
  return { user, installation, app };
}

async function seedBuild(appId: string) {
  const [build] = await client.db
    .insert(builds)
    .values({ appId, trigger: "push", commitSha: "a".repeat(40) })
    .returning();
  if (!build) throw new Error("build not inserted");
  return build;
}

const DIGEST_REF = `localhost:5000/app@sha256:${"0".repeat(64)}`;

function deployment(appId: string, buildId: string, status: "pending" | "active") {
  return {
    appId,
    buildId,
    kind: "build" as const,
    status,
    imageRef: `localhost:5000/app-${appId}@sha256:${"0".repeat(64)}`,
  };
}

describe("migrations", () => {
  it("can be applied again without changes", async () => {
    await expect(runMigrations(client.db)).resolves.toBeUndefined();
  });

  it("fills defaults for ids, timestamps and statuses", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);

    expect(app.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(app.status).toBe("active");
    expect(app.healthPath).toBe("/");
    expect(build.status).toBe("queued");
    expect(build.queuedAt).toBeInstanceOf(Date);
  });
});

describe("deployments: at most one active per app", () => {
  it("rejects a second active deployment for the same app", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);
    await client.db.insert(deployments).values(deployment(app.id, build.id, "active"));

    const code = await pgErrorCode(
      client.db.insert(deployments).values(deployment(app.id, build.id, "active")),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("allows a new active deployment once the old one is superseded in the same transaction", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);
    const [old] = await client.db
      .insert(deployments)
      .values(deployment(app.id, build.id, "active"))
      .returning();
    if (!old) throw new Error("deployment not inserted");

    await client.db.transaction(async (tx) => {
      await tx.update(deployments).set({ status: "superseded" }).where(eq(deployments.id, old.id));
      await tx.insert(deployments).values(deployment(app.id, build.id, "active"));
    });

    const active = await client.db
      .select()
      .from(deployments)
      .where(eq(deployments.status, "active"));
    expect(active).toHaveLength(1);
    expect(active[0]?.id).not.toBe(old.id);
  });

  it("allows any number of non-active deployments, and one active per app", async () => {
    const a = await seedApp();
    const b = await seedApp();
    const buildA = await seedBuild(a.app.id);
    const buildB = await seedBuild(b.app.id);

    await client.db
      .insert(deployments)
      .values([
        deployment(a.app.id, buildA.id, "pending"),
        deployment(a.app.id, buildA.id, "pending"),
        deployment(a.app.id, buildA.id, "active"),
        deployment(b.app.id, buildB.id, "active"),
      ]);

    const rows = await client.db.select().from(deployments);
    expect(rows).toHaveLength(4);
  });
});

describe("unique constraints", () => {
  it("rejects a duplicate subdomain", async () => {
    const { app, user, installation } = await seedApp();
    const code = await pgErrorCode(
      client.db.insert(apps).values({
        ownerId: user.id,
        installationRef: installation.id,
        name: "other",
        subdomain: app.subdomain,
        repoId: 1,
        repoFullName: "user/other",
        branch: "main",
        port: 3000,
      }),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("rejects a duplicate GitHub user id", async () => {
    await client.db.insert(users).values({ githubId: 42, login: "old-login" });
    const code = await pgErrorCode(
      client.db.insert(users).values({ githubId: 42, login: "new-login" }),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("rejects a duplicate installation id", async () => {
    const { user, installation } = await seedApp();
    const code = await pgErrorCode(
      client.db.insert(githubInstallations).values({
        installationId: installation.installationId,
        ownerId: user.id,
        accountLogin: "x",
        accountType: "User",
      }),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("rejects a duplicate session token hash", async () => {
    const { user } = await seedApp();
    const session = { userId: user.id, tokenHash: "f".repeat(64), expiresAt: new Date() };
    await client.db.insert(sessions).values(session);
    expect(await pgErrorCode(client.db.insert(sessions).values(session))).toBe(UNIQUE_VIOLATION);
  });

  it("rejects the same env key twice for one app, but not across apps", async () => {
    const a = await seedApp();
    const b = await seedApp();
    await client.db.insert(envVars).values({ appId: a.app.id, key: "API_KEY", valueEnc: "v1:x" });
    await client.db.insert(envVars).values({ appId: b.app.id, key: "API_KEY", valueEnc: "v1:y" });

    const code = await pgErrorCode(
      client.db.insert(envVars).values({ appId: a.app.id, key: "API_KEY", valueEnc: "v1:z" }),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("rejects a repeated webhook delivery id", async () => {
    await client.db.insert(webhookDeliveries).values({ deliveryId: "d-1", event: "push" });
    const code = await pgErrorCode(
      client.db.insert(webhookDeliveries).values({ deliveryId: "d-1", event: "push" }),
    );
    expect(code).toBe(UNIQUE_VIOLATION);
  });

  it("rejects a repeated (build_id, seq) log line", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);
    const line = { buildId: build.id, seq: 1, stream: "stdout" as const, line: "hello" };
    await client.db.insert(buildLogs).values(line);
    expect(await pgErrorCode(client.db.insert(buildLogs).values(line))).toBe(UNIQUE_VIOLATION);
  });
});

describe("check constraints", () => {
  it("rejects an unknown build status", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);
    const code = await pgErrorCode(
      client.db.execute(sql`update builds set status = 'running' where id = ${build.id}`),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });

  it("rejects failed_stage on a build that has not failed", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);
    const code = await pgErrorCode(
      client.db.update(builds).set({ failedStage: "building" }).where(eq(builds.id, build.id)),
    );
    expect(code).toBe(CHECK_VIOLATION);

    expect(
      await pgErrorCode(
        client.db
          .update(builds)
          .set({ status: "failed", failedStage: "queued" as never })
          .where(eq(builds.id, build.id)),
      ),
    ).toBe(CHECK_VIOLATION);

    await client.db
      .update(builds)
      .set({ status: "failed", failedStage: "building" })
      .where(eq(builds.id, build.id));
  });

  it("rejects a session token that is not a lower-case hex SHA-256", async () => {
    const { user } = await seedApp();
    for (const tokenHash of ["raw-session-token", "A".repeat(64), "a".repeat(63)]) {
      expect(
        await pgErrorCode(
          client.db.insert(sessions).values({ userId: user.id, tokenHash, expiresAt: new Date() }),
        ),
      ).toBe(CHECK_VIOLATION);
    }
  });

  it("rejects an env value without the encryption version prefix", async () => {
    const { app } = await seedApp();
    expect(
      await pgErrorCode(
        client.db.insert(envVars).values({ appId: app.id, key: "SECRET", valueEnc: "plaintext" }),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("rejects image references without a digest", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);
    const tagRef = "localhost:5000/app:latest";

    expect(
      await pgErrorCode(
        client.db.update(builds).set({ imageRef: tagRef }).where(eq(builds.id, build.id)),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await pgErrorCode(
        client.db
          .insert(deployments)
          .values({ ...deployment(app.id, build.id, "pending"), imageRef: tagRef }),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("rejects unknown deployment, app and log stream values", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);

    expect(
      await pgErrorCode(
        client.db.execute(sql`update apps set status = 'paused' where id = ${app.id}`),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await pgErrorCode(
        client.db.execute(
          sql`insert into deployments (app_id, build_id, kind, image_ref) values (${app.id}, ${build.id}, 'hotfix', ${DIGEST_REF})`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
    expect(
      await pgErrorCode(
        client.db.execute(
          sql`insert into build_logs (build_id, seq, stream, line) values (${build.id}, 1, 'stdin', 'x')`,
        ),
      ),
    ).toBe(CHECK_VIOLATION);
  });

  it("rejects a port outside 1-65535", async () => {
    const { app } = await seedApp();
    const code = await pgErrorCode(
      client.db.update(apps).set({ port: 70000 }).where(eq(apps.id, app.id)),
    );
    expect(code).toBe(CHECK_VIOLATION);
  });
});

describe("deletes", () => {
  it("deleting an app removes its env vars, builds, logs and deployments", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);
    await client.db.insert(envVars).values({ appId: app.id, key: "A", valueEnc: "v1:x" });
    await client.db
      .insert(buildLogs)
      .values({ buildId: build.id, seq: 1, stream: "system", line: "x" });
    await client.db.insert(deployments).values(deployment(app.id, build.id, "active"));

    await client.db.delete(apps).where(eq(apps.id, app.id));

    expect(await client.db.select().from(envVars)).toHaveLength(0);
    expect(await client.db.select().from(builds)).toHaveLength(0);
    expect(await client.db.select().from(buildLogs)).toHaveLength(0);
    expect(await client.db.select().from(deployments)).toHaveLength(0);
  });

  it("deleting a user removes their sessions", async () => {
    const [user] = await client.db.insert(users).values({ githubId: 7, login: "u" }).returning();
    if (!user) throw new Error("user not inserted");
    await client.db
      .insert(sessions)
      .values({ userId: user.id, tokenHash: "a".repeat(64), expiresAt: new Date() });

    await client.db.delete(users).where(eq(users.id, user.id));
    expect(await client.db.select().from(sessions)).toHaveLength(0);
  });

  it("refuses to delete an installation or user that still has apps", async () => {
    const { user, installation } = await seedApp();
    expect(
      await pgErrorCode(
        client.db.delete(githubInstallations).where(eq(githubInstallations.id, installation.id)),
      ),
    ).toBe(RESTRICT_VIOLATION);
    expect(await pgErrorCode(client.db.delete(users).where(eq(users.id, user.id)))).toBe(
      RESTRICT_VIOLATION,
    );
  });
});

describe("deployments and builds", () => {
  it("rejects a deployment that points at another app's build", async () => {
    const a = await seedApp();
    const b = await seedApp();
    const buildOfB = await seedBuild(b.app.id);

    const code = await pgErrorCode(
      client.db.insert(deployments).values(deployment(a.app.id, buildOfB.id, "pending")),
    );
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("refuses to delete a build that still has deployments", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);
    await client.db.insert(deployments).values(deployment(app.id, build.id, "active"));

    const code = await pgErrorCode(client.db.delete(builds).where(eq(builds.id, build.id)));
    expect(code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("concurrency", () => {
  it("lets only one of two concurrent transactions activate a deployment", async () => {
    const { app } = await seedApp();
    const build = await seedBuild(app.id);
    const insertActive = {
      text: "insert into deployments (app_id, build_id, kind, status, image_ref) values ($1, $2, 'build', 'active', $3)",
      values: [app.id, build.id, DIGEST_REF],
    };

    const first = await client.pool.connect();
    const second = await client.pool.connect();
    try {
      await first.query("begin");
      await second.query("begin");
      await first.query(insertActive);

      // The second insert waits on the first transaction's uncommitted index entry…
      const pending = second.query(insertActive).then(
        () => undefined,
        (error: unknown) => error,
      );
      await first.query("commit");

      // …and fails once the first one commits.
      const error = await pending;
      expect(error).toMatchObject({ code: UNIQUE_VIOLATION });
      await second.query("rollback");
    } finally {
      first.release();
      second.release();
    }

    const active = await client.db
      .select()
      .from(deployments)
      .where(eq(deployments.status, "active"));
    expect(active).toHaveLength(1);
  });
});

describe("partial indexes", () => {
  async function indexDef(name: string): Promise<string> {
    const result = await client.pool.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where indexname = $1",
      [name],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`index ${name} not found`);
    return row.indexdef;
  }

  it("indexes only in-progress builds", async () => {
    const def = await indexDef("builds_active_idx");
    for (const status of ACTIVE_BUILD_STATUSES) expect(def).toContain(`'${status}'`);
    for (const status of TERMINAL_BUILD_STATUSES) expect(def).not.toContain(`'${status}'`);
  });

  it("makes deployments unique per app only while active", async () => {
    const def = await indexDef("deployments_one_active_per_app");
    expect(def).toMatch(/^CREATE UNIQUE INDEX/);
    expect(def).toContain("WHERE (status = 'active'::text)");
  });
});
