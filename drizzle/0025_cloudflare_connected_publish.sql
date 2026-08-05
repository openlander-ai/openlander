CREATE TABLE "cloudflare_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"account_name" text,
	"zone_id" text NOT NULL,
	"zone_name" text NOT NULL,
	"tunnel_id" text NOT NULL,
	"tunnel_name" text NOT NULL,
	"encrypted_tunnel_token" text NOT NULL,
	"tunnel_token_iv" text NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"connector_container_id" text,
	"last_error_code" text,
	"last_error_message" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "cloudflare_connections_tunnel_id_unique" UNIQUE("tunnel_id"),
	CONSTRAINT "cloudflare_connections_status_check" CHECK ("cloudflare_connections"."status" IN ('connected', 'error'))
);
--> statement-breakpoint
CREATE TABLE "project_public_access" (
	"project_id" text PRIMARY KEY NOT NULL,
	"service_id" text,
	"connection_id" text,
	"hostname" text NOT NULL,
	"cloudflare_zone_id" text NOT NULL,
	"cloudflare_dns_record_id" text,
	"domain_mapping_id" text,
	"status" text DEFAULT 'private' NOT NULL,
	"last_error_code" text,
	"last_error_message" text,
	"published_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "project_public_access_hostname_unique" UNIQUE("hostname"),
	CONSTRAINT "project_public_access_status_check" CHECK ("project_public_access"."status" IN ('private', 'provisioning', 'public', 'unpublishing', 'error'))
);
--> statement-breakpoint
ALTER TABLE "project_public_access" ADD CONSTRAINT "project_public_access_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_public_access" ADD CONSTRAINT "project_public_access_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_public_access" ADD CONSTRAINT "project_public_access_connection_id_cloudflare_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."cloudflare_connections"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_public_access" ADD CONSTRAINT "project_public_access_domain_mapping_id_domain_mappings_id_fk" FOREIGN KEY ("domain_mapping_id") REFERENCES "public"."domain_mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_cloudflare_connections_zone" ON "cloudflare_connections" USING btree ("zone_id");--> statement-breakpoint
CREATE INDEX "idx_project_public_access_service" ON "project_public_access" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "idx_project_public_access_status" ON "project_public_access" USING btree ("status");
