CREATE EXTENSION IF NOT EXISTS "pgcrypto";
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" varchar(100) NOT NULL,
	"external_id" varchar(255) NOT NULL,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"company" varchar(255) NOT NULL,
	"company_logo_url" text,
	"location" varchar(255),
	"is_remote" boolean DEFAULT false,
	"description" text NOT NULL,
	"tags" text[],
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" varchar(10),
	"posted_at" timestamp,
	"apply_url" text,
	"fingerprint" varchar(64) NOT NULL,
	"raw" jsonb,
	"status" varchar(20) DEFAULT 'active' NOT NULL,
	"content_hash" varchar(64),
	"last_checked_at" timestamp,
	"next_check_at" timestamp,
	"first_seen_at" timestamp DEFAULT now() NOT NULL,
	"last_seen_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('english', coalesce("jobs"."title", '')), 'A') || setweight(to_tsvector('english', coalesce("jobs"."company", '')), 'B') || setweight(to_tsvector('english', coalesce("jobs"."description", '')), 'C')) STORED
);
--> statement-breakpoint
CREATE TABLE "source_cursors" (
	"source" varchar(100) NOT NULL,
	"segment_key" varchar(255) NOT NULL,
	"last_polled_at" timestamp,
	"cursor" jsonb,
	"stats" jsonb
);
--> statement-breakpoint
CREATE TABLE "source_health" (
	"source_id" varchar(100) NOT NULL,
	"stage" varchar(50) NOT NULL,
	"status" varchar(20) DEFAULT 'healthy' NOT NULL,
	"last_run_at" timestamp,
	"last_success_at" timestamp,
	"last_error_at" timestamp,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_duration_ms" integer,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "uq_jobs_source_external" ON "jobs" USING btree ("source_id","external_id");--> statement-breakpoint
CREATE INDEX "idx_jobs_fingerprint" ON "jobs" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "idx_jobs_search" ON "jobs" USING gin ("search");--> statement-breakpoint
CREATE INDEX "idx_jobs_posted_at" ON "jobs" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_status" ON "jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_jobs_next_check_at" ON "jobs" USING btree ("next_check_at");--> statement-breakpoint
CREATE INDEX "idx_jobs_source_status_next_check" ON "jobs" USING btree ("source_id","status","next_check_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_source_cursors_pk" ON "source_cursors" USING btree ("source","segment_key");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_source_health_pk" ON "source_health" USING btree ("source_id","stage");--> statement-breakpoint
CREATE INDEX "idx_source_health_status" ON "source_health" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_source_health_updated_at" ON "source_health" USING btree ("updated_at");
