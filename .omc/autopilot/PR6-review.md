# Code Review — PR6: Backend wire-up

**Files Reviewed:** 14 (8 new, 6 modified)
**Total Issues:** 11
**Verdict:** **APPROVE** (with minor follow-ups; no CRITICAL/HIGH blockers)

## By Severity

- CRITICAL: 0
- HIGH: 0
- MEDIUM: 4
- LOW: 5
- NIT: 2

The three Codex/Gemini-flagged bugs (SSE reconnect-stuck, deploymentId swap race, mock kill-switch) are all genuinely fixed — see verification notes in §1 below. The hook-shape contract holds, mock fallback semantics are correct, and the rules-of-hooks layout in `ServiceDetailV2` is stable across the early-return.

---

## §1 — Codex CCG bugs: re-validation

### Bug A — SSE reconnect stuck-state — FIXED

`use-deploy-log-stream.ts:147-150`. The previous `firstLineSeen` single-shot is gone. Any non-terminal `data:` event now flips `connState` out of `CONNECTING`/`RECONNECTING`/`BACKFILLING` via `setConnState((cur) => (isTerminal(cur) ? cur : 'LIVE'))`. The terminal-state guard (`isTerminal`) prevents stomping on `ENDED`/`CANCELLED`/`ERRORED` if a late event arrives after close. Correct.

### Bug B — deploymentId swap race — FIXED

`use-deploy-log-stream.ts:114-122,169,184-187`. The `sessionRef.current += 1; const session = sessionRef.current;` capture-then-compare pattern is canonical and correct. Cleanup nulls `es.onmessage` and `es.onerror` BEFORE `es.close()`, which is the right order: it drops any in-flight dispatched events that may already be queued on the microtask queue. The dual defense (session check + handler null) is belt-and-suspenders but cheap.

### Bug C — mock kill-switch not stopping timers — FIXED

`use-mock-log-stream.ts:101-118,148-160,191-201`. The `ActiveSimRefs` struct holds `active: boolean`, a `Set<timeout>`, and the progress interval. `kill()` flips `active=false`, clears every pending timeout, and clears the progress interval. The `schedule()` wrapper checks `sim.active` before invoking `fn()` so even a setTimeout that fired between `kill()` and the clear loop will no-op. Correct.

---

## §2 — Findings

### [MEDIUM] `use-deploy-log-stream.ts:159-165` — `setProgressByLineNum` called inside `setLines` updater

```ts
setLines((prev) => {
  const next = [...prev, entry];
  if (entry.payload === '{progress}' && entry.progress) {
    setProgressByLineNum((tp) => ({ ...tp, [next.length]: 1 }));
  }
  return next;
});
```

Calling `setProgressByLineNum` inside another updater function is a known React anti-pattern. In Strict Mode, React intentionally double-invokes updaters to surface side-effect bugs — meaning `setProgressByLineNum` will fire twice per progress entry on dev builds. Functionally idempotent here (the `[next.length]: 1` write is the same both times), so no user-visible bug, but it'll trip the ESLint `react/no-set-state-in-set-state-callback` rule if it's ever enabled and trips React DevTools warnings.

**Fix:** Read `prev.length + 1` outside the updater and call `setProgressByLineNum` after the line append:

```ts
const newLineNum = lines.length + 1; // captured at message time
setLines((prev) => [...prev, entry]);
if (entry.payload === '{progress}' && entry.progress) {
  setProgressByLineNum((tp) => ({ ...tp, [newLineNum]: 1 }));
}
```

The mock hook's equivalent (line 145-159) has the same issue but is grandfathered from the previous in-component simulator — same fix applies.

### [MEDIUM] `use-deploy-log-stream.ts:121-150` — Synthetic `progress` payload conflict

The hook treats `{progress}` payload markers as completed-progress lines (sets bar to 1.0). This is fine for mocks, but the SSE backend contract says `progress` is `LogEntry['progress']` (an actual number). If the backend ever sends `{ payload: '{progress}', progress: 0.5 }` because someone copy-pasted the mock format, the bar will jump straight to 1.0 instead of animating. Not a current bug — backend doesn't drip percent — but the magic-string coupling between the LogViewer's `LogPayload` renderer (which interprets `{progress}` as a placeholder) and this hook is fragile.

**Fix (deferrable to PR7):** Either (a) drop the auto-1.0 marker entirely on SSE — backends should send a real `progress` field — or (b) document the contract explicitly. Prefer (a): SSE never produced `{progress}` markers in the first place; this branch is effectively dead.

### [MEDIUM] `ServiceDetailV2.tsx:93` — `useServiceHealth` argument paradox

```ts
const liveHealth = useServiceHealth(service ? (id ?? null) : null);
```

`service` is derived from `services.find((s) => s.id === id)`. If `id` is undefined the find returns `undefined`, so `service` is falsy and the hook gets `null` (correct). If `id` is defined and `service` is also defined, then `service ? id ?? null` simplifies to `id`. The `?? null` is dead — `id` from `useParams` is `string | undefined`, but if `service` exists then `service.id === id` proved `id` is a defined string.

More importantly: until `useProjectTopology` returns real data, `service` resolves from the **mock fallback** topology. The health hook then fires for whatever id the user typed in the URL. If that id doesn't exist on the backend (e.g. the mock has it, the backend doesn't), every poll returns 500 and the user sees a stale `error` string with no UI surfacing. Currently `liveHealth.error` is read but never displayed.

**Fix:** Surface `liveHealth.error` somewhere (e.g. greyed-out pill, or fall through to `service.health` silently which is what `effectiveHealth ?? service?.health` already does — so technically the UX is fine, just noisy in console.warn). Lower priority: simplify the argument to `useServiceHealth(service ? id! : null)` or just `useServiceHealth(id ?? null)` since the disabled-when-null short-circuit already covers it.

### [MEDIUM] `use-mock-log-stream.ts:144-162` — `idxRef` race in progress branch

```ts
if (entry.payload === '{progress}') {
  setLines((prev) => [...prev, entry]);
  const lineNum = idxRef.current;  // already incremented to i+1 on line 139
  ...
  setProgressByLineNum((tp) => ({ ...tp, [lineNum]: p }));
```

`lineNum` reads `idxRef.current` AFTER the `i + 1` increment on line 139, so it equals the new line number — looks correct. But if a future change ever moves the `idxRef.current = i + 1` line, this silently breaks. The non-mock SSE hook computes `next.length` inside the updater for the same purpose, which is also fragile (see previous finding). They should align on one approach. Suggest naming `lineNum` more explicitly: `const nextLineNum = i + 1;` directly.

### [LOW] `use-project-topology.ts:42-57` — Disabled state still sets `isLoading=false`

```ts
const fetcher = useCallback(async () => {
  if (!projectId) {
    setIsLoading(false);
    return;
  }
  ...
}, [projectId]);
```

When `projectId` is null, `usePollingTask` is disabled (`enabled: false`), so this fetcher is never invoked from polling. But a consumer could still call the returned `refetch()`. Setting `isLoading=false` in that case is a no-op since initial state is already `true` and there's never been a fetch. Not a bug — just dead code on the disabled branch.

### [LOW] `use-service-health.ts:32-46` — Same disabled-branch dead code as above.

### [LOW] `use-service-metrics.ts:42-56` — Same pattern; consumer-driven `range` change triggers a re-fetch via `useCallback` dep, but if `serviceId` is null we leave `metrics=null` and `isLoading=true` permanently because `setIsLoading(false)` runs only inside the disabled-no-op branch. That's actually fine behaviorally (consumer renders fallback), but visually misleading if any consumer renders a spinner on `isLoading`. None do today.

### [LOW] `use-deploy-log-stream.ts:86-95` — Disabled branch leaks last `lines` state

When `deploymentId` becomes `null`, the effect resets refs but does NOT clear `lines`/`progressByLineNum`/`connState`. The comment correctly notes "LogViewer reads the OTHER stream when this one is dormant, so stale state is invisible." This is fine — but if a future caller ever conditionally renders just `sseStream.lines` independent of `useReal`, they'll see ghost data. Mark this contract more loudly in the JSDoc and/or expose a sentinel like `enabled: boolean` in the result.

### [LOW] `LogViewer.tsx:174-176` — `setViewState('FOLLOWING')` on every `mockMode`/`deploymentId` change is a setState-in-effect

```ts
useEffect(() => {
  setViewState('FOLLOWING');
}, [deploymentId, mockMode]);
```

Same eslint pattern the SSE/mock hooks justify with comments — but this one has no escape-hatch comment and isn't followed by an external sync. Functionally desired (FOLLOWING reset on stream switch), but the lint rule will flag it if/when the surrounding files get the rule enabled. Add a comment, or derive `viewState` from a key.

### [LOW] `notifications.ts:31` — `res.json()` typed as `Promise<NotificationWebhookConfig | null>` without runtime validation

```ts
return res.json(); // returned as NotificationWebhookConfig
```

`response.json()` returns `any` — TS infers the return type from the function signature, not the actual payload. If the backend ever returns `{ url: 123, events: 'foo' }` the entire UI breaks at the form-input layer. Since this is one of five new endpoint clients and the backend isn't shipped yet, a quick zod / typia pass on the boundary would future-proof the contract. Acceptable for 1.0 scope.

### [NIT] `LogViewer.tsx:323` — `useMemo` dependency on `stream` (entire object)

```ts
const liveDur = useMemo(() => {
  if (lines.length === 0) return '0s';
  const s = stream.getElapsedSec();
  ...
}, [lines.length, stream]);
```

`stream` is recomputed on every render (`const stream = useReal ? sseStream : mockStream`), so this `useMemo` recomputes every render too. The intent is clearly "recompute when lines change" — should be `[lines.length, stream.getElapsedSec]` or just inline the computation. Cosmetic.

### [NIT] `Notifications.tsx:101` — Disabled-while-loading masks empty URL

```ts
const canSave = url.trim().length > 0 && !isSaving && !isLoadingExisting;
```

If GET hangs (slow backend), the user can't type-and-save until the GET resolves. `isLoadingExisting` blocks both the input AND the save. Acceptable per the comment; just note that GET 404 is fast (immediate disambiguation) but a transient timeout could leave the user staring at a disabled form. A 5-10s timeout on the initial GET would close this gap.

---

## §3 — Specifically requested checks

### (1) SSE hook correctness

3 prior bugs verified fixed. No new ones found. Memory: handlers nulled before close, `sourceRef` guarded. Sound.

### (2) Hook return shape consistency

`useDeployLogStream` and `useMockLogStream` produce equivalent shapes for what the LogViewer reads:

- `lines, progressByLineNum, connState, buildOutcome, errorClass, getElapsedSec, kill` — all present in both.
- `useDeployLogStream` adds `lastEventId` (extra; harmless).
- The runtime `stream = useReal ? sseStream : mockStream` works correctly because TypeScript widens to the intersection of the result interfaces; LogViewer only reads the common subset. **Confirmed correct.**

### (3) Memory leaks

- EventSource: closed in cleanup AND on terminal events AND on `kill()`. No leak.
- setTimeout/setInterval (mock): tracked in `Set<>`, cleared in cleanup AND `kill()`. No leak.
- visibilitychange listener (`use-polling-task.ts:81`): properly removed in cleanup.
- Sonner toast: managed by sonner library — fine.

### (4) Mock fallback semantics

- Topology: keeps last-good (`services` state ratchet, only the resolved getter falls through to `getServices()` when `services == null`). Correct per CCG decision.
- Metrics: hook returns `null`, MonitoringTab falls through to `deterministicSeries` via `??`. Correct.
- Notifications GET 404 → `null` → form keeps DEFAULT_EVENTS. Correct.

### (5) TypeScript correctness

No `any` casts in new code. `apiGet<{ health: ServiceHealth }>` is a sound declaration. The `service ? (id ?? null) : null` ternary in ServiceDetailV2 is over-defensive but type-correct. No optional-chaining traps observed.

### (6) ServiceDetailV2 hook ordering

```
useState (3 lines: tab, openDeployId, ...) →
useParams/useSearchParams/useNavigate →
useProjectTopology →
useServiceHealth →
useMemo(tabs) →
[early return for !service || !project]
```

**Confirmed stable.** All hooks fire BEFORE the early return, so React's hook-call-count is invariant across mount cycles. The conditional argument to `useServiceHealth` (`service ? id : null`) does not violate rules-of-hooks — it varies the _argument_, not the call site.

### (7) CCG-mandated UX

- **Demo Mode eyebrow**: `InfraMap.tsx:91-100,387` — `DemoEyebrowChip` renders when `isDemo`. `ProjectViewV2.tsx:92` passes `isDemo={isMockFallback}` from the topology hook. **Wired correctly.**
- **Save isSaving state**: `Notifications.tsx:48,86-99,101,177-178` — Loader2 spinner + "Saving…" label + canSave guard. **Wired correctly.**
- **errorClass priority**: `LogViewer.tsx:210` — `const resolvedErrorClass = stream.errorClass ?? errorClass;` SSE-derived overrides prop. In mock mode `stream.errorClass` is `undefined` so prop wins. **Wired correctly.**

### (8) Scope creep / dead code

- MOCK_FLEET_SERVICES deletion confirmed (`projectTopology.ts:250-254` carries an explanatory comment). Good broken-window cleanup.
- No new abstractions outside the stated scope.
- `MOCK_DEPLOYMENTS` still drives DeploymentsTab — explicitly deferred to PR7 per the JSDoc on `LogViewerProps.mockMode`. Fine.
- No commented-out code, no dead imports.

---

## §4 — Positive Observations

- The session-id + handler-nulling defense in `use-deploy-log-stream.ts` is textbook correct concurrency hygiene.
- `useProjectTopology`'s "keep last-good on transient error" pattern is exactly right and well-documented inline.
- Splitting the mock and SSE simulators into separate hooks (instead of one branchy hook) is cleaner than the monolithic alternative — much easier to reason about each one in isolation.
- The eslint escape-hatch comments in both stream hooks (lines 103-110 SSE, 79-84 mock) explain WHY the rule is suspended and what the external sync is. This is the right way to use lint exemptions.
- `MetricsRange` typed as a string-literal union with `as const` arrays at usage sites is type-safe and ergonomic.
- The comment on `MetricCard` "BIG number stays topology display string to avoid NaN/0 flicker" (ServiceDetailV2.tsx:451-456) shows mature thinking about loading-state edge cases.

---

## §5 — Recommendation

**APPROVE**

PR6 ships a clean wire-up. Three CCG-flagged bugs are properly fixed (verified by code-reading, not just unit assertion). The mock-fallback graceful-degradation strategy works offline and pre-backend. Hook shape contract and rules-of-hooks ordering are sound.

The 4 MEDIUM findings are **non-blocking polish** for PR7 / a follow-up:

1. `setProgressByLineNum` inside `setLines` updater (deploy + mock streams) — Strict Mode hygiene.
2. `{progress}` magic-string coupling between SSE and mock — document or remove.
3. `useServiceHealth` argument simplification + error surfacing — minor.
4. Mock simulator `lineNum` naming clarity — refactor.

The 5 LOW + 2 NIT findings are stylistic and can be addressed opportunistically.

No CRITICAL or HIGH issues. Ship it. Park the MEDIUMs in a PR7 follow-up checklist.
