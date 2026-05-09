ALTER TABLE "auth"
  ADD COLUMN IF NOT EXISTS "active_scope_project_id" text REFERENCES "projects"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "auth"
  ADD COLUMN IF NOT EXISTS "destructive_mcp_unlock" boolean NOT NULL DEFAULT false;
