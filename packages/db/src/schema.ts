/**
 * Database schema (ROADMAP section 7).
 *
 * Status-like columns are `text` with a CHECK constraint built from the constants in
 * `@liman/shared`, instead of Postgres enums: adding or removing a value is then a plain
 * constraint change in a migration (ADR-0018).
 */
import {
  APP_STATUSES,
  ACTIVE_BUILD_STATUSES,
  BUILD_STAGES,
  BUILD_STATUSES,
  BUILD_TRIGGERS,
  DEPLOYMENT_KINDS,
  DEPLOYMENT_STATUSES,
  LOG_STREAMS,
  type AppStatus,
  type BuildStage,
  type BuildStatus,
  type BuildTrigger,
  type DeploymentKind,
  type DeploymentStatus,
  type LogStream,
} from "@liman/shared";
import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

/**
 * `column IN ('a', 'b', …)` with the values inlined as literals.
 * CHECK constraints and index predicates cannot take bind parameters, so the values are
 * written into the SQL. They only ever come from the constant lists above, never from input.
 */
function inList(column: AnyPgColumn, values: readonly string[]): SQL {
  const literals = values.map((value) => sql.raw(`'${value.replaceAll("'", "''")}'`));
  return sql`${column} in (${sql.join(literals, sql`, `)})`;
}

const id = () => uuid("id").primaryKey().defaultRandom();
const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => timestamptz("created_at").notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  githubId: bigint("github_id", { mode: "number" }).notNull().unique(),
  login: text("login").notNull(),
  avatarUrl: text("avatar_url"),
  createdAt: createdAt(),
  lastLoginAt: timestamptz("last_login_at").notNull().defaultNow(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** SHA-256 of the session token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    createdAt: createdAt(),
    expiresAt: timestamptz("expires_at").notNull(),
    lastSeenAt: timestamptz("last_seen_at").notNull().defaultNow(),
  },
  (t) => [
    index("sessions_user_id_idx").on(t.userId),
    // Lower-case hex SHA-256: a raw token written here by mistake is rejected.
    check("sessions_token_hash_check", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: id(),
    installationId: bigint("installation_id", { mode: "number" }).notNull().unique(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    accountLogin: text("account_login").notNull(),
    /** GitHub account type, e.g. `User` or `Organization`. */
    accountType: text("account_type").notNull(),
    suspendedAt: timestamptz("suspended_at"),
    createdAt: createdAt(),
  },
  (t) => [index("github_installations_owner_id_idx").on(t.ownerId)],
);

export const apps = pgTable(
  "apps",
  {
    id: id(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    // What happens to apps when an installation is removed is decided in 1.2 (webhook sync).
    installationRef: uuid("installation_ref")
      .notNull()
      .references(() => githubInstallations.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    subdomain: text("subdomain").notNull().unique(),
    /** Matching uses the stable repo id; `repo_full_name` is for display only. */
    repoId: bigint("repo_id", { mode: "number" }).notNull(),
    repoFullName: text("repo_full_name").notNull(),
    branch: text("branch").notNull(),
    port: integer("port").notNull(),
    healthPath: text("health_path").notNull().default("/"),
    status: text("status").$type<AppStatus>().notNull().default("active"),
    createdAt: createdAt(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("apps_repo_id_branch_idx").on(t.repoId, t.branch),
    index("apps_owner_id_idx").on(t.ownerId),
    check("apps_status_check", inList(t.status, APP_STATUSES)),
    check("apps_port_check", sql`${t.port} between 1 and 65535`),
  ],
);

export const envVars = pgTable(
  "env_vars",
  {
    id: id(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    /** AES-256-GCM, `v1:` prefixed, AAD = `app_id:key` (ROADMAP section 7). */
    valueEnc: text("value_enc").notNull(),
    updatedAt: timestamptz("updated_at")
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("env_vars_app_id_key_unique").on(t.appId, t.key),
    // A plaintext value written by mistake is rejected. A new key version adds its prefix here.
    check("env_vars_value_enc_check", sql`${t.valueEnc} like 'v1:%'`),
  ],
);

export const builds = pgTable(
  "builds",
  {
    id: id(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    trigger: text("trigger").$type<BuildTrigger>().notNull(),
    commitSha: text("commit_sha").notNull(),
    commitMessage: text("commit_message"),
    commitAuthor: text("commit_author"),
    /** `X-GitHub-Delivery` of the push that queued this build; null for manual builds. */
    deliveryId: text("delivery_id"),
    status: text("status").$type<BuildStatus>().notNull().default("queued"),
    failedStage: text("failed_stage").$type<BuildStage>(),
    errorMessage: text("error_message"),
    /** Digest reference (`…@sha256:…`), set after a successful push. */
    imageRef: text("image_ref"),
    queuedAt: timestamptz("queued_at").notNull().defaultNow(),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
    heartbeatAt: timestamptz("heartbeat_at"),
  },
  (t) => [
    // Target of the composite foreign key from deployments (build must belong to the same app).
    unique("builds_id_app_id_unique").on(t.id, t.appId),
    index("builds_app_id_queued_at_idx").on(t.appId, t.queuedAt.desc()),
    // Small index over in-progress builds only: superseding queued builds of an app,
    // the reaper and the reconciler read just these rows.
    index("builds_active_idx").on(t.appId, t.status).where(inList(t.status, ACTIVE_BUILD_STATUSES)),
    check("builds_status_check", inList(t.status, BUILD_STATUSES)),
    check("builds_trigger_check", inList(t.trigger, BUILD_TRIGGERS)),
    // Deploys use digests, never tags: a tag can move, a digest cannot (ROADMAP section 7).
    check("builds_image_ref_check", sql`${t.imageRef} is null or ${t.imageRef} like '%@sha256:%'`),
    check(
      "builds_failed_stage_check",
      sql`${t.failedStage} is null or (${t.status} = 'failed' and ${inList(t.failedStage, BUILD_STAGES)})`,
    ),
  ],
);

export const buildLogs = pgTable(
  "build_logs",
  {
    buildId: uuid("build_id")
      .notNull()
      .references(() => builds.id, { onDelete: "cascade" }),
    /** Per-build line number; gives the stable order used by SSE resume (ROADMAP section 11). */
    seq: integer("seq").notNull(),
    stream: text("stream").$type<LogStream>().notNull(),
    line: text("line").notNull(),
    ts: timestamptz("ts").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ name: "build_logs_pkey", columns: [t.buildId, t.seq] }),
    check("build_logs_stream_check", inList(t.stream, LOG_STREAMS)),
  ],
);

export const deployments = pgTable(
  "deployments",
  {
    id: id(),
    appId: uuid("app_id")
      .notNull()
      .references(() => apps.id, { onDelete: "cascade" }),
    buildId: uuid("build_id").notNull(),
    kind: text("kind").$type<DeploymentKind>().notNull(),
    status: text("status").$type<DeploymentStatus>().notNull().default("pending"),
    imageRef: text("image_ref").notNull(),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    finishedAt: timestamptz("finished_at"),
  },
  (t) => [
    // A deployment may only use a build of its own app, so a rollback bug cannot deploy
    // another app's image. NO ACTION (not cascade): a build that is still deployed cannot be
    // deleted on its own. NO ACTION is checked at the end of the statement, so deleting the
    // app still works: its builds and deployments both go in the same cascade.
    foreignKey({
      name: "deployments_build_same_app_fk",
      columns: [t.buildId, t.appId],
      foreignColumns: [builds.id, builds.appId],
    }).onDelete("no action"),
    // The database guarantees at most one active deployment per app (ROADMAP section 7).
    uniqueIndex("deployments_one_active_per_app")
      .on(t.appId)
      .where(sql`${t.status} = 'active'`),
    index("deployments_app_id_created_at_idx").on(t.appId, t.createdAt.desc()),
    check("deployments_status_check", inList(t.status, DEPLOYMENT_STATUSES)),
    check("deployments_kind_check", inList(t.kind, DEPLOYMENT_KINDS)),
    check("deployments_image_ref_check", sql`${t.imageRef} like '%@sha256:%'`),
  ],
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    /** `X-GitHub-Delivery`; the primary key makes a repeated delivery a unique violation. */
    deliveryId: text("delivery_id").primaryKey(),
    event: text("event").notNull(),
    receivedAt: timestamptz("received_at").notNull().defaultNow(),
  },
  // Rows older than 7 days are deleted (Phase 1); this index keeps that cheap.
  (t) => [index("webhook_deliveries_received_at_idx").on(t.receivedAt)],
);
