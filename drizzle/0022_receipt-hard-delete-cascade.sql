ALTER TABLE "delivery_receipts" DROP CONSTRAINT "delivery_receipts_delivery_id_deliveries_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_receipts" ADD CONSTRAINT "delivery_receipts_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;