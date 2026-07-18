CREATE TABLE "git_credentials" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "provider" text DEFAULT 'github' NOT NULL,
  "auth_type" text DEFAULT 'deploy_key' NOT NULL,
  "repository_url" text NOT NULL,
  "repository_key" text NOT NULL,
  "public_key" text NOT NULL,
  "fingerprint" text NOT NULL,
  "encrypted_private_key" text NOT NULL,
  "private_key_iv" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "default_branch" text,
  "last_error_code" text,
  "verified_at" text,
  "last_used_at" text,
  "created_at" text DEFAULT now()::text NOT NULL,
  "updated_at" text DEFAULT now()::text NOT NULL,
  CONSTRAINT "git_credentials_fingerprint_unique" UNIQUE("fingerprint"),
  CONSTRAINT "git_credentials_provider_check" CHECK ("git_credentials"."provider" = 'github'),
  CONSTRAINT "git_credentials_auth_type_check" CHECK ("git_credentials"."auth_type" = 'deploy_key'),
  CONSTRAINT "git_credentials_status_check" CHECK ("git_credentials"."status" IN ('pending', 'verified', 'failed'))
);
--> statement-breakpoint
CREATE INDEX "idx_git_credentials_repository_key" ON "git_credentials" USING btree ("repository_key");
--> statement-breakpoint
CREATE INDEX "idx_git_credentials_status" ON "git_credentials" USING btree ("status");
--> statement-breakpoint
ALTER TABLE "services" ADD COLUMN "git_credential_id" text;
--> statement-breakpoint
ALTER TABLE "services"
  ADD CONSTRAINT "services_git_credential_id_git_credentials_id_fk"
  FOREIGN KEY ("git_credential_id") REFERENCES "public"."git_credentials"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "idx_services_git_credential" ON "services" USING btree ("git_credential_id");
