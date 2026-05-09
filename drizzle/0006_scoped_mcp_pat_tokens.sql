CREATE TABLE IF NOT EXISTS "pat_tokens" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "token_hash" text NOT NULL UNIQUE,
  "token_suffix" text NOT NULL,
  "scope_kind" text NOT NULL,
  "scope_project_id" text REFERENCES "projects"("id") ON DELETE CASCADE,
  "token_type" text NOT NULL DEFAULT 'pat',
  "capabilities" jsonb,
  "last_used_at" text,
  "expires_at" text,
  "revoked_at" text,
  "created_at" text NOT NULL DEFAULT now()::text,
  "server_id" text NOT NULL DEFAULT 'local',
  CONSTRAINT "pat_tokens_scope_kind_check" CHECK ("scope_kind" IN ('org', 'project')),
  CONSTRAINT "pat_tokens_type_check" CHECK ("token_type" IN ('pat', 'service', 'legacy-default')),
  CONSTRAINT "pat_tokens_scope_project_check" CHECK (
    ("scope_kind" = 'org' AND "scope_project_id" IS NULL)
    OR ("scope_kind" = 'project' AND "scope_project_id" IS NOT NULL)
  ),
  CONSTRAINT "pat_tokens_expiry_check" CHECK ("token_type" = 'legacy-default' OR "expires_at" IS NOT NULL)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pat_tokens_hash" ON "pat_tokens" ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pat_tokens_scope" ON "pat_tokens" ("scope_kind", "scope_project_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_pat_tokens_expires" ON "pat_tokens" ("expires_at");
