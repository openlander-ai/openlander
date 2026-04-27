-- Contract test seed fixture for OpenLander 1.0
-- Loaded by tools/qa/start-test-backend.mjs before vitest runs.
--
-- Schema must match src/db/schema.sql (or the ORM migration).
-- Contents are kept minimal — just enough to exercise all 5 contract tests:
--   topology.test.ts     → 1 project with 3 services (non-trivial graph)
--   health.test.ts       → service with known health state
--   metrics.test.ts      → 1 service WITH metrics (200 path) + 1 WITHOUT (204 path)
--   deploy-log-sse.test.ts → 1 completed deploy + 1 running deploy
--   notifications-webhook.test.ts → NO webhook stored (404 path first, then POST)
--
-- IDs are stable strings to make test assertions predictable.

-- ─── Project ──────────────────────────────────────────────────────────────────
INSERT OR REPLACE INTO projects (id, slug, name, description, initials, color, created_at, updated_at)
VALUES (
  'hotdeal-tracker',
  'hotdeal-tracker',
  'hotdeal-tracker',
  'Korean hot-deal aggregator · web + api + worker + postgres',
  'HT',
  'oklch(0.65 0.18 155)',
  '2025-01-15T00:00:00Z',
  '2025-01-15T00:00:00Z'
);

-- ─── Services ─────────────────────────────────────────────────────────────────
-- web service (has metrics history)
INSERT OR REPLACE INTO services (id, project_id, name, kind, image, port, health, url, depends_on, created_at, updated_at)
VALUES (
  'svc-web',
  'hotdeal-tracker',
  'web',
  'Application',
  'node:22-alpine',
  3000,
  'healthy',
  'https://hotdeal.example.com',
  '[]',
  '2025-01-15T00:00:00Z',
  '2025-01-15T00:00:00Z'
);

-- api service (has metrics history)
INSERT OR REPLACE INTO services (id, project_id, name, kind, image, port, health, url, depends_on, created_at, updated_at)
VALUES (
  'svc-api',
  'hotdeal-tracker',
  'api',
  'Application',
  'node:22-alpine',
  4000,
  'healthy',
  NULL,
  '["svc-db"]',
  '2025-01-15T00:00:00Z',
  '2025-01-15T00:00:00Z'
);

-- db service (NO metrics history → triggers 204 path in metrics.test.ts)
INSERT OR REPLACE INTO services (id, project_id, name, kind, image, port, health, url, depends_on, created_at, updated_at)
VALUES (
  'svc-db',
  'hotdeal-tracker',
  'db',
  'Database',
  'postgres:16-alpine',
  5432,
  'healthy',
  NULL,
  '[]',
  '2025-01-15T00:00:00Z',
  '2025-01-15T00:00:00Z'
);

-- ─── Metrics (for svc-web — 60 datapoints, gives 200 response) ───────────────
-- Stored as a single row of JSON arrays; the backend query unpacks them.
INSERT OR REPLACE INTO service_metrics (service_id, range_key, cpu_json, memory_json, rps_json, error_rate_json, p95_latency_ms, total_requests, recorded_at)
VALUES (
  'svc-web',
  '1h',
  '[2.1,2.3,2.0,1.9,2.2,2.4,2.1,2.0,1.8,2.5,2.3,2.1,2.0,1.9,2.2,2.4,2.1,2.0,1.8,2.5,2.3,2.1,2.0,1.9,2.2,2.4,2.1,2.0,1.8,2.5,2.3,2.1,2.0,1.9,2.2,2.4,2.1,2.0,1.8,2.5,2.3,2.1,2.0,1.9,2.2,2.4,2.1,2.0,1.8,2.5,2.3,2.1,2.0,1.9,2.2,2.4,2.1,2.0,1.8,2.5]',
  '[184,186,183,182,185,187,184,183,181,188,186,184,183,182,185,187,184,183,181,188,186,184,183,182,185,187,184,183,181,188,186,184,183,182,185,187,184,183,181,188,186,184,183,182,185,187,184,183,181,188,186,184,183,182,185,187,184,183,181,188]',
  '[32,34,31,30,33,35,32,31,29,36,34,32,31,30,33,35,32,31,29,36,34,32,31,30,33,35,32,31,29,36,34,32,31,30,33,35,32,31,29,36,34,32,31,30,33,35,32,31,29,36,34,32,31,30,33,35,32,31,29,36]',
  '[0.4,0.3,0.4,0.5,0.3,0.2,0.4,0.3,0.4,0.5,0.3,0.2,0.4,0.3,0.4,0.5,0.3,0.2,0.4,0.3,0.4,0.5,0.3,0.2,0.4,0.3,0.4,0.5,0.3,0.2,0.4,0.3,0.4,0.5,0.3,0.2,0.4,0.3,0.4,0.5,0.3,0.2,0.4,0.3,0.4,0.5,0.3,0.2,0.4,0.3,0.4,0.5,0.3,0.2,0.4,0.3,0.4,0.5,0.3,0.2]',
  145,
  87432,
  '2025-04-27T00:00:00Z'
);

-- ─── Deployments ──────────────────────────────────────────────────────────────
-- Completed deploy (used by deploy-log-sse.test.ts to assert terminal event)
INSERT OR REPLACE INTO deployments (id, project_id, service_id, status, outcome, error_class, created_at, updated_at)
VALUES (
  'deploy-done-1',
  'hotdeal-tracker',
  'svc-web',
  'completed',
  'success',
  NULL,
  '2025-04-27T01:00:00Z',
  '2025-04-27T01:05:00Z'
);

-- Running deploy (no terminal event yet — SSE test subscribes and reads live)
INSERT OR REPLACE INTO deployments (id, project_id, service_id, status, outcome, error_class, created_at, updated_at)
VALUES (
  'deploy-running-1',
  'hotdeal-tracker',
  'svc-web',
  'running',
  NULL,
  NULL,
  '2025-04-27T02:00:00Z',
  '2025-04-27T02:00:00Z'
);

-- ─── Notification webhook — intentionally NOT seeded ─────────────────────────
-- notifications-webhook.test.ts: first GET must return 404, then POST creates it.
