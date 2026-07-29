CREATE TABLE "project_updates" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"delivery_id" text,
	"summary" text NOT NULL,
	"occurred_at" text NOT NULL,
	"sources" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "project_updates_summary_check" CHECK (length(trim("project_updates"."summary")) > 0),
	CONSTRAINT "project_updates_sources_check" CHECK (
		CASE
			WHEN jsonb_typeof("project_updates"."sources") = 'array'
				THEN jsonb_array_length("project_updates"."sources") BETWEEN 1 AND 20
			ELSE false
		END
	)
);
--> statement-breakpoint
CREATE TABLE "project_update_items" (
	"id" text PRIMARY KEY NOT NULL,
	"project_update_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"status" text NOT NULL,
	"resolution_update_id" text,
	"resolution_note" text,
	"resolved_at" text,
	"created_at" text DEFAULT now()::text NOT NULL,
	"updated_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "project_update_items_kind_check" CHECK ("project_update_items"."kind" IN ('decision', 'action', 'risk', 'question', 'dependency', 'progress', 'fact')),
	CONSTRAINT "project_update_items_status_check" CHECK ("project_update_items"."status" IN ('open', 'accepted', 'noted', 'resolved', 'dismissed', 'superseded'))
);
--> statement-breakpoint
CREATE TABLE "delivery_project_update_items" (
	"delivery_id" text NOT NULL,
	"project_update_item_id" text NOT NULL,
	"item_status" text NOT NULL,
	"item_updated_at" text NOT NULL,
	"linked_by" text NOT NULL,
	"linked_at" text DEFAULT now()::text NOT NULL,
	CONSTRAINT "delivery_project_update_items_status_check" CHECK ("delivery_project_update_items"."item_status" IN ('open', 'accepted', 'noted', 'resolved', 'dismissed', 'superseded'))
);
--> statement-breakpoint
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_updates" ADD CONSTRAINT "project_updates_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_update_items" ADD CONSTRAINT "project_update_items_project_update_id_project_updates_id_fk" FOREIGN KEY ("project_update_id") REFERENCES "public"."project_updates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_update_items" ADD CONSTRAINT "project_update_items_resolution_update_id_project_updates_id_fk" FOREIGN KEY ("resolution_update_id") REFERENCES "public"."project_updates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_project_update_items" ADD CONSTRAINT "delivery_project_update_items_delivery_id_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."deliveries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_project_update_items" ADD CONSTRAINT "delivery_project_update_items_project_update_item_id_project_update_items_id_fk" FOREIGN KEY ("project_update_item_id") REFERENCES "public"."project_update_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_project_updates_project_occurred" ON "project_updates" USING btree ("project_id","occurred_at");--> statement-breakpoint
CREATE INDEX "idx_project_updates_delivery" ON "project_updates" USING btree ("delivery_id");--> statement-breakpoint
CREATE INDEX "idx_project_update_items_update" ON "project_update_items" USING btree ("project_update_id");--> statement-breakpoint
CREATE INDEX "idx_project_update_items_status_kind" ON "project_update_items" USING btree ("status","kind","updated_at");--> statement-breakpoint
CREATE INDEX "idx_project_update_items_resolution" ON "project_update_items" USING btree ("resolution_update_id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_project_update_items_unique" ON "delivery_project_update_items" USING btree ("delivery_id","project_update_item_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_project_update_items_item" ON "delivery_project_update_items" USING btree ("project_update_item_id");--> statement-breakpoint
CREATE INDEX "idx_delivery_project_update_items_delivery" ON "delivery_project_update_items" USING btree ("delivery_id");--> statement-breakpoint
INSERT INTO "project_updates" (
	"id",
	"project_id",
	"delivery_id",
	"summary",
	"occurred_at",
	"sources",
	"created_by",
	"created_at"
)
SELECT
	'pupd_legacy_' || activity."id",
	activity."project_id",
	delivery."id",
	COALESCE(NULLIF(trim(activity."description"), ''), NULLIF(trim(activity."title"), ''), 'Legacy project update'),
	activity."created_at",
	COALESCE(
		(
			SELECT jsonb_agg(
				jsonb_build_object(
					'source_type', 'other',
					'label', 'Legacy Delivery artifact',
					'artifact_id', source_artifact."value"
				)
				ORDER BY source_artifact."ordinality"
			)
			FROM jsonb_array_elements_text(
				CASE
					WHEN jsonb_typeof(metadata."value"->'source_artifact_ids') = 'array'
						THEN metadata."value"->'source_artifact_ids'
					ELSE '[]'::jsonb
				END
			) WITH ORDINALITY AS source_artifact("value", "ordinality")
			WHERE source_artifact."ordinality" <= 20
		),
		jsonb_build_array(
			jsonb_build_object(
				'source_type', 'other',
				'label', 'Legacy project update activity'
			)
		)
	),
	COALESCE(NULLIF(metadata."value"->>'actor', ''), 'legacy-activity'),
	activity."created_at"
FROM "activity_log" AS activity
INNER JOIN "projects" AS project
	ON project."id" = activity."project_id"
CROSS JOIN LATERAL (
	SELECT CASE
		WHEN pg_input_is_valid(activity."metadata", 'jsonb') THEN activity."metadata"::jsonb
		ELSE '{}'::jsonb
	END AS "value"
) AS metadata
LEFT JOIN "deliveries" AS delivery
	ON delivery."id" = metadata."value"->>'delivery_id'
	AND delivery."project_id" = activity."project_id"
WHERE activity."event_type" = 'project.update_recorded'
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "project_update_items" (
	"id",
	"project_update_id",
	"kind",
	"title",
	"detail",
	"status",
	"resolved_at",
	"created_at",
	"updated_at"
)
SELECT
	'pui_legacy_' || activity."id" || '_' || entry."ordinality"::text,
	'pupd_legacy_' || activity."id",
	CASE
		WHEN entry."value"->>'kind' IN ('decision', 'action', 'risk', 'question', 'dependency', 'progress', 'fact')
			THEN entry."value"->>'kind'
		ELSE 'fact'
	END,
	entry."value"->>'title',
	COALESCE(entry."value"->>'detail', ''),
	CASE
		WHEN entry."value"->>'status' IN ('open', 'accepted', 'noted', 'resolved', 'dismissed', 'superseded')
			THEN entry."value"->>'status'
		ELSE 'noted'
	END,
	CASE
		WHEN entry."value"->>'status' IN ('resolved', 'dismissed', 'superseded')
			THEN activity."created_at"
		ELSE NULL
	END,
	activity."created_at",
	activity."created_at"
FROM "activity_log" AS activity
INNER JOIN "projects" AS project
	ON project."id" = activity."project_id"
CROSS JOIN LATERAL (
	SELECT CASE
		WHEN pg_input_is_valid(activity."metadata", 'jsonb') THEN activity."metadata"::jsonb
		ELSE '{}'::jsonb
	END AS "value"
) AS metadata
CROSS JOIN LATERAL jsonb_array_elements(
	CASE
		WHEN jsonb_typeof(metadata."value"->'entries') = 'array'
			THEN metadata."value"->'entries'
		ELSE '[]'::jsonb
	END
) WITH ORDINALITY AS entry("value", "ordinality")
WHERE activity."event_type" = 'project.update_recorded'
	AND jsonb_typeof(entry."value") = 'object'
	AND length(trim(COALESCE(entry."value"->>'title', ''))) > 0
ON CONFLICT DO NOTHING;
