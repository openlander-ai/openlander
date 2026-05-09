ALTER TABLE "projects" ADD COLUMN "display_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "tags" text;--> statement-breakpoint
UPDATE "projects" SET "display_name" = "name" WHERE "display_name" = '';
