-- Contract test seed fixture for OpenLander 1.0
-- Loaded by tools/qa/start-test-backend.mjs AFTER drizzle migrations have run
-- against /tmp/ol-contract-test.db. The columns below match the schema as of
-- migration 0007 — keep this file in lockstep with `drizzle/000*.sql`.
--
-- Contents are kept minimal — just enough to exercise all 5 contract tests:
--   topology.test.ts     → 1 project (hotdeal-tracker) — topology endpoint
--                           reads from `projects` (single-project deploys
--                           expose themselves as a 1-node topology).
--   health.test.ts       → 1 service (svc-web) with status='running'
--                           (the route collapses 'running' → 'healthy').
--   metrics.test.ts      → svc-web has metric rows (200 path)
--                           svc-db has NO metric rows (204 path).
--   deploy-log-sse.test.ts → 1 completed deploy_log + 1 running deploy_log.
--   notifications-webhook.test.ts → NO webhook stored (404 path first).

-- ─── Project ──────────────────────────────────────────────────────────────────
-- Topology resolves `:id` via id-or-name, so id=name keeps the URL stable.
INSERT OR REPLACE INTO projects (id, name, repo_url, branch, status, source, created_at, updated_at)
VALUES (
  'hotdeal-tracker',
  'hotdeal-tracker',
  'https://github.com/example/hotdeal-tracker.git',
  'main',
  'running',
  'git',
  '2025-01-15T00:00:00.000Z',
  '2025-01-15T00:00:00.000Z'
);

-- ─── Services ─────────────────────────────────────────────────────────────────
-- Post-0009 services table requires project_id (FK → projects) and kind.
-- Managed services land in the synthetic __orphan_managed group; svc-web
-- imitates a deployable but is treated as a generic "application" via legacy
-- type column for the metrics endpoint test (which keys on service_id only).
INSERT OR REPLACE INTO services (id, name, type, image, status, container_id, container_name, port, project_id, kind, created_at, updated_at)
VALUES (
  'svc-web',
  'svc-web',
  'application',
  'node:22-alpine',
  'running',
  NULL,
  'ol-svc-svc-web',
  3000,
  '__orphan_managed',
  'image',
  '2025-01-15T00:00:00.000Z',
  '2025-01-15T00:00:00.000Z'
);

INSERT OR REPLACE INTO services (id, name, type, image, status, container_id, container_name, port, project_id, kind, created_at, updated_at)
VALUES (
  'svc-db',
  'svc-db',
  'postgresql',
  'postgres:16-alpine',
  'running',
  NULL,
  'ol-svc-svc-db',
  5432,
  '__orphan_managed',
  'postgres',
  '2025-01-15T00:00:00.000Z',
  '2025-01-15T00:00:00.000Z'
);

-- ─── Service metrics (svc-web only — gives 200 response) ─────────────────────
-- Per-row time-series; route downsamples to 60 buckets on read. 12 samples
-- spread across the last 30 minutes is plenty for the 1h range query and
-- pads cleanly to 60 datapoints in the route's downsample helper.
-- recorded_at is epoch milliseconds (integer).
INSERT INTO service_metrics (service_id, recorded_at, cpu, mem, req, err, p95_latency_ms, request_count)
VALUES
  ('svc-web', strftime('%s', 'now', '-30 minutes') * 1000, 2.1, 184, 32, 0.4, 145, 32),
  ('svc-web', strftime('%s', 'now', '-25 minutes') * 1000, 2.3, 186, 34, 0.3, 142, 34),
  ('svc-web', strftime('%s', 'now', '-22 minutes') * 1000, 2.0, 183, 31, 0.4, 148, 31),
  ('svc-web', strftime('%s', 'now', '-18 minutes') * 1000, 1.9, 182, 30, 0.5, 151, 30),
  ('svc-web', strftime('%s', 'now', '-15 minutes') * 1000, 2.2, 185, 33, 0.3, 147, 33),
  ('svc-web', strftime('%s', 'now', '-12 minutes') * 1000, 2.4, 187, 35, 0.2, 144, 35),
  ('svc-web', strftime('%s', 'now', '-10 minutes') * 1000, 2.1, 184, 32, 0.4, 145, 32),
  ('svc-web', strftime('%s', 'now', '-8 minutes') * 1000, 2.0, 183, 31, 0.3, 146, 31),
  ('svc-web', strftime('%s', 'now', '-6 minutes') * 1000, 1.8, 181, 29, 0.4, 149, 29),
  ('svc-web', strftime('%s', 'now', '-4 minutes') * 1000, 2.5, 188, 36, 0.5, 143, 36),
  ('svc-web', strftime('%s', 'now', '-2 minutes') * 1000, 2.3, 186, 34, 0.3, 145, 34),
  ('svc-web', strftime('%s', 'now', '-1 minutes') * 1000, 2.1, 184, 32, 0.4, 146, 32);

-- ─── Deploy logs ──────────────────────────────────────────────────────────────
-- Completed deploy → SSE end event; build_log content lets the historical
-- replay path emit at least one `line` event for the live-stream test.
INSERT OR REPLACE INTO deploy_logs (id, project_id, status, trigger_source, build_log, duration_ms, created_at)
VALUES (
  'deploy-done-1',
  'hotdeal-tracker',
  'success',
  'api',
  '[clone] cloning https://github.com/example/hotdeal-tracker.git
[build] docker build -t hotdeal-tracker:latest .
[build] hotdeal-tracker:latest (1234ms)
[run] container started ol-hotdeal-tracker',
  300000,
  '2025-04-27T01:00:00.000Z'
);

-- "Running" deploy is represented by a deploy_log row with status=NULL —
-- the SSE source treats a NULL status row as in-flight.
INSERT OR REPLACE INTO deploy_logs (id, project_id, status, trigger_source, build_log, created_at)
VALUES (
  'deploy-running-1',
  'hotdeal-tracker',
  NULL,
  'api',
  '[clone] cloning https://github.com/example/hotdeal-tracker.git
[build] docker build -t hotdeal-tracker:latest .',
  '2025-04-27T02:00:00.000Z'
);

-- ─── Notification webhook — intentionally NOT seeded ─────────────────────────
-- notifications-webhook.test.ts: first GET must return 404, then POST creates it.
