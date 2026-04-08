# Operations Center Settings QA Report

**Date**: 2026-04-08
**Target**: `http://100.75.249.124:10114` (OpenLander production)
**Method**: API-level testing (`PUT/GET /api/ops/config`, `/api/ops/circuit-breaker/*`)
**Auth**: Bearer token

---

## Summary

| #   | Test                           | Result   | Notes                                                                   |
| --- | ------------------------------ | -------- | ----------------------------------------------------------------------- |
| A1  | `enabled` toggle               | **PASS** | ON→OFF→ON verified via PUT+GET                                          |
| A2  | `auto_restart` toggle          | **FAIL** | PUT returns `true` despite sending `false` — BUG-1                      |
| A3  | `auto_cleanup` toggle          | **PASS** | ON→OFF→ON verified via PUT+GET                                          |
| A4  | `drift_detection` toggle       | **PASS** | ON→OFF→ON verified via PUT+GET                                          |
| B5  | `disk_cleanup_percent`         | **PASS** | 80→90→80 verified                                                       |
| B6  | `recovery_max_per_day`         | **PASS** | 5→3→5 verified (config level only; see BUG-4)                           |
| B7  | `alert_dedup_minutes`          | **PASS** | 15→30→15 verified                                                       |
| C8  | `digest_time`                  | **PASS** | 09:00→18:00→09:00 verified                                              |
| F16 | Circuit breaker state query    | **PASS** | `/circuit-breakers` returns 43 entries                                  |
| F17 | Circuit breaker reset          | **PASS** | Idempotent reset on non-existent project                                |
| G18 | Crash recovery loop prevention | **FAIL** | Recovery runs 2 cycles then stops; CB never opens — BUG-3, BUG-4, BUG-5 |

**Overall: 8 PASS / 2 FAIL / 0 PARTIAL out of 11 tests.**

---

## A. Global Toggles

### A1. `enabled` — PASS

```
BEFORE:  enabled=True
SET OFF: enabled=False   → PUT response confirmed False
GET:     enabled=False   → Read-back confirmed
RESTORE: enabled=True    → Restored successfully
```

### A2. `auto_restart` — FAIL (BUG-1)

```
BEFORE:  auto_restart=True
SET OFF: auto_restart=True   ← Expected False!
GET:     auto_restart=True   ← Still True
```

**Root Cause**: Shallow merge bug in `OpsAgent.reloadConfig()`. See BUG-1 below.

### A3. `auto_cleanup` — PASS

```
SET OFF: auto_cleanup=False  → Confirmed
GET:     auto_cleanup=False  → Confirmed
RESTORE: auto_cleanup=True   → Confirmed
```

### A4. `drift_detection` — PASS

```
SET OFF: drift_detection=False  → Confirmed
GET:     drift_detection=False  → Confirmed
RESTORE: drift_detection=True   → Confirmed
```

---

## B. Thresholds

### B5. `disk_cleanup_percent` — PASS

```
SET 90:  disk_cleanup_percent=90  → PUT confirmed
GET:     90                       → Read-back confirmed
RESTORE: 80                       → Confirmed
```

### B6. `recovery_max_per_day` — PASS (config level only)

```
SET 3:   recovery_max_per_day=3   → PUT confirmed
GET:     3                        → Read-back confirmed
RESTORE: 5                        → Confirmed
```

**Note**: Value persists correctly, but has no effect on circuit breaker threshold. See BUG-4.

### B7. `alert_dedup_minutes` — PASS

```
SET 30:  alert_dedup_minutes=30   → PUT confirmed
GET:     30                       → Read-back confirmed
RESTORE: 15                       → Confirmed
```

---

## C. Digest

### C8. `digest_time` — PASS

```
SET 18:00: digest_time=18:00  → PUT confirmed
GET:       18:00               → Read-back confirmed
RESTORE:   09:00               → Confirmed
```

**Bonus**: `POST /api/ops/digest/trigger` returns `{"triggered":true}` — PASS.

---

## F. Circuit Breaker

### F16. State Query — PASS

- `GET /api/ops/circuit-breakers` returned 43 circuit breaker entries
- All in `closed` state at time of test
- Response includes: `projectId`, `projectName`, `state`, `failureCount`, `lastFailureAt`, `openedAt`, `resetAt`

### F16b. Per-project Query — PASS

- `GET /api/ops/circuit-breaker/non-existent-project` returns `{}` (empty, no error)
- Graceful handling of unknown project IDs

### F17. Circuit Breaker Reset — PASS

- `POST /api/ops/circuit-breaker/non-existent-project/reset` returns `{"reset":true}`
- Idempotent — reset on non-existent project succeeds silently

---

## G. Crash Recovery Loop Prevention — FAIL

### Test Setup (Retest with full auto)

- ALL automation steps set to `auto` (restart, diagnosis, apply_fixes, rollback)
- `recovery_max_per_day` set to 3
- Deployed `https://github.com/openlander-ai/test-runtime-crash` as `test-crash-qa2`
- Project ID: `Aj6xC7bt6lVO`
- Monitored for 5+ minutes

### Timeline

```
10:47:13  Deploy started (status: building)
10:47:16  Build complete (status: running)
10:47:49  Crash detected (status: error)
10:47:52  2 incidents created, CB failure_count=0
10:48:49  CB failure_count increased to 2, state=closed
10:53:04  Timeout — CB still closed at fc=2, never opened
```

### Detailed Observations

1. **Crash detection**: PASS — `running` → `error` in ~33s
2. **Recovery triggered**: PASS — 2 recovery cycles executed (2 incidents)
3. **Incident creation**: PASS — 2 critical incidents with root cause "Health check failed after restart (3 attempts over 90 seconds)"
4. **CB increment**: PASS — failure_count went from 0 → 2
5. **CB open**: **FAIL** — CB never opened despite `recovery_max_per_day=3`
6. **AI invocation**: **FAIL** — 0 new AI calls during test (LLM provider misconfigured)

### Root Cause Analysis (3 blocking issues)

#### Issue 1: LLM provider misconfigured (BUG-3)

```json
// config.ai.autoRecovery
{ "providerId": "test-anthropic", "model": "claude-sonnet-4-6" }
```

Provider `test-anthropic` does NOT exist in the registered providers list. `generateDiagnosis()` silently catches the error and returns `null`. No AI usage recorded.

Working provider on this server: `zai-coding` / `glm-5`.

#### Issue 2: CB threshold disconnected from config (BUG-4)

```typescript
// src/monitor/ops-recovery.ts line 18
const RECOVERY_MAX_FAILURES = 5; // HARDCODED!

// Used at line 554:
if (state.failure_count >= RECOVERY_MAX_FAILURES) {
  this.ctx.db.openCircuitBreaker(projectId);
}
```

The circuit breaker opens at **5 failures (hardcoded)**, NOT at `recovery_max_per_day` from config. The config setting `recovery_max_per_day` is stored/retrieved correctly but has **no effect** on when the CB opens.

#### Issue 3: `incident_active` blocks 3rd recovery (BUG-5)

```
Cycle 1: crash → eligibility PASS → recovery → fails → incident #1 escalated → CB fc=1
Cycle 2: crash → eligibility PASS (incident #1 escalated) → recovery → fails → incident #2 open → CB fc=2
Cycle 3: crash → eligibility CHECK → getActiveOpsIncident() → incident #2 is OPEN → BLOCKED!
```

`RecoveryCoordinator.checkEligibility()` line 170:

```typescript
if (this.db.getActiveOpsIncident(projectId)) {
  return { eligible: false, reason: 'incident_active' };
}
```

The second incident stays `open`, permanently blocking further recovery attempts. CB can never reach 5 (or even 3).

### Additional Finding: Ops Center UI WebSocket disconnection

The API `GET /api/ops/activity` returns data (10 items), but the Operations Center UI shows:

- "연결 끊김" (Disconnected)
- "최근 활동이 없습니다" (No recent activity)

This is a separate frontend bug where the WebSocket/SSE connection for the activity feed is broken.

---

## Bugs Found

### BUG-1: `auto_restart` toggle doesn't persist (A2) — Medium

**Location**: `src/monitor/ops-agent.ts` — `reloadConfig()`
**Symptom**: Setting `auto_restart: false` via `PUT /api/ops/config` has no effect
**Root Cause**: Shallow merge + legacy conversion. `auto_restart` is mapped to `recovery.automation.restart` internally, but the reverse mapping for the response path doesn't exist.
**Fix**: Deep merge in `reloadConfig()`, or bidirectional mapping for `auto_restart` ↔ `recovery.automation.restart`.

### BUG-2: Deploy API ignores `cmd` parameter — Low

**Location**: `src/web/api/project-routes.ts` or deploy pipeline
**Symptom**: `cmd: ["sh", "-c", "exit 1"]` in deploy request body is silently ignored
**Impact**: Cannot deploy crash-on-start containers via image deploy for testing.

### BUG-3: `autoRecovery.providerId` references nonexistent provider — High

**Location**: `~/.openlander/config.json` → `ai.autoRecovery.providerId`
**Value**: `"test-anthropic"` — not in providers list
**Impact**: ALL AI-powered recovery diagnosis silently fails. `generateDiagnosis()` catches the error and returns null. No AI usage is ever recorded for recovery.
**Fix**: Set `providerId` to an existing provider (e.g., the server's default `zai-coding`).

### BUG-4: `recovery_max_per_day` config disconnected from CB threshold — High

**Location**: `src/monitor/ops-recovery.ts` line 18
**Symptom**: `RECOVERY_MAX_FAILURES = 5` is hardcoded. The config value `thresholds.recovery_max_per_day` is stored and returned by the API but never read by the circuit breaker logic.
**Impact**: Users cannot control the CB threshold via Settings. The UI gives the illusion of configurability.
**Fix**: Replace `RECOVERY_MAX_FAILURES` constant with dynamic config read from `thresholds.recovery_max_per_day`.

### BUG-5: `incident_active` check prevents CB from ever opening — High

**Location**: `src/monitor/recovery-coordinator.ts` line 170
**Symptom**: After a recovery cycle escalates, a new recovery creates a second incident that stays `open`. The third recovery attempt is blocked by the `incident_active` eligibility check.
**Impact**: Circuit breaker can never accumulate enough failures to open. Recovery loop prevention is effectively broken.
**Fix**: Either (a) resolve the incident after escalation so the next recovery can proceed, or (b) don't check `incident_active` when the purpose is to increment the CB, or (c) increment the CB from the health monitor (outside the recovery pipeline).

---

## Config Baseline (captured before tests)

```json
{
  "enabled": true,
  "auto_restart": true,
  "auto_cleanup": true,
  "drift_detection": true,
  "recovery": {
    "enabled": true,
    "automation": {
      "restart": "auto",
      "diagnosis": "auto",
      "apply_fixes": "confirm",
      "rollback": "confirm"
    }
  },
  "thresholds": {
    "disk_cleanup_percent": 80,
    "recovery_max_per_day": 5,
    "alert_dedup_minutes": 15,
    "digest_time": "09:00"
  }
}
```

All settings restored to baseline after testing. Test project `test-crash-qa2` (Aj6xC7bt6lVO) left in place for manual inspection.
