CREATE TABLE "engagement_projects" (
	"project_id" text PRIMARY KEY NOT NULL,
	"engagement_id" text NOT NULL,
	"linked_by" text DEFAULT 'admin' NOT NULL,
	"linked_at" text DEFAULT now()::text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "engagements" (
	"id" text PRIMARY KEY NOT NULL,
	"customer_name" text NOT NULL,
	"title" text NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text DEFAULT 'admin' NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "engagements_status_check" CHECK ("engagements"."status" IN ('active', 'on_hold', 'completed', 'archived')),
	CONSTRAINT "engagements_customer_name_check" CHECK (length(trim("engagements"."customer_name")) > 0),
	CONSTRAINT "engagements_title_check" CHECK (length(trim("engagements"."title")) > 0)
);
--> statement-breakpoint
ALTER TABLE "engagement_projects" ADD CONSTRAINT "engagement_projects_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "engagement_projects" ADD CONSTRAINT "engagement_projects_engagement_id_engagements_id_fk" FOREIGN KEY ("engagement_id") REFERENCES "public"."engagements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_engagement_projects_engagement" ON "engagement_projects" USING btree ("engagement_id","linked_at");--> statement-breakpoint
CREATE INDEX "idx_engagements_status_updated" ON "engagements" USING btree ("status","updated_at");