CREATE TABLE "delivery_review_package_items" (
	"id" text PRIMARY KEY NOT NULL,
	"package_id" text NOT NULL,
	"role" text NOT NULL,
	"filename" text NOT NULL,
	"expected_sha256" text NOT NULL,
	"expected_size_bytes" bigint NOT NULL,
	"expected_mime_type" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"blob_id" text,
	"artifact_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"actual_sha256" text,
	"actual_size_bytes" bigint,
	"actual_mime_type" text,
	"last_error_code" text,
	"last_error_details" jsonb,
	"uploaded_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "delivery_review_package_items_role_check" CHECK ("delivery_review_package_items"."role" IN ('review_document', 'interactive_preview', 'representative_image')),
	CONSTRAINT "delivery_review_package_items_status_check" CHECK ("delivery_review_package_items"."status" IN ('pending', 'uploaded', 'failed')),
	CONSTRAINT "delivery_review_package_items_expected_sha256_check" CHECK (length("delivery_review_package_items"."expected_sha256") = 64),
	CONSTRAINT "delivery_review_package_items_expected_size_check" CHECK ("delivery_review_package_items"."expected_size_bytes" > 0),
	CONSTRAINT "delivery_review_package_items_attempt_count_check" CHECK ("delivery_review_package_items"."attempt_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "delivery_review_packages" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"manifest_sha256" text NOT NULL,
	"base_evidence_version" integer NOT NULL,
	"source_run_id" text,
	"review_gate_key" text DEFAULT 'review' NOT NULL,
	"review_note" text NOT NULL,
	"overview_mode" text NOT NULL,
	"overview_patch" jsonb,
	"overview_keep_reason" text,
	"overview_before_sha256" text NOT NULL,
	"overview_after_sha256" text NOT NULL,
	"expires_at" text NOT NULL,
	"published_at" text,
	"created_by" text DEFAULT 'external-agent' NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "delivery_review_packages_status_check" CHECK ("delivery_review_packages"."status" IN ('draft', 'published', 'superseded', 'aborted', 'expired')),
	CONSTRAINT "delivery_review_packages_revision_check" CHECK ("delivery_review_packages"."revision" > 0),
	CONSTRAINT "delivery_review_packages_manifest_sha256_check" CHECK (length("delivery_review_packages"."manifest_sha256") = 64),
	CONSTRAINT "delivery_review_packages_base_evidence_version_check" CHECK ("delivery_review_packages"."base_evidence_version" >= 0),
	CONSTRAINT "delivery_review_packages_overview_mode_check" CHECK ("delivery_review_packages"."overview_mode" IN ('update', 'keep'))
);
--> statement-breakpoint
ALTER TABLE "delivery_approvals" ADD COLUMN "review_package_id" text;--> statement-breakpoint
ALTER TABLE "delivery_approvals" ADD COLUMN "package_manifest_sha256" text;--> statement-breakpoint
ALTER TABLE "delivery_gates" ADD COLUMN "review_package_id" text;--> statement-breakpoint
ALTER TABLE "delivery_review_package_items" ADD CONSTRAINT "delivery_review_package_items_package_id_delivery_review_packages_id_fk" FOREIGN KEY ("package_id") REFERENCES "public"."delivery_review_packages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_review_package_items" ADD CONSTRAINT "delivery_review_package_items_blob_id_artifact_blobs_id_fk" FOREIGN KEY ("blob_id") REFERENCES "public"."artifact_blobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_review_package_items" ADD CONSTRAINT "delivery_review_package_items_artifact_id_delivery_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."delivery_artifacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_review_packages" ADD CONSTRAINT "delivery_review_packages_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_review_packages" ADD CONSTRAINT "delivery_review_packages_source_run_id_delivery_agent_runs_id_fk" FOREIGN KEY ("source_run_id") REFERENCES "public"."delivery_agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_review_package_items_role_unique" ON "delivery_review_package_items" USING btree ("package_id","role");--> statement-breakpoint
CREATE INDEX "idx_delivery_review_package_items_package" ON "delivery_review_package_items" USING btree ("package_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_review_packages_delivery_revision_unique" ON "delivery_review_packages" USING btree ("delivery_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_review_packages_active_draft_unique" ON "delivery_review_packages" USING btree ("delivery_id") WHERE "delivery_review_packages"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_review_packages_current_published_unique" ON "delivery_review_packages" USING btree ("delivery_id") WHERE "delivery_review_packages"."status" = 'published';--> statement-breakpoint
CREATE INDEX "idx_delivery_review_packages_delivery" ON "delivery_review_packages" USING btree ("delivery_id","created_at");--> statement-breakpoint
ALTER TABLE "delivery_approvals" ADD CONSTRAINT "delivery_approvals_review_package_id_delivery_review_packages_id_fk" FOREIGN KEY ("review_package_id") REFERENCES "public"."delivery_review_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_gates" ADD CONSTRAINT "delivery_gates_review_package_id_delivery_review_packages_id_fk" FOREIGN KEY ("review_package_id") REFERENCES "public"."delivery_review_packages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_approvals" ADD CONSTRAINT "delivery_approvals_package_manifest_sha256_check" CHECK ("delivery_approvals"."package_manifest_sha256" IS NULL OR length("delivery_approvals"."package_manifest_sha256") = 64);