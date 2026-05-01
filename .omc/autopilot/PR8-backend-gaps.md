# PR8 follow-up — Backend endpoint matching audit

> Surveyed after PR1-PR7 landed. UI fetch sites vs `src/web/api/*-routes.ts`.
> Backend session is out-of-bounds for this UI session, so all gaps are
> documented as backend-side TODOs unless the UI itself can be repointed
> at an existing endpoint.

## Status legend

- ✅ — UI calls match a shipped backend route, response shape compatible.
- ⚠️ — Path differs OR payload shape differs; UI degrades to mock fallback today.
- ❌ — Backend route missing entirely; UI graceful-degrade required.
- 🔒 — UI uses raw `fetch()` instead of `fetchWithAuth()`; needs review post auth-hardening session.

## Service endpoints

| UI call                                                            | Backend route              | Status | Notes                                                                                                                                            |
| ------------------------------------------------------------------ | -------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getServices()` GET `/api/services`                                | `system-routes.ts:124`     | ✅     |                                                                                                                                                  |
| `getService(id)` GET `/api/services/:id`                           | `system-routes.ts:201`     | ✅     |                                                                                                                                                  |
| `getServiceTemplates()` GET `/api/services/templates`              | `system-routes.ts:134`     | ✅     |                                                                                                                                                  |
| `createService()` POST `/api/services`                             | `system-routes.ts:146`     | 🔒     | uses raw `fetch()` — verify auth handling                                                                                                        |
| `removeService()` DELETE `/api/services/:id`                       | `system-routes.ts:375`     | ✅     |                                                                                                                                                  |
| `startService()` / `stopService()`                                 | `system-routes.ts:390/405` | ✅     |                                                                                                                                                  |
| `getServiceStats()` GET `/api/services/:id/stats`                  | `system-routes.ts:237`     | ✅     |                                                                                                                                                  |
| `getConnectedProjects()`                                           | `system-routes.ts:252`     | ✅     |                                                                                                                                                  |
| `getServiceLogs()` GET `/api/services/:id/logs`                    | `system-routes.ts:216`     | 🔒     | raw `fetch()`                                                                                                                                    |
| `getServiceDatabases()`                                            | `system-routes.ts:270`     | 🔒     | raw `fetch()`                                                                                                                                    |
| `createServiceDatabase()`                                          | `system-routes.ts:291`     | ✅     |                                                                                                                                                  |
| `getServiceUsers()`                                                | `system-routes.ts:320`     | 🔒     | raw `fetch()`                                                                                                                                    |
| `createServiceUser()`                                              | `system-routes.ts:341`     | ✅     |                                                                                                                                                  |
| **`fetchServiceHealth()` GET `/api/services/:id/health`**          | **MISSING**                | ❌     | UI's `useServiceHealth` polls every 5s; falls through to topology.health. PR7 added a "stale" indicator on the header pill when the call errors. |
| **`fetchServiceMetrics()` GET `/api/services/:id/metrics?range=`** | **MISSING**                | ❌     | ServiceDetailV2's Monitoring tab shows synthetic metrics from `useServiceMetrics` hook. Needs backend ship for real numbers.                     |

## Project / topology endpoints

| UI call                                                       | Backend route           | Status | Notes                                                                                                                                                              |
| ------------------------------------------------------------- | ----------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `getProjects()` GET `/api/projects`                           | `project-routes.ts:293` | ✅     | The shared `<ProjectsProvider>` polls this.                                                                                                                        |
| `getProject(id)` GET `/api/projects/:id`                      | `project-routes.ts:340` | ✅     |                                                                                                                                                                    |
| `getProjectStats()` GET `/api/projects/:id/stats`             | `project-routes.ts:244` | ✅     |                                                                                                                                                                    |
| `getProjectServices()` GET `/api/projects/:id/services`       | `project-routes.ts:507` | ✅     | InfraMap uses this for node list.                                                                                                                                  |
| `getProjectDeployments()` GET `/api/projects/:id/deployments` | `project-routes.ts:651` | ✅     |                                                                                                                                                                    |
| `getProjectDeployment(id, deployId)`                          | `project-routes.ts:674` | ✅     |                                                                                                                                                                    |
| `redeployProject()` POST `/api/projects/:id/redeploy`         | `project-routes.ts:744` | ✅     |                                                                                                                                                                    |
| `stopProject()` POST `/api/projects/:id/stop`                 | `project-routes.ts:723` | ✅     |                                                                                                                                                                    |
| **`fetchProjectTopology()` GET `/api/projects/:id/topology`** | **MISSING**             | ❌     | Backend ships `/projects/:id/services` (no `dependsOn[]`). InfraMap uses node list from real `/services` endpoint + edges from mock until topology endpoint ships. |

## Deploy log stream (SSE)

| UI call                                                    | Backend route | Status | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------- | ------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useDeployLogStream` SSE `/api/deployments/:id/log/stream` | **MISSING**   | ❌     | Backend exposes `/api/projects/:id/build/stream` instead — different identifier (projectId, not deploymentId) AND different event shape (timeline events `{phase, status, message, durationMs}`, not line events `{phase, prefix, payload}`). UI's SSE call will 404 today. **Three paths forward:** (a) backend ships the deployment-keyed log stream with the line-event shape; (b) UI repoints to the project-keyed timeline stream and the LogViewer adapts; (c) UI keeps mock-only mode for log streaming and treats this as a deferred 1.0 feature. Decision needed before launch. |

## Notifications / settings

| UI call                                                                | Backend route | Status | Notes                                                                           |
| ---------------------------------------------------------------------- | ------------- | ------ | ------------------------------------------------------------------------------- |
| `fetchNotificationWebhook()` GET `/api/settings/notifications/webhook` | **MISSING**   | ❌     | UI catches 404 silently (defaults). Save will error-toast. Needs backend route. |
| `saveNotificationWebhook()` POST same                                  | **MISSING**   | ❌     |                                                                                 |

## Recommendations (UI-side, non-blocking for 1.0)

1. **Replace raw `fetch()` calls with `fetchWithAuth()`** in `services.ts` (lines 52, 100, 116, 130). Pre-existing security concern after the auth-hardening session — verify whether these endpoints accept anonymous reads or need session cookies. Trivial 4-line change.
2. **Document the SSE gap** in user-facing release notes — log streaming is a 1.0 known limitation if the deployment-keyed endpoint doesn't ship.
3. **Wire `fetchProjectTopology()` to fall back to `/projects/:id/services`** in the hook itself, so the InfraMap shows node positions from real data even without the topology endpoint. (PR7 already does this implicitly via `useProjectTopology` mock fallback, but the fallback path is the mock, not the partial real services list. Could be tightened.)

## Recommendations (backend-side, for post-1.0 or parallel session)

Priority order if backend can pick these up before launch:

1. `GET /api/services/:id/health` — UI polls every 5s; the stale-indicator works but real health beats topology snapshots.
2. `GET /api/projects/:id/topology` — InfraMap edges (`dependsOn[]`) currently mocked. Visible in the UI as "topology preview" feeling.
3. `GET /api/deployments/:id/log/stream` (SSE, line-event shape) — biggest user-visible gap. Today's mock simulator looks real but isn't.
4. `GET/POST/DELETE /api/settings/notifications/webhook` — settings page doesn't persist anything.
5. `GET /api/services/:id/metrics?range=` — Monitoring tab is synthetic.

## How to verify post-merge

1. Run `npm run dev` (web) + backend.
2. Open `/services/:id` for a real running service.
3. Network tab — note 404s on `health`, `metrics`, `topology`, `notifications/webhook`. UI should NOT crash; falls through to mock or "stale" indicator.
4. SSE gap: navigate to a deployment log view — connection error in console; LogViewer shows the mock fallback.
