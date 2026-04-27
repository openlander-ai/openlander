-- Phase E_NEW Task 5 + Task 7 — backend migration for the v4 service
-- detail metrics endpoint and the notifications webhook persistence.
--
-- 1) `service_metrics` — time-series sample table backing
--    GET /api/services/:id/metrics. One row per service per stats
--    sample interval. Aggregated on read into 60 datapoints per range
--    (15m / 1h / 6h / 24h / 7d) plus p95LatencyMs and totalRequests.
--    Independent from the existing `service_stats` table because
--    `service_stats` carries the most-recent snapshot only, not
--    history.
-- 2) `settings` — generic key/value config store. Used by Task 7's
--    notifications webhook (`key = 'notification_webhook'`) and any
--    future single-tenant configuration that doesn't merit a
--    dedicated table.
--
-- Reversible: see the matching down notes in
-- `drizzle/0007_service_metrics_and_settings.down.sql`.

CREATE TABLE IF NOT EXISTS `service_metrics` (
    `service_id` text NOT NULL,
    `recorded_at` integer NOT NULL,
    `cpu` real NOT NULL DEFAULT 0,
    `mem` real NOT NULL DEFAULT 0,
    `req` real NOT NULL DEFAULT 0,
    `err` real NOT NULL DEFAULT 0,
    `p95_latency_ms` real,
    `request_count` integer NOT NULL DEFAULT 0,
    FOREIGN KEY (`service_id`) REFERENCES `services`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS `idx_service_metrics_service_recorded`
    ON `service_metrics` (`service_id`, `recorded_at`);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `settings` (
    `key` text PRIMARY KEY NOT NULL,
    `value` text NOT NULL,
    `updated_at` text DEFAULT CURRENT_TIMESTAMP
);
