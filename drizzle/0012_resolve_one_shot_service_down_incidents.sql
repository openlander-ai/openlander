-- One-shot Compose jobs normally stop after completing. Before runtime roles
-- were enforced by the passive service monitor, those expected exits were
-- persisted as unresolved service_down incidents. Keep genuine job failures in
-- deploy history while resolving only the monitor's false-positive category.
UPDATE "runtime_incidents" AS "incident"
SET
  "resolved" = 1,
  "resolved_at" = COALESCE("incident"."resolved_at", CURRENT_TIMESTAMP::text)
FROM "services" AS "service"
WHERE "incident"."service_id" = "service"."id"
  AND "service"."runtime_role" = 'job'
  AND "incident"."category" = 'service_down'
  AND "incident"."resolved" = 0;
