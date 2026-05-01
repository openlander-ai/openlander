-- Contract test seed fixture for OpenLander 1.0
-- Loaded by tools/qa/start-test-backend.mjs AFTER drizzle migrations have run
-- against /tmp/ol-contract-test.db. Aligned with post-0012 schema:
--   - projects: group-only metadata (no status/source/etc — see migration 0012)
--   - services: canonical kind/image_url/assigned_port (legacy type/image/port dropped)
--   - deploy_logs: service_id FK (legacy project_id dropped)
-- The synthetic `__orphan_managed` group row is created by migration 0009 Phase C.
--
-- Contents are kept minimal — just enough to exercise all 5 contract tests:
--   topology.test.ts     → 1 project (hotdeal-tracker) with 1 service tied to it
--                           so /projects/:id/topology returns >= 1 node.
--   health.test.ts       → 1 service (svc-web) status='running'
--                           (the route collapses 'running' → 'healthy').
--   metrics.test.ts      → svc-web has metric rows (200 path)
--                           svc-db has NO metric rows (204 path).
--   deploy-log-sse.test.ts → 1 completed deploy_log + 1 running deploy_log,
--                             both keyed on svc-web (post-0012 service_id FK).
--   notifications-webhook.test.ts → NO webhook stored (404 path first).

-- ─── Project ──────────────────────────────────────────────────────────────────
-- Topology resolves `:id` via id-or-name, so id=name keeps the URL stable.
INSERT OR REPLACE INTO projects (id, name, repo_url, branch, server_id, created_at, updated_at)
VALUES (
  'hotdeal-tracker',
  'hotdeal-tracker',
  'https://github.com/example/hotdeal-tracker.git',
  'main',
  'local',
  '2025-01-15T00:00:00.000Z',
  '2025-01-15T00:00:00.000Z'
);

-- ─── Services ─────────────────────────────────────────────────────────────────
-- Three rows seeded:
--   1. hotdeal-tracker__svc — canonical deployable for the hotdeal-tracker
--      group, required by `migrateDefaultResourceProfile` in src/app.ts which
--      iterates listProjects() and calls saveDeployConfig(projectId), and the
--      DeployConfigRepo translates `${projectId}__svc` → service_id FK.
--      Without this row, app boot fails with FOREIGN KEY constraint failed.
--   2. svc-web — contract-test entity referenced by URL paths in topology /
--      health / metrics / deploy-log-sse tests. Tied to the hotdeal-tracker
--      group so /projects/hotdeal-tracker/topology returns at least 1 node.
--   3. svc-db — managed postgres pinned to the synthetic __orphan_managed
--      group (created by migration 0009 Phase C).
INSERT OR REPLACE INTO services (
  id, project_id, name, kind, status,
  container_name, assigned_port, image_url,
  source, project_type, created_at, updated_at
)
VALUES (
  'hotdeal-tracker__svc',
  'hotdeal-tracker',
  'hotdeal-tracker__svc',
  'image',
  'running',
  'ol-svc-hotdeal-tracker',
  3001,
  'node:22-alpine',
  'image',
  'web',
  '2025-01-15T00:00:00.000Z',
  '2025-01-15T00:00:00.000Z'
);

INSERT OR REPLACE INTO services (
  id, project_id, name, kind, status,
  container_name, assigned_port, image_url,
  source, project_type, created_at, updated_at
)
VALUES (
  'svc-web',
  'hotdeal-tracker',
  'svc-web',
  'image',
  'running',
  'ol-svc-svc-web',
  3000,
  'node:22-alpine',
  'image',
  'web',
  '2025-01-15T00:00:00.000Z',
  '2025-01-15T00:00:00.000Z'
);

INSERT OR REPLACE INTO services (
  id, project_id, name, kind, status,
  container_name, assigned_port, image_url,
  source, project_type, created_at, updated_at
)
VALUES (
  'svc-db',
  '__orphan_managed',
  'svc-db',
  'postgres',
  'running',
  'ol-svc-svc-db',
  5432,
  'postgres:16-alpine',
  'image',
  'web',
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
-- Post-0012: deploy_logs.service_id (legacy project_id dropped). svc-web is
-- the deployable for hotdeal-tracker, so deploy logs hang off the service.
-- Completed deploy → SSE end event; build_log content lets the historical
-- replay path emit at least one `line` event for the live-stream test.
INSERT OR REPLACE INTO deploy_logs (id, service_id, status, trigger_source, build_log, duration_ms, created_at)
VALUES (
  'deploy-done-1',
  'svc-web',
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
INSERT OR REPLACE INTO deploy_logs (id, service_id, status, trigger_source, build_log, created_at)
VALUES (
  'deploy-running-1',
  'svc-web',
  NULL,
  'api',
  '[clone] cloning https://github.com/example/hotdeal-tracker.git
[build] docker build -t hotdeal-tracker:latest .',
  '2025-04-27T02:00:00.000Z'
);

-- ─── Notification webhook — intentionally NOT seeded ─────────────────────────
-- notifications-webhook.test.ts: first GET must return 404, then POST creates it.
