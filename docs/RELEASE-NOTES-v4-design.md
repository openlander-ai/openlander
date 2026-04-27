# Release Notes — v4 Design Migration

> Branch: `feat/v4-design` · Target: merge to `develop`
> Sprint: 2026-04-27

## Summary

This sprint migrates OpenLander's UI from the v2/v3 indigo-accent palette and
page-level chrome to the v4 design system: monochrome green-accent palette,
Linear-style component restraint, and a single AppShell that owns all
navigation chrome.

---

## What Changed

### Design System (Phase A)

- `web/src/styles/tokens.css` updated: `--ol-primary` → green (oklch),
  `--ol-actor-*` palette for agent/human/system actors.
- Tailwind `theme.colors.primary` aliased to `var(--primary)` — legacy
  `bg-blue-*` / `text-indigo-*` utilities auto-resolve to v4 tokens on
  unstyled components.

### V1 Timeline Chain Deleted (Phase B)

The following files are **permanently removed**:

- `web/src/hooks/use-timeline.ts`
- `web/src/components/project/OverviewTab.tsx`
- `web/src/components/project/ProjectDetailTabs.tsx`
- `web/src/components/deploy-terminal/DeployTerminalSession.tsx`

These files consumed the legacy project-keyed build stream endpoint
(`/api/projects/:id/build/stream`). That endpoint is **also removed**
(see SSE Consolidation below).

### Page Rewrites (Phase C)

- `Home.tsx` — new v4 3-section hero: status rollup + projects grid + activity peek.
- `ProjectsGrid.tsx` — single-column list with filter, `StatusPill`, v4 empty state.
- `ErrorSurface.tsx` — new component with 16-key ErrorClass registry.
- `PageHeader.tsx` — **deleted**. All consumers migrated to AppShell-native chrome.
- `Overview.tsx` — **deleted**. Route `/overview` redirects to `/home`.

### InfraMap + LogViewer v4 Alignment (Phase D)

- `InfraMapNode.tsx` — dropped 26px disk+glyph for Linear-style 8px pip + mono service name.
- `LogViewer.css` — all hardcoded `oklch(...)` literals replaced with `var(--log-*)` tokens scoped inside `.ol-log-pane {}`.
- `LogViewerHeader.tsx` — all hardcoded oklch replaced with `var(--log-header-*)` tokens.
- `motion.md` — Shell motion grammar documented: max 200ms, opacity+transform only, no spring.

### Contract Tests + CI (Phase F)

- `vitest` + `zod` added as devDependencies (test-only; not in prod bundle).
- `npm run test:contract` boots a seeded sqlite backend, runs 5 Vitest contract tests, tears down.
- Contract tests: `topology`, `health`, `metrics` (200 + 204 paths), `deploy-log-sse`, `notifications-webhook`.
- 16-key ErrorClass exhaustiveness: any `errorClass` not in the registry causes `DeployEndEventSchema.parse` to throw.
- `.github/workflows/contract-tests.yml` — CI runs on PR open + push to `develop`.
- `fetchServiceMetrics` now handles 204 No Content → `null` (no synthetic fallback).
- `useServiceMetrics` exposes `isEmpty: boolean` flag.

---

## ⚠️ Breaking Change: SSE Endpoint Removed

**The legacy project-keyed deploy timeline stream is removed:**

```
REMOVED: GET /api/projects/:id/build/stream
```

Any external observability dashboard, CI tool, or operator script that
subscribed to this endpoint must migrate to the deployment-keyed endpoint:

```
CURRENT: GET /api/deployments/:id/log/stream
```

The `id` in the new endpoint is a **deployment ID**, not a project ID.
Obtain the current deployment ID from `GET /api/projects/:id/deployments`
(returns the list; the most recent entry is the running deploy).

This change is permanent (ADR-1.1 revised — single SSE renderer). There
will be no compatibility shim.

---

## Upgrade Notes

- No migration steps required for end-users of the OpenLander web UI.
- If you have automation calling `/api/projects/:id/build/stream`, migrate
  to `/api/deployments/:id/log/stream` before upgrading.
- i18n: merge `web/src/i18n/PATCH-V4-CONSOLIDATED.md` into your
  `en.ts` / `ko.ts` files to pick up all new copy keys.

---

## v4 Deviations from Source Design

See `.omc/plans/v4-deviations.md` for the full list of documented
intentional deviations with rationale.
