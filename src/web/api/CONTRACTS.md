# Backend API Contracts — Phase E_NEW

Five endpoints added in Tasks 2, 4, 5, 6, and 7 of the v4 design migration.
Each section documents method/path, request body (if any), and response shape
with field types.

---

## 1. Deploy Log SSE Stream (Task 2)

```
GET /api/deployments/:id/log/stream
```

`:id` resolves to either a `deploy_logs.id` (post-mortem) or a `projects.id`
(in-flight deploy — no `deploy_logs` row yet).

**Request headers (optional)**

```
Last-Event-ID: <last-line-num>   // Resume — skip already-seen lines
```

**Response:** `text/event-stream` (SSE). Two event types:

```
event: line
id:    <line-num>                // integer, monotonically increasing per stream
data:  {
         "phase":   string,      // e.g. "build" | "run" | "cleanup"
         "prefix":  string,      // log-line label
         "payload": string       // log content
       }

event: end
data:  {
         "type":       "end",
         "outcome":    "success" | "fail" | "cancelled",
         "errorClass": string | null   // 16-key error class or null
       }
```

404 JSON `{ error: "NOT_FOUND", message: string }` when `:id` resolves to
nothing.

---

## 2. Service Health (Task 4)

```
GET /api/services/:id/health
```

**Response 200:**

```json
{
  "health": "healthy" | "crashed" | "running"
}
```

- `"healthy"` — container running with Docker HEALTHCHECK reporting `healthy`
- `"crashed"` — container running but healthcheck is `unhealthy` or `starting`
- `"running"` — container running with no HEALTHCHECK declared

**Response 404:** `{ error: "NOT_FOUND", message: string }` — service not
found or container not running.

---

## 3. Service Metrics Time-Series (Task 5)

```
GET /api/services/:id/metrics?range=15m|1h|6h|24h|7d
```

`range` defaults to `1h` when omitted.

**Response 200:**

```json
{
  "cpu":            number[],   // 60 datapoints, CPU percent (0–100×N cores)
  "memory":         number[],   // 60 datapoints, MB
  "requestsPerSec": number[],   // 60 datapoints, req/s
  "errorRate":      number[],   // 60 datapoints, error %
  "p95LatencyMs":   number,     // average p95 latency over the window (ms)
  "totalRequests":  number      // sum of request_count rows in the window
}
```

Always exactly 60 elements per array (uniform downsample on read; left-padded
with the first value when fewer than 60 rows exist in the window).

**Response 204 No Content:** service exists but has no recorded samples yet
(first-deploy or health monitor hasn't ticked yet). UI should show a
placeholder sparkline.

**Response 404:** `{ error: "NOT_FOUND", message: string }` — service not found.

---

## 4. Project Topology Graph (Task 6)

```
GET /api/projects/:id/topology
```

**Response 200:**

```json
{
  "services": [
    {
      "id":         string,                    // project.id (or child project id for compose)
      "name":       string,                    // project.name
      "kind":       "Application" | "Database",
      "image":      string,                    // image_url | image_tag | "<name>:latest"
      "health":     "healthy" | "crashed",     // binary; no-healthcheck → "healthy"
      "port":       number | null,             // assigned_port or null
      "url":        string | null,             // sslip.io URL or null
      "cpu":        string,                    // "2.1%" or "—" when unavailable
      "mem":        string,                    // "184 MB" or "—" when unavailable
      "dependsOn":  string[]                   // sibling service ids from project_dependencies
    }
  ]
}
```

For compose projects the nodes are the child projects (one per compose
service). For standalone projects the single node is the project itself.

**Response 404:** `{ error: "NOT_FOUND", message: string }`.

---

## 5. Notifications Webhook Settings (Task 7)

```
GET    /api/settings/notifications/webhook
POST   /api/settings/notifications/webhook
DELETE /api/settings/notifications/webhook
```

### GET

**Response 200:**

```json
{
  "url":    string,    // webhook endpoint URL
  "events": string[]  // subscribed event names
}
```

**Response 404:** `{ error: "NOT_FOUND", message: string }` — no webhook
configured yet.

### POST

**Request body:**

```json
{
  "url":    string,   // required, non-empty
  "events": string[]  // required, array of strings (may be empty)
}
```

**Response 200:** the saved config `{ url: string, events: string[] }`.

### DELETE

**Response 200:** `{ "status": "deleted" }` (idempotent — succeeds even when
no webhook is configured).

---

matches UI types in
`web/src/lib/api/{services,topology,notifications}.ts` and
`web/src/hooks/use-deploy-log-stream.ts` — UI types are source of truth.
Phase F's Vitest+zod contract tests pin this.
