-- Phase 1 (ralplan-monitoring-logs) — persist MCP session connect+disconnect
-- events so the v4 /api/activity feed can surface mcp_disconnected events
-- (currently mcp_connected is synthesized from in-memory active sessions and
-- mcp_disconnected silently disappears when the session closes).
--
-- One row per session, written on close. `connected_at` carries the original
-- creation timestamp, `disconnected_at` is the close moment. Both are integer
-- ms-since-epoch for ordering — match the existing pattern in
-- `service_metrics.recorded_at`.

CREATE TABLE IF NOT EXISTS `mcp_session_log` (
    `id` text PRIMARY KEY,
    `session_id` text NOT NULL,
    `transport` text NOT NULL,
    `connected_at` integer NOT NULL,
    `disconnected_at` integer NOT NULL,
    `client_info` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_mcp_session_log_disconnected_at` ON `mcp_session_log`(`disconnected_at`);
