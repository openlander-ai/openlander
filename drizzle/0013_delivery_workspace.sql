CREATE TABLE "artifact_blobs" (
  "id" text PRIMARY KEY NOT NULL,
  "sha256" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" bigint NOT NULL,
  "storage_key" text NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "artifact_blobs_sha256_unique" UNIQUE("sha256"),
  CONSTRAINT "artifact_blobs_storage_key_unique" UNIQUE("storage_key"),
  CONSTRAINT "artifact_blobs_size_check" CHECK ("artifact_blobs"."size_bytes" >= 0),
  CONSTRAINT "artifact_blobs_sha256_check" CHECK (length("artifact_blobs"."sha256") = 64)
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
  "id" text PRIMARY KEY NOT NULL,
  "project_id" text NOT NULL,
  "title" text NOT NULL,
  "summary" text DEFAULT '' NOT NULL,
  "delivery_type" text DEFAULT 'software_release' NOT NULL,
  "maturity" text DEFAULT 'customer_review' NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "limitations" text,
  "predecessor_delivery_id" text,
  "created_by" text DEFAULT 'admin' NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "deliveries_type_check" CHECK ("deliveries"."delivery_type" IN ('software_release', 'artifact_delivery')),
  CONSTRAINT "deliveries_maturity_check" CHECK ("deliveries"."maturity" IN ('concept', 'functional_preview', 'customer_review', 'release_candidate', 'production')),
  CONSTRAINT "deliveries_status_check" CHECK ("deliveries"."status" IN ('draft', 'in_review', 'revision_requested', 'approved', 'ready', 'delivered', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "delivery_feedback_sources" (
  "id" text PRIMARY KEY NOT NULL,
  "delivery_id" text NOT NULL,
  "source_type" text NOT NULL,
  "source_url" text,
  "author_display_name" text,
  "raw_text" text NOT NULL,
  "occurred_at" text,
  "created_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "delivery_feedback_sources_type_check" CHECK ("delivery_feedback_sources"."source_type" IN ('slack', 'teams', 'email', 'meeting', 'other'))
);
--> statement-breakpoint
CREATE TABLE "delivery_artifacts" (
  "id" text PRIMARY KEY NOT NULL,
  "delivery_id" text NOT NULL,
  "blob_id" text NOT NULL,
  "logical_key" text NOT NULL,
  "revision" integer NOT NULL,
  "kind" text NOT NULL,
  "original_filename" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "companion_pdf_artifact_id" text,
  "include_in_receipt" boolean DEFAULT true NOT NULL,
  "receipt_order" integer DEFAULT 0 NOT NULL,
  "idempotency_key" text,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "delivery_artifacts_kind_check" CHECK ("delivery_artifacts"."kind" IN ('review_html', 'companion_pdf', 'markdown', 'qa_report', 'data_report', 'image', 'other')),
  CONSTRAINT "delivery_artifacts_status_check" CHECK ("delivery_artifacts"."status" IN ('draft', 'approved', 'superseded')),
  CONSTRAINT "delivery_artifacts_revision_check" CHECK ("delivery_artifacts"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "project_delivery_settings" (
  "project_id" text PRIMARY KEY NOT NULL,
  "organization_name" text,
  "document_name" text DEFAULT 'Delivery Receipt' NOT NULL,
  "primary_color" text DEFAULT '#2563EB' NOT NULL,
  "logo_blob_id" text,
  "footer_text" text,
  "locale" text DEFAULT 'ko' NOT NULL,
  "default_gates_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "project_delivery_settings_locale_check" CHECK ("project_delivery_settings"."locale" IN ('ko', 'en')),
  CONSTRAINT "project_delivery_settings_primary_color_check" CHECK ("project_delivery_settings"."primary_color" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "delivery_external_refs" (
  "id" text PRIMARY KEY NOT NULL,
  "delivery_id" text NOT NULL,
  "provider" text NOT NULL,
  "label" text NOT NULL,
  "url" text NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "delivery_external_refs_provider_check" CHECK ("delivery_external_refs"."provider" IN ('slack', 'teams', 'email', 'drive', 'github', 'other'))
);
--> statement-breakpoint
CREATE TABLE "delivery_work_items" (
  "id" text PRIMARY KEY NOT NULL,
  "delivery_id" text NOT NULL,
  "feedback_source_id" text,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "detail" text DEFAULT '' NOT NULL,
  "status" text DEFAULT 'proposed' NOT NULL,
  "is_ai_draft" boolean DEFAULT false NOT NULL,
  "resolution" text,
  "created_by" text DEFAULT 'admin' NOT NULL,
  "resolved_at" text,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "delivery_work_items_kind_check" CHECK ("delivery_work_items"."kind" IN ('decision', 'change_request', 'question', 'note')),
  CONSTRAINT "delivery_work_items_status_check" CHECK ("delivery_work_items"."status" IN ('proposed', 'confirmed', 'rejected', 'resolved', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "delivery_approvals" (
  "id" text PRIMARY KEY NOT NULL,
  "delivery_id" text NOT NULL,
  "artifact_ids" jsonb NOT NULL,
  "approver_display_name" text NOT NULL,
  "approval_excerpt" text NOT NULL,
  "source_type" text NOT NULL,
  "source_url" text,
  "approved_at" text NOT NULL,
  "invalidated_at" text,
  "invalidated_reason" text,
  "recorded_by" text DEFAULT 'admin' NOT NULL,
  "created_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "delivery_approvals_source_type_check" CHECK ("delivery_approvals"."source_type" IN ('slack', 'teams', 'email', 'meeting', 'other'))
);
--> statement-breakpoint
CREATE TABLE "delivery_gates" (
  "id" text PRIMARY KEY NOT NULL,
  "delivery_id" text NOT NULL,
  "gate_key" text NOT NULL,
  "gate_type" text NOT NULL,
  "label" text NOT NULL,
  "required" boolean DEFAULT false NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "summary" text,
  "waiver_reason" text,
  "warning_accepted" boolean DEFAULT false NOT NULL,
  "report_artifact_id" text,
  "idempotency_key" text,
  "recorded_by" text DEFAULT 'admin' NOT NULL,
  "recorded_at" text,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "delivery_gates_type_check" CHECK ("delivery_gates"."gate_type" IN ('review', 'qa', 'data', 'custom')),
  CONSTRAINT "delivery_gates_status_check" CHECK ("delivery_gates"."status" IN ('pending', 'passed', 'warning', 'failed', 'waived'))
);
--> statement-breakpoint
CREATE TABLE "delivery_deploy_links" (
  "id" text PRIMARY KEY NOT NULL,
  "delivery_id" text NOT NULL,
  "deploy_id" text NOT NULL,
  "relation" text NOT NULL,
  "linked_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "delivery_deploy_links_relation_check" CHECK ("delivery_deploy_links"."relation" IN ('candidate', 'released', 'rollback'))
);
--> statement-breakpoint
CREATE TABLE "delivery_receipts" (
  "id" text PRIMARY KEY NOT NULL,
  "delivery_id" text NOT NULL,
  "revision" integer DEFAULT 1 NOT NULL,
  "snapshot_json" jsonb NOT NULL,
  "pdf_blob_id" text NOT NULL,
  "pdf_sha256" text NOT NULL,
  "finalized_by" text NOT NULL,
  "finalized_at" text NOT NULL,
  CONSTRAINT "delivery_receipts_delivery_id_unique" UNIQUE("delivery_id"),
  CONSTRAINT "delivery_receipts_revision_check" CHECK ("delivery_receipts"."revision" > 0),
  CONSTRAINT "delivery_receipts_sha256_check" CHECK (length("delivery_receipts"."pdf_sha256") = 64)
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_predecessor_delivery_id_deliveries_id_fk" FOREIGN KEY ("predecessor_delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_feedback_sources" ADD CONSTRAINT "delivery_feedback_sources_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_artifacts" ADD CONSTRAINT "delivery_artifacts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_artifacts" ADD CONSTRAINT "delivery_artifacts_blob_id_artifact_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."artifact_blobs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_artifacts" ADD CONSTRAINT "delivery_artifacts_companion_pdf_artifact_id_delivery_artifacts_id_fk" FOREIGN KEY ("companion_pdf_artifact_id") REFERENCES "public"."delivery_artifacts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_delivery_settings" ADD CONSTRAINT "project_delivery_settings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "project_delivery_settings" ADD CONSTRAINT "project_delivery_settings_logo_blob_id_artifact_blobs_id_fk" FOREIGN KEY ("logo_blob_id") REFERENCES "public"."artifact_blobs"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_external_refs" ADD CONSTRAINT "delivery_external_refs_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_work_items" ADD CONSTRAINT "delivery_work_items_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_work_items" ADD CONSTRAINT "delivery_work_items_feedback_source_id_delivery_feedback_sources_id_fk" FOREIGN KEY ("feedback_source_id") REFERENCES "public"."delivery_feedback_sources"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_approvals" ADD CONSTRAINT "delivery_approvals_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_gates" ADD CONSTRAINT "delivery_gates_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_gates" ADD CONSTRAINT "delivery_gates_report_artifact_id_delivery_artifacts_id_fk" FOREIGN KEY ("report_artifact_id") REFERENCES "public"."delivery_artifacts"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_deploy_links" ADD CONSTRAINT "delivery_deploy_links_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_deploy_links" ADD CONSTRAINT "delivery_deploy_links_deploy_id_deploy_logs_id_fk" FOREIGN KEY ("deploy_id") REFERENCES "public"."deploy_logs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_pdf_blob_id_artifact_blobs_id_fk" FOREIGN KEY ("pdf_blob_id") REFERENCES "public"."artifact_blobs"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_deliveries_project" ON "deliveries" USING btree ("project_id","created_at");
--> statement-breakpoint
CREATE INDEX "idx_deliveries_status" ON "deliveries" USING btree ("project_id","status");
--> statement-breakpoint
CREATE INDEX "idx_delivery_feedback_sources_delivery" ON "delivery_feedback_sources" USING btree ("delivery_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_artifacts_logical_kind_revision_unique" ON "delivery_artifacts" USING btree ("delivery_id","logical_key","kind","revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_artifacts_idempotency_unique" ON "delivery_artifacts" USING btree ("delivery_id","idempotency_key") WHERE "delivery_artifacts"."idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_delivery_artifacts_delivery" ON "delivery_artifacts" USING btree ("delivery_id","receipt_order");
--> statement-breakpoint
CREATE INDEX "idx_delivery_external_refs_delivery" ON "delivery_external_refs" USING btree ("delivery_id");
--> statement-breakpoint
CREATE INDEX "idx_delivery_work_items_delivery" ON "delivery_work_items" USING btree ("delivery_id","status");
--> statement-breakpoint
CREATE INDEX "idx_delivery_work_items_feedback" ON "delivery_work_items" USING btree ("feedback_source_id");
--> statement-breakpoint
CREATE INDEX "idx_delivery_approvals_delivery" ON "delivery_approvals" USING btree ("delivery_id","approved_at");
--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_gates_key_unique" ON "delivery_gates" USING btree ("delivery_id","gate_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_gates_idempotency_unique" ON "delivery_gates" USING btree ("delivery_id","idempotency_key") WHERE "delivery_gates"."idempotency_key" IS NOT NULL;
--> statement-breakpoint
CREATE INDEX "idx_delivery_gates_delivery" ON "delivery_gates" USING btree ("delivery_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_deploy_links_unique" ON "delivery_deploy_links" USING btree ("delivery_id","deploy_id","relation");
--> statement-breakpoint
CREATE INDEX "idx_delivery_deploy_links_delivery" ON "delivery_deploy_links" USING btree ("delivery_id");
