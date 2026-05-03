-- Contract test seed fixture for OpenLander 0.1.0.
-- Loaded by tools/qa/start-test-backend.mjs after Postgres migrations run.

-- Topology resolves `:id` via id-or-name, so id=name keeps the URL stable.
INSERT INTO projects (id, name, server_id, created_at, updated_at)
VALUES (
  'hotdeal-tracker',
  'hotdeal-tracker',
  'local',
  '2025-01-15T00:00:00.000Z',
  '2025-01-15T00:00:00.000Z'
);

-- Managed-service rows need a project owner because services.project_id is an FK.
INSERT INTO projects (id, name, server_id, created_at, updated_at)
VALUES (
  '__orphan_managed',
  '__orphan_managed',
  'local',
  '2025-01-15T00:00:00.000Z',
  '2025-01-15T00:00:00.000Z'
);

INSERT INTO services (
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

INSERT INTO services (
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

INSERT INTO services (
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

-- svc-web only: gives 200 response for metrics. svc-db intentionally has none.
INSERT INTO service_metrics (service_id, recorded_at, cpu, mem, req, err, p95_latency_ms, request_count)
VALUES
  ('svc-web', (extract(epoch from now() - interval '30 minutes') * 1000)::bigint, 2.1, 184, 32, 0.4, 145, 32),
  ('svc-web', (extract(epoch from now() - interval '25 minutes') * 1000)::bigint, 2.3, 186, 34, 0.3, 142, 34),
  ('svc-web', (extract(epoch from now() - interval '22 minutes') * 1000)::bigint, 2.0, 183, 31, 0.4, 148, 31),
  ('svc-web', (extract(epoch from now() - interval '18 minutes') * 1000)::bigint, 1.9, 182, 30, 0.5, 151, 30),
  ('svc-web', (extract(epoch from now() - interval '15 minutes') * 1000)::bigint, 2.2, 185, 33, 0.3, 147, 33),
  ('svc-web', (extract(epoch from now() - interval '12 minutes') * 1000)::bigint, 2.4, 187, 35, 0.2, 144, 35),
  ('svc-web', (extract(epoch from now() - interval '10 minutes') * 1000)::bigint, 2.1, 184, 32, 0.4, 145, 32),
  ('svc-web', (extract(epoch from now() - interval '8 minutes') * 1000)::bigint, 2.0, 183, 31, 0.3, 146, 31),
  ('svc-web', (extract(epoch from now() - interval '6 minutes') * 1000)::bigint, 1.8, 181, 29, 0.4, 149, 29),
  ('svc-web', (extract(epoch from now() - interval '4 minutes') * 1000)::bigint, 2.5, 188, 36, 0.5, 143, 36),
  ('svc-web', (extract(epoch from now() - interval '2 minutes') * 1000)::bigint, 2.3, 186, 34, 0.3, 145, 34),
  ('svc-web', (extract(epoch from now() - interval '1 minutes') * 1000)::bigint, 2.1, 184, 32, 0.4, 146, 32);

-- Completed deploy: SSE historical replay emits line events and an end event.
INSERT INTO deploy_logs (id, service_id, status, trigger_source, build_log, duration_ms, created_at)
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

-- Running deploy is represented by a deploy_log row with status=NULL.
INSERT INTO deploy_logs (id, service_id, status, trigger_source, build_log, created_at)
VALUES (
  'deploy-running-1',
  'svc-web',
  NULL,
  'api',
  '[clone] cloning https://github.com/example/hotdeal-tracker.git
[build] docker build -t hotdeal-tracker:latest .',
  '2025-04-27T02:00:00.000Z'
);
