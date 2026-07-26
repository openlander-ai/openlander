ALTER TABLE "delivery_deploy_links" DROP CONSTRAINT "delivery_deploy_links_deploy_id_deploy_logs_id_fk";
--> statement-breakpoint
ALTER TABLE "delivery_deploy_links" ADD CONSTRAINT "delivery_deploy_links_deploy_id_deploy_logs_id_fk" FOREIGN KEY ("deploy_id") REFERENCES "public"."deploy_logs"("id") ON DELETE cascade ON UPDATE no action;