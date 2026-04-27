-- Reverse 0007. SQLite has no `IF EXISTS` clause for `DROP INDEX` on
-- some older builds; we use it here per the existing repo convention
-- (drizzle-generated drops in earlier migrations).

DROP INDEX IF EXISTS `idx_service_metrics_service_recorded`;
--> statement-breakpoint
DROP TABLE IF EXISTS `service_metrics`;
--> statement-breakpoint
DROP TABLE IF EXISTS `settings`;
