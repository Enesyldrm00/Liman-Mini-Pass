CREATE TABLE "apps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"installation_ref" uuid NOT NULL,
	"name" text NOT NULL,
	"subdomain" text NOT NULL,
	"repo_id" bigint NOT NULL,
	"repo_full_name" text NOT NULL,
	"branch" text NOT NULL,
	"port" integer NOT NULL,
	"health_path" text DEFAULT '/' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "apps_subdomain_unique" UNIQUE("subdomain"),
	CONSTRAINT "apps_status_check" CHECK ("apps"."status" in ('active', 'deleting')),
	CONSTRAINT "apps_port_check" CHECK ("apps"."port" between 1 and 65535)
);
--> statement-breakpoint
CREATE TABLE "build_logs" (
	"build_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"stream" text NOT NULL,
	"line" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "build_logs_pkey" PRIMARY KEY("build_id","seq"),
	CONSTRAINT "build_logs_stream_check" CHECK ("build_logs"."stream" in ('stdout', 'stderr', 'system'))
);
--> statement-breakpoint
CREATE TABLE "builds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"commit_sha" text NOT NULL,
	"commit_message" text,
	"commit_author" text,
	"delivery_id" text,
	"status" text DEFAULT 'queued' NOT NULL,
	"failed_stage" text,
	"error_message" text,
	"image_ref" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"heartbeat_at" timestamp with time zone,
	CONSTRAINT "builds_status_check" CHECK ("builds"."status" in ('queued', 'cloning', 'building', 'pushing', 'deploying', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "builds_trigger_check" CHECK ("builds"."trigger" in ('push', 'manual')),
	CONSTRAINT "builds_failed_stage_check" CHECK ("builds"."failed_stage" is null or ("builds"."status" = 'failed' and "builds"."failed_stage" in ('cloning', 'building', 'pushing', 'deploying')))
);
--> statement-breakpoint
CREATE TABLE "deployments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"build_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"image_ref" text NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "deployments_status_check" CHECK ("deployments"."status" in ('pending', 'active', 'superseded', 'failed')),
	CONSTRAINT "deployments_kind_check" CHECK ("deployments"."kind" in ('build', 'rollback', 'redeploy'))
);
--> statement-breakpoint
CREATE TABLE "env_vars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"app_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_enc" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"installation_id" bigint NOT NULL,
	"owner_id" uuid NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_installations_installation_id_unique" UNIQUE("installation_id")
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"github_id" bigint NOT NULL,
	"login" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_github_id_unique" UNIQUE("github_id")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"event" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "apps" ADD CONSTRAINT "apps_installation_ref_github_installations_id_fk" FOREIGN KEY ("installation_ref") REFERENCES "public"."github_installations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "build_logs" ADD CONSTRAINT "build_logs_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "builds" ADD CONSTRAINT "builds_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deployments" ADD CONSTRAINT "deployments_build_id_builds_id_fk" FOREIGN KEY ("build_id") REFERENCES "public"."builds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "env_vars" ADD CONSTRAINT "env_vars_app_id_apps_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."apps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "apps_repo_id_branch_idx" ON "apps" USING btree ("repo_id","branch");--> statement-breakpoint
CREATE INDEX "apps_owner_id_idx" ON "apps" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "builds_app_id_queued_at_idx" ON "builds" USING btree ("app_id","queued_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "builds_active_idx" ON "builds" USING btree ("app_id","status") WHERE "builds"."status" in ('queued', 'cloning', 'building', 'pushing', 'deploying');--> statement-breakpoint
CREATE UNIQUE INDEX "deployments_one_active_per_app" ON "deployments" USING btree ("app_id") WHERE "deployments"."status" = 'active';--> statement-breakpoint
CREATE INDEX "deployments_app_id_created_at_idx" ON "deployments" USING btree ("app_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "env_vars_app_id_key_unique" ON "env_vars" USING btree ("app_id","key");--> statement-breakpoint
CREATE INDEX "github_installations_owner_id_idx" ON "github_installations" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "sessions_user_id_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_received_at_idx" ON "webhook_deliveries" USING btree ("received_at");