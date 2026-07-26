CREATE TABLE "application_operation_invocations" (
	"id" text PRIMARY KEY NOT NULL,
	"operation_name" text NOT NULL,
	"operation_version" integer NOT NULL,
	"actor_scope_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_sha256" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"response_json" jsonb,
	"error_json" jsonb,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "application_operation_invocations_status_check" CHECK ("application_operation_invocations"."status" IN ('running', 'succeeded', 'failed')),
	CONSTRAINT "application_operation_invocations_request_sha256_check" CHECK (length("application_operation_invocations"."request_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "delivery_agent_run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"event_type" text NOT NULL,
	"phase" text,
	"summary" text NOT NULL,
	"detail_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "delivery_agent_run_events_sequence_check" CHECK ("delivery_agent_run_events"."sequence" > 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"commit_sha" text NOT NULL,
	"manifest_path" text NOT NULL,
	"manifest_sha256" text NOT NULL,
	"runner_image" text NOT NULL,
	"runner_image_digest" text,
	"current_phase" text DEFAULT 'planning' NOT NULL,
	"handoff_summary" text,
	"started_by" text NOT NULL,
	"started_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	"completed_at" text,
	"cancellation_reason" text,
	CONSTRAINT "delivery_agent_runs_status_check" CHECK ("delivery_agent_runs"."status" IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "delivery_agent_runs_commit_sha_check" CHECK (length(trim("delivery_agent_runs"."commit_sha")) > 0),
	CONSTRAINT "delivery_agent_runs_manifest_sha256_check" CHECK (length("delivery_agent_runs"."manifest_sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "delivery_run_checks" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"gate_id" text,
	"check_key" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"command" text NOT NULL,
	"exit_code" integer,
	"duration_ms" integer,
	"log_sha256" text,
	"report_artifact_id" text,
	"runner_image_digest" text,
	"details_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" text,
	"finished_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "delivery_run_checks_attempt_check" CHECK ("delivery_run_checks"."attempt" > 0),
	CONSTRAINT "delivery_run_checks_status_check" CHECK ("delivery_run_checks"."status" IN ('pending', 'running', 'passed', 'failed', 'cancelled')),
	CONSTRAINT "delivery_run_checks_duration_check" CHECK ("delivery_run_checks"."duration_ms" IS NULL OR "delivery_run_checks"."duration_ms" >= 0),
	CONSTRAINT "delivery_run_checks_log_sha256_check" CHECK ("delivery_run_checks"."log_sha256" IS NULL OR length("delivery_run_checks"."log_sha256") = 64)
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "objective" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "definition_of_done" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "manifest_path" text;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "auto_finalize" boolean;--> statement-breakpoint
UPDATE "deliveries" SET "auto_finalize" = false;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "auto_finalize" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "deliveries" ALTER COLUMN "auto_finalize" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_gates" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "delivery_gates" ADD COLUMN "definition_sha256" text;--> statement-breakpoint
ALTER TABLE "delivery_agent_run_events" ADD CONSTRAINT "delivery_agent_run_events_run_id_delivery_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."delivery_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_agent_runs" ADD CONSTRAINT "delivery_agent_runs_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_run_checks" ADD CONSTRAINT "delivery_run_checks_run_id_delivery_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."delivery_agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_run_checks" ADD CONSTRAINT "delivery_run_checks_gate_id_delivery_gates_id_fk" FOREIGN KEY ("gate_id") REFERENCES "public"."delivery_gates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_run_checks" ADD CONSTRAINT "delivery_run_checks_report_artifact_id_delivery_artifacts_id_fk" FOREIGN KEY ("report_artifact_id") REFERENCES "public"."delivery_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "application_operation_invocations_key_unique" ON "application_operation_invocations" USING btree ("operation_name","operation_version","actor_scope_key","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_application_operation_invocations_created" ON "application_operation_invocations" USING btree ("operation_name","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_agent_run_events_sequence_unique" ON "delivery_agent_run_events" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "idx_delivery_agent_run_events_run" ON "delivery_agent_run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_agent_runs_active_unique" ON "delivery_agent_runs" USING btree ("delivery_id") WHERE "delivery_agent_runs"."status" IN ('running', 'paused');--> statement-breakpoint
CREATE INDEX "idx_delivery_agent_runs_delivery" ON "delivery_agent_runs" USING btree ("delivery_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_run_checks_attempt_unique" ON "delivery_run_checks" USING btree ("run_id","check_key","attempt");--> statement-breakpoint
CREATE INDEX "idx_delivery_run_checks_run" ON "delivery_run_checks" USING btree ("run_id","check_key","attempt");--> statement-breakpoint
CREATE INDEX "idx_delivery_run_checks_gate" ON "delivery_run_checks" USING btree ("gate_id");--> statement-breakpoint
ALTER TABLE "delivery_gates" ADD CONSTRAINT "delivery_gates_source_check" CHECK ("delivery_gates"."source" IN ('manual', 'manifest'));--> statement-breakpoint
ALTER TABLE "delivery_gates" ADD CONSTRAINT "delivery_gates_definition_sha256_check" CHECK ("delivery_gates"."definition_sha256" IS NULL OR length("delivery_gates"."definition_sha256") = 64);
