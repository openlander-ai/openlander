# Operations Center Settings QA Report

**Date**: 2026-04-08
**Target**: `http://100.75.249.124:10114` (OpenLander production)
**Method**: API-level testing + Playwright screenshot verification
**Auth**: Bearer token

---

## Summary

| #   | Test                           | Result   | Notes                                             |
| --- | ------------------------------ | -------- | ------------------------------------------------- |
| A1  | `enabled` toggle               | **PASS** | ON→OFF→ON verified via PUT+GET                    |
| A2  | `auto_restart` toggle          | **PASS** | Fixed: shallow merge → sync with recovery.enabled |
| A3  | `auto_cleanup` toggle          | **PASS** | ON→OFF→ON verified via PUT+GET                    |
| A4  | `drift_detection` toggle       | **PASS** | ON→OFF→ON verified via PUT+GET                    |
| B5  | `disk_cleanup_percent`         | **PASS** | 80→90→80 verified                                 |
| B6  | `recovery_max_per_day`         | **PASS** | 5→3→5 verified, connected to CB threshold         |
| B7  | `alert_dedup_minutes`          | **PASS** | 15→30→15 verified                                 |
| C8  | `digest_time`                  | **PASS** | 09:00→18:00→09:00 verified                        |
| F16 | Circuit breaker state query    | **PASS** | `/circuit-breakers` returns entries               |
| F17 | Circuit breaker reset          | **PASS** | Idempotent reset on non-existent project          |
| G18 | Crash recovery loop prevention | **PASS** | fc=1→2→3 → CB open (8 min, threshold=3)           |

**Overall: 11 PASS / 0 FAIL out of 11 tests.**

---

## A. Global Toggles

### A1. `enabled` — PASS

```
SET OFF: enabled=False → PUT+GET confirmed
RESTORE: enabled=True  → Confirmed
```

### A2. `auto_restart` — PASS (fixed)

Initially FAIL — shallow merge in `OpsAgent.reloadConfig()`. Fixed by syncing `auto_restart` with `recovery.enabled` after merge.

### A3. `auto_cleanup` — PASS

### A4. `drift_detection` — PASS

---

## B. Thresholds

### B5. `disk_cleanup_percent` — PASS (80→90→80)

### B6. `recovery_max_per_day` — PASS (5→3→5, now connected to CB threshold)

### B7. `alert_dedup_minutes` — PASS (15→30→15)

---

## C. Digest

### C8. `digest_time` — PASS (09:00→18:00→09:00)

---

## F. Circuit Breaker

### F16. State Query — PASS

### F17. Circuit Breaker Reset — PASS

---

## G. Crash Recovery Loop Prevention — PASS

### Test Setup

- `recovery_max_per_day=3`, all automation set to `auto`
- Deployed `test-runtime-crash` (Node.js crash-loop app)
- Project ID: `Ysnf1Fv0MsgU`

### Timeline

```
16:52:17  Deploy → running
16:52:23  Crash detected → error
16:53:14  Recovery #1 fails → CB fc=1
16:53:17  Recovery #2 fails → CB fc=2
16:58:35  Recovery #3 fails → CB fc=3 → CB OPEN
```

### Verified via Playwright screenshot

Operations Center shows 3 projects with **"Recovery Paused — Auto-recovery paused after 3 consecutive failures"**.

---

## Bugs Found & Fixed

### BUG-1: `auto_restart` toggle — FIXED

**Commit**: `80008f9`
**Root cause**: `OpsAgent.reloadConfig()` shallow merge didn't sync `auto_restart` with `recovery.enabled`.
**Fix**: Added `this.config.auto_restart = this.config.recovery.enabled` after merge.

### BUG-2: Deploy API ignores `cmd` parameter — NOT FIXED (Low priority)

### BUG-3: `autoRecovery.providerId` references nonexistent provider — FIXED

**Commit**: `4166aaf`
**Root cause**: Config had `test-anthropic` but only `zai-coding` existed.
**Fix**: Added fallback to `this.ctx.model` (default LLM) when configured provider not found.

### BUG-4: `recovery_max_per_day` disconnected from CB threshold — FIXED

**Commit**: `4166aaf`
**Root cause**: Hardcoded `RECOVERY_MAX_FAILURES = 5`. Config value never read.
**Fix**: Read `config.thresholds.recovery_max_per_day` dynamically, fallback to 5.

### BUG-5: Recovery loop deadlock (multiple root causes) — FIXED

**5a. `incident_active` eligibility check blocks recovery**
**Commit**: `2bd1a79`
Concurrent crash events leave an incident `open`, blocking all future recovery.
**Fix**: Removed `incident_active` check entirely. `activeRecoveries` Set + CB handle protection.

**5b. HealthMonitor only checked `running` projects**
**Commit**: `7ffc9df`
After recovery failure (status=`error`), health monitor stopped checking the project.
**Fix**: Monitor both `running` and `error` projects. Three changes in `health.ts`.

**5c. OpsAgent rejected `error`-state projects**
**Commit**: `80008f9`
`handleCrashEvent` only accepted `status === 'running'`.
**Fix**: Accept both `running` and `error`.

**5d. Recovery pipeline errors left orphan open incidents**
**Commit**: `97b5dc7`
If `recovery.execute()` threw, incident stayed `open` permanently.
**Fix**: Wrap in try/catch, escalate incident on error.

**5e. CB reset on brief healthy period**
**Commit**: `c5ce247`
Flapping services (crash → brief healthy → crash) kept resetting CB to 0.
**Fix**: Stability window — CB only resets after 5 minutes of sustained healthy state. Reset moved from `RecoveryPipeline` to `HealthMonitor`.

### BUG-6: Recovery strategy label "알 수 없는 전략" — FIXED

**Commits**: `4166aaf`, `6ec35a3`
**Root cause**: `recoveryStrategy: 'unknown'` hardcoded at action_run creation. Frontend showed "Unknown strategy".
**Fix**:

- Backend: Default to `'recipe'`, update to `'llm'` when LLM diagnosis invoked
- Frontend: Hide strategy line when `null`/`unknown`, unify display across ApprovalQueue + ApprovalDialog

### BUG-7: Approval cards lack context — FIXED

**Commit**: `a2f5f5a`
Cards showed generic labels without failure reason or diagnosis.
**Fix**: `gateStep()` now saves failure context to action_run `plan` field before awaiting approval.

### BUG-8: Operations page empty flash on load — FIXED

**Commit**: `990f67b`
No loading state — page showed empty grid for ~1s.
**Fix**: Skeleton placeholders while projects loading.

---

## Architecture Improvements Made

### Stability Window (CB Reset)

```
Before: restart → 1s healthy → CB RESET → crash → repeat forever
After:  restart → healthy → wait 5 min → still healthy → CB reset
```

Prevents flapping services from resetting the circuit breaker.

### Recovery Flow (after all fixes)

```
crash → HealthMonitor detects (running OR error)
      → RecoveryCoordinator eligibility (no incident_active check)
      → OpsAgent processes (running OR error accepted)
      → RecoveryPipeline executes (activeRecoveries prevents dup)
      → Success: resolved, CB not reset (wait 5min stability)
      → Failure: escalated, CB fc++
      → fc >= threshold → CB OPEN → recovery stops
```

---

## Config Baseline

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
