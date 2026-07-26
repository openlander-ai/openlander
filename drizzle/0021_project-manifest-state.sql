CREATE TABLE "project_manifest_states" (
	"project_id" text PRIMARY KEY NOT NULL,
	"manifest_path" text NOT NULL,
	"manifest_sha256" text NOT NULL,
	"definition_json" jsonb NOT NULL,
	"applied_by" text NOT NULL,
	"applied_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "project_manifest_states_manifest_sha256_check" CHECK (length("project_manifest_states"."manifest_sha256") = 64)
);
--> statement-breakpoint
ALTER TABLE "project_manifest_states" ADD CONSTRAINT "project_manifest_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;