CREATE TABLE "delivery_idempotency_records" (
	"id" text PRIMARY KEY NOT NULL,
	"delivery_id" text NOT NULL,
	"operation" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_sha256" text NOT NULL,
	"response_json" jsonb NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "delivery_idempotency_records_request_sha256_check" CHECK (length("delivery_idempotency_records"."request_sha256") = 64)
);
--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "evidence_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "deliveries" ADD COLUMN "previewed_evidence_version" integer;--> statement-breakpoint
ALTER TABLE "delivery_idempotency_records" ADD CONSTRAINT "delivery_idempotency_records_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_idempotency_records_key_unique" ON "delivery_idempotency_records" USING btree ("delivery_id","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_delivery_idempotency_records_delivery" ON "delivery_idempotency_records" USING btree ("delivery_id","created_at");--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_evidence_version_check" CHECK ("deliveries"."evidence_version" >= 0);--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_previewed_evidence_version_check" CHECK ("deliveries"."previewed_evidence_version" IS NULL OR "deliveries"."previewed_evidence_version" >= 0);