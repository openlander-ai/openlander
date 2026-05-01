# PR6 — Round 4 backend wire-up (5 endpoints) + CCG hardening + cleanup

## Summary

PR6 replaces five mock data sources in the V2 frontend with real backend
endpoints, while keeping mock fallback as the default offline behavior
(the parallel backend session has not yet shipped these endpoints, so
mock paths remain the working state for any developer who pulls
`ui-redesign-1.0` today).

The PR also bakes in a Codex+Gemini CCG review pass that caught three
real correctness bugs in the initial SSE design and added two UX touches
(Demo Mode affordance, Save loading state) plus a broken-window cleanup
(`MOCK_FLEET_SERVICES`).

### Endpoints wired

| Endpoint                                       | Consumer                                       | Hook                                                   |
| ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------ |
| `GET /api/projects/:id/topology`               | ProjectViewV2 + ServiceDetailV2 sibling lookup | `useProjectTopology`                                   |
| `GET /api/services/:id/health`                 | ServiceDetailV2 header pill                    | `useServiceHealth`                                     |
| `GET /api/services/:id/metrics?range=…`        | ServiceDetailV2 MonitoringTab 2×2 sparklines   | `useServiceMetrics`                                    |
| `GET /api/deployments/:id/log/stream` (SSE)    | LogViewer (deploy variant)                     | `useDeployLogStream`                                   |
| `POST/GET /api/settings/notifications/webhook` | settings/Notifications                         | `fetchNotificationWebhook` / `saveNotificationWebhook` |

## Files added (8)

| Path                                     | Purpose                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| `web/src/lib/api/topology.ts`            | `fetchProjectTopology(id)` — services array client                      |
| `web/src/lib/api/notifications.ts`       | `fetchNotificationWebhook` / `save` / `delete` (404 → null)             |
| `web/src/hooks/use-project-topology.ts`  | Polling 10s/3s, last-good on errors, mock fallback before first success |
| `web/src/hooks/use-service-health.ts`    | Header-pill-scoped polling 10s/3s                                       |
| `web/src/hooks/use-service-metrics.ts`   | Range-aware metrics polling, 10s flat                                   |
| `web/src/hooks/use-deploy-log-stream.ts` | SSE consumer; sessionRef guard; freeze elapsed on terminal              |
| `web/src/hooks/use-mock-log-stream.ts`   | Extracted simulator with real `kill()` semantics                        |
| `web/src/i18n/PATCH-PR6.md`              | Manual i18n merge — toast strings, sample-data chip, health pill        |

## Files modified (8)

- `web/src/lib/api/services.ts` — added `fetchServiceHealth` + `fetchServiceMetrics` + `ServiceMetrics` + `MetricsRange` types.
- `web/src/lib/api/index.ts` — re-export new modules.
- `web/src/components/Shell/InfraMap.tsx` — added `isDemo` prop + `DemoEyebrowChip` ("Sample data" badge); Eyebrow gains optional `isDemo`.
- `web/src/components/Shell/LogViewer.tsx` — simulator useEffect replaced by mock + SSE hooks (mounted in parallel, mutually-exclusive `enabled`); new `mockMode` + `deploymentId` props; `forceConnState` became a display overlay (doesn't try to write into the hook); `errorClass` resolved with SSE priority (`stream.errorClass ?? prop.errorClass`).
- `web/src/pages/ProjectViewV2.tsx` — `getServices()` replaced by `useProjectTopology`; `isDemo` flows to InfraMap.
- `web/src/pages/ServiceDetailV2.tsx` — sibling-service lookup via `useProjectTopology`; header gets `<HealthBadge>` driven by `useServiceHealth` (falling back to topology.health); MonitoringTab uses `useServiceMetrics` with deterministic-series fallback. Deploy overlay still uses `mockMode` because MOCK_DEPLOYMENTS uses synthetic numeric IDs (PR7 will switch to real deployments).
- `web/src/pages/settings/Notifications.tsx` — full wire-up: GET on mount (404 keeps defaults), POST on Save with sonner toast, explicit `isSaving` loading state (CCG: slow self-hosted networks → double-clicks otherwise), URL field disabled while loading existing config.
- `web/src/lib/projectTopology.ts` — `MOCK_FLEET_SERVICES` deleted (broken-window cleanup per Gemini CCG); `getServices()` lost its `fleet` option.

## Files NOT touched (deferred)

- **Backend** (`src/`) — parallel session.
- **i18n** (`web/src/i18n/{en,ko}.ts`) — patch file only.
- `RuntimeLogsTab` (`ServiceDetailV2.tsx`) — runtime container logs need a different endpoint than `/api/deployments/:id/log/stream`. Stays mock; PR7+.
- Delete-webhook button on Notifications page — deferred to PR7 when DeleteRow + confirm dialog land.
- Real `getProjectDeployments()` wire-up for DeploymentsTab — PR7 will drop `mockMode={true}` from the overlay LogViewer.
- Project meta (initials, color, lastDeploy display) — UI-synthesized fields not in backend `Project`. Mock `getProject()` stays in PR6; PR7 maps from real `/api/projects/:id` with derived initials/color.

## CCG review hardening (pre-implementation pass)

A `/oh-my-claudecode:ccg` (Claude+Codex+Gemini) review ran against the
PR6 design BEFORE consumer wire-up. Findings drove the following:

### Codex correctness fixes (3 critical bugs caught + fixed)

1. **`useDeployLogStream` reconnect stuck-state** — `firstLineSeen` was a
   single-shot, so any post-LIVE transport blip stayed in RECONNECTING
   forever. Fix: flip to LIVE on ANY non-terminal message via
   `setConnState(cur => isTerminal(cur) ? cur : 'LIVE')`.
2. **EventSource swap race** — `close()` in cleanup did not block in-
   flight `onmessage` from mutating new-session state. Fix: per-mount
   `sessionRef`; each callback bails if `session !== sessionRef.current`.
   Handlers also nulled in cleanup so an already-dispatched event drops.
3. **`useMockLogStream.kill()` was a label-only kill** — it set
   CANCELLED but timers kept firing. Fix: `simRef` carrying an `active`
   flag, a `timeouts` set, and a `progressTimer` ref; `kill()` flips
   active and clears every pending handle.

### Gemini UX additions

- **Demo Mode eyebrow** — `isDemo` flag on `InfraMap` shows a "Sample
  data" chip in the eyebrow when `useProjectTopology.isMockFallback ===
true`. Manages expectations during the pre-backend window.
- **`isSaving` loading state** — Save button on Notifications uses
  `Loader2` spinner + "Saving…" label so slow self-hosted networks
  don't trigger double-clicks.
- **SSE errorClass priority** — `stream.errorClass ?? prop.errorClass`
  in LogViewer, so the SSE end-event's class wins when present.
- **`MOCK_FLEET_SERVICES` deletion** — broken-window cleanup; the
  12-service synthetic was a dense-layout demo only.

### Codex polling refinement (deferred)

- Active-poll heuristic should be `any crashed || any deploy running`,
  not just crashed (Codex Q5). PR6 ships with the simpler `any crashed`
  heuristic because the topology hook doesn't have access to the
  running-deploy signal without coupling to `useDeployments`. Tracked
  for PR7 when the deploy-status surface lands.

## Behavior contracts

### `useProjectTopology(projectId)`

- Polls every 10s (idle) or 3s (any service crashed).
- On fetch success: stores services, clears error, drops `isMockFallback`.
- On fetch failure: keeps last-good `services`; sets `error`. NO flicker
  to mock if we ever had real data.
- On mount with `projectId` set: returns mock services from `getServices(projectId)`
  while the first poll is in flight; flips to real on success.
- `isMockFallback` is true iff `services` (the internal real-data state)
  is still null — i.e. no successful poll yet.

### `useServiceHealth(serviceId)`

- Polls every 10s (healthy) or 3s (crashed).
- ServiceDetailV2 header pill prefers this hook's `health` over
  topology's `health` (falls through when null).

### `useServiceMetrics(serviceId, range)`

- Polls every 10s. Range change triggers immediate refetch via the
  fetcher's useCallback dep.
- The consumer (MonitoringTab) keeps `deterministicSeries` as the
  per-card fallback — when `metrics` is null, the sparkline still
  renders something stable.
- CPU/Memory big numbers stay as topology display strings (`"2.1%"`,
  `"184 MB"`) per CCG decision: avoid NaN/0 flicker if a single metrics
  scrape blips. Sparkline uses the metrics array. Requests/s and Error
  rate big numbers come from the latest metrics datapoint.
- `p95LatencyMs` flows into the requests-card sub-line.

### `useDeployLogStream(deploymentId)`

- Opens one EventSource per `deploymentId`. Null disables.
- `connState` lifecycle: CONNECTING → LIVE on first message → ENDED on
  terminal (or CANCELLED via `kill()`); RECONNECTING on transport
  hiccup; ERRORED on irrecoverable close.
- `lastEventId` is captured for future Last-Event-ID resume (server-
  side `id:` and `Last-Event-ID` header are PR7+ when the backend SSE
  protocol stabilizes).
- `kill()` closes the EventSource, nulls handlers, freezes elapsed,
  sets CANCELLED.

### `useMockLogStream({ enabled, baseScript, outcome, instant })`

- `enabled=false` short-circuits — useful as the dormant peer of
  useDeployLogStream when LogViewer is in SSE mode.
- `instant=true` dumps the full script synchronously and flips to
  ENDED+outcome (used for print pages).
- `kill()` truly stops the simulator (active flag + clear timers).

### LogViewer `mockMode` + `deploymentId` props

| `mockMode`            | `deploymentId`     | Behavior                                          |
| --------------------- | ------------------ | ------------------------------------------------- |
| `true` (or undefined) | any                | Mock simulator runs                               |
| `false`               | `null` / undefined | Mock simulator runs                               |
| `false`               | non-null           | SSE stream from `/api/deployments/:id/log/stream` |

ServiceDetailV2 currently passes `mockMode` while DeploymentsTab uses
`MOCK_DEPLOYMENTS` (numeric synthetic IDs); PR7 drops `mockMode` when
the real deploy list lands.

## Verification

- **TypeScript**: `npx tsc --noEmit` ✓ clean (no new errors).
- **ESLint**: ✓ clean. Two scoped escape hatches added in stream hooks
  for `react-hooks/set-state-in-effect` — the React 19 rule flags the
  documented "reset state on input change" pattern, which is required
  here because using `key=` to remount would invalidate sibling state
  (LogViewer's viewState, virtualizer scroll position).
- **Production build**: `npm run build` ✓ in 13.44s.
- **Code review**: independent agent context (`code-reviewer` subagent)
  — see `.omc/autopilot/PR6-review.md`.

## Manual steps for the user

- [ ] Inspect the diff: `git status --short web/` and `git diff web/`.
- [ ] Boot dev server: `cd web && npm run dev`. Visit:
  - `/projects/hotdeal-tracker` — InfraMap should render mock topology
    with **"Sample data"** chip in the eyebrow (because the backend
    endpoint isn't deployed yet).
  - `/services/api?project=hotdeal-tracker` — header should show
    health pill; MonitoringTab should render deterministic sparklines
    (no crash even when /metrics 404s).
  - Click a deployment row → deploy overlay opens → mock simulator
    runs (because the overlay still uses `mockMode={true}`).
  - `/settings/notifications` — Save button should:
    - Be disabled while loading existing config.
    - Show `Loader2` spinner + "Saving…" while the POST is in flight.
    - Toast "Webhook saved" on success / error message on failure.
- [ ] Once the parallel backend session lands the 5 endpoints, the
      "Sample data" chip should disappear from InfraMap on first poll.
- [ ] Manually merge `web/src/i18n/PATCH-PR1.md`, `PATCH-PR2-PR3.md`,
      `PATCH-PR4.md`, and `PATCH-PR6.md` into `en.ts` / `ko.ts`.
- [ ] Commit on `ui-redesign-1.0` — autopilot did NOT push or open a PR.

## Suggested PR7 scope

1. Real `getProjectDeployments()` wire-up for DeploymentsTab; drop
   `mockMode={true}` from the overlay LogViewer call.
2. Map real `/api/projects/:id` → `ProjectSummary` with derived
   initials/color, drop the mock `getProject()` reference.
3. Active-poll heuristic upgrade: include `any deploy running` in
   addition to `any service crashed`.
4. Server-side SSE `id:` + Last-Event-ID resume (the
   `useDeployLogStream` hook already captures `lastEventId`).
5. Delete-webhook button on Notifications page (DELETE endpoint is
   already exposed in `api/notifications.ts`).
6. RuntimeLogsTab wire-up — needs a separate runtime-stream endpoint.
7. i18n catch-up commit consolidating PATCH-PR1.md through PATCH-PR6.md.
