ALTER TABLE "pat_tokens" ADD COLUMN "scope_service_id" text;
--> statement-breakpoint
ALTER TABLE "pat_tokens" ADD CONSTRAINT "pat_tokens_scope_service_id_services_id_fk" FOREIGN KEY ("scope_service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "pat_tokens" DROP CONSTRAINT IF EXISTS "pat_tokens_scope_kind_check";
--> statement-breakpoint
ALTER TABLE "pat_tokens" ADD CONSTRAINT "pat_tokens_scope_kind_check" CHECK ("pat_tokens"."scope_kind" IN ('org', 'project', 'service'));
--> statement-breakpoint
ALTER TABLE "pat_tokens" DROP CONSTRAINT IF EXISTS "pat_tokens_scope_project_check";
--> statement-breakpoint
ALTER TABLE "pat_tokens" ADD CONSTRAINT "pat_tokens_scope_project_check" CHECK (("pat_tokens"."scope_kind" = 'org' AND "pat_tokens"."scope_project_id" IS NULL AND "pat_tokens"."scope_service_id" IS NULL) OR ("pat_tokens"."scope_kind" = 'project' AND "pat_tokens"."scope_project_id" IS NOT NULL AND "pat_tokens"."scope_service_id" IS NULL) OR ("pat_tokens"."scope_kind" = 'service' AND "pat_tokens"."scope_project_id" IS NULL AND "pat_tokens"."scope_service_id" IS NOT NULL));
--> statement-breakpoint
CREATE INDEX "idx_pat_tokens_scope_service" ON "pat_tokens" USING btree ("scope_kind","scope_service_id");
