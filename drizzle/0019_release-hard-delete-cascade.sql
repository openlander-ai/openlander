ALTER TABLE "release_artifacts" DROP CONSTRAINT "release_artifacts_service_id_services_id_fk";
--> statement-breakpoint
ALTER TABLE "release_promotions" DROP CONSTRAINT "release_promotions_release_id_releases_id_fk";
--> statement-breakpoint
ALTER TABLE "release_promotions" DROP CONSTRAINT "release_promotions_project_environment_id_project_environments_id_fk";
--> statement-breakpoint
ALTER TABLE "releases" DROP CONSTRAINT "releases_delivery_id_deliveries_id_fk";
--> statement-breakpoint
ALTER TABLE "releases" DROP CONSTRAINT "releases_agent_run_id_delivery_agent_runs_id_fk";
--> statement-breakpoint
ALTER TABLE "release_artifacts" ADD CONSTRAINT "release_artifacts_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_promotions" ADD CONSTRAINT "release_promotions_release_id_releases_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."releases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_promotions" ADD CONSTRAINT "release_promotions_project_environment_id_project_environments_id_fk" FOREIGN KEY ("project_environment_id") REFERENCES "public"."project_environments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "releases" ADD CONSTRAINT "releases_agent_run_id_delivery_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."delivery_agent_runs"("id") ON DELETE cascade ON UPDATE no action;