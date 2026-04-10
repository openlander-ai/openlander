# codex advisor artifact

- Provider: codex
- Exit code: 0
- Created at: 2026-04-09T11:15:16.441Z

## Original task

Review commit 79b48ae on OpenLander develop branch. Run: git show 79b48ae --stat && git diff 79b48ae^..79b48ae to see the changes. This commit unifies recovery automation policy with the approval gate. Focus on: 1) src/pipeline/auto-recovery.ts — TOOL_TO_RECOVERY_STEP mapping correctness, 2-step approval gate logic (policy check → DecisionEngine fallback), policySnapshot caching at session start 2) src/monitor/ops-agent.ts — reloadConfig deep merge fix for recovery.automation 3) src/events/index.ts — recovery:approval-auto-skipped event type 4) src/app.ts — getAutomationPolicy callback wiring 5) test/pipeline/auto-recovery.test.ts — test coverage for auto/confirm/null/unmapped scenarios 6) test/web/api/ops-routes.test.ts — API round-trip tests. Report as CRITICAL/MAJOR/MINOR.

## Final prompt

Review commit 79b48ae on OpenLander develop branch. Run: git show 79b48ae --stat && git diff 79b48ae^..79b48ae to see the changes. This commit unifies recovery automation policy with the approval gate. Focus on: 1) src/pipeline/auto-recovery.ts — TOOL_TO_RECOVERY_STEP mapping correctness, 2-step approval gate logic (policy check → DecisionEngine fallback), policySnapshot caching at session start 2) src/monitor/ops-agent.ts — reloadConfig deep merge fix for recovery.automation 3) src/events/index.ts — recovery:approval-auto-skipped event type 4) src/app.ts — getAutomationPolicy callback wiring 5) test/pipeline/auto-recovery.test.ts — test coverage for auto/confirm/null/unmapped scenarios 6) test/web/api/ops-routes.test.ts — API round-trip tests. Report as CRITICAL/MAJOR/MINOR.

## Raw output

```text
**CRITICAL**

No critical findings.

**MAJOR**

1. [src/app.ts:404](/home/lee/OpenLander/src/app.ts#L404) wires `getAutomationPolicy` to the bootstrap `config.ops`, not the live OpsAgent config. `/api/ops/config` updates `ctx.opsAgent` via `reloadConfig()` and persists to disk with `updateConfig()`, but it does not mutate `ctx.config` in memory ([src/web/api/ops-routes.ts:198](/home/lee/OpenLander/src/web/api/ops-routes.ts#L198), [src/config/index.ts:452](/home/lee/OpenLander/src/config/index.ts#L452)). The result is that recovery sessions will keep using stale global automation policy until process restart, while project overrides update immediately from DB. That breaks the “applied immediately” behavior this commit is trying to add for approval policy.

2. [src/pipeline/auto-recovery.ts:36](/home/lee/OpenLander/src/pipeline/auto-recovery.ts#L36) now lets `rollback=auto` bypass approval for `remove_volume`, but the tool itself is still declared `riskLevel: 'medium'` and is explicitly permanent data deletion ([src/tools/defs/volume.ts:226](/home/lee/OpenLander/src/tools/defs/volume.ts#L226)). This commit also hardens that assumption in the exhaustive mapping test ([test/pipeline/auto-recovery.test.ts:779](/home/lee/OpenLander/test/pipeline/auto-recovery.test.ts#L779)). If `ToolDef.riskLevel` is the intended source of truth, this change widens auto-approved destructive behavior in recovery and cements a policy mismatch instead of fixing it.

**MINOR**

1. [test/web/api/ops-routes.test.ts:36](/home/lee/OpenLander/test/web/api/ops-routes.test.ts#L36) only round-trips project override endpoints against a stubbed `opsAgent.getConfig()` that always returns defaults. It does not cover the introduced live-config path (`PUT /api/ops/config` -> recovery policy readback), so the stale global-policy bug above would not be caught.

2. [test/pipeline/auto-recovery.test.ts:779](/home/lee/OpenLander/test/pipeline/auto-recovery.test.ts#L779) hardcodes the “high risk” tool list instead of deriving it from the approval classifier. That means a future change to `DecisionEngine` can silently drift from `TOOL_TO_RECOVERY_STEP` again while this test still passes.

Assumption: I’m treating runtime ops config changes as intended to take effect without restart, based on the new reload/deep-merge work and the UI copy added in this commit.


Reading additional input from stdin...
OpenAI Codex v0.118.0 (research preview)
--------
workdir: /home/lee/OpenLander
model: gpt-5.4
provider: openai
approval: never
sandbox: danger-full-access
reasoning effort: none
reasoning summaries: none
session id: 019d71f2-510a-7f30-8632-4563ee1f7298
--------
user
Review commit 79b48ae on OpenLander develop branch. Run: git show 79b48ae --stat && git diff 79b48ae^..79b48ae to see the changes. This commit unifies recovery automation policy with the approval gate. Focus on: 1) src/pipeline/auto-recovery.ts — TOOL_TO_RECOVERY_STEP mapping correctness, 2-step approval gate logic (policy check → DecisionEngine fallback), policySnapshot caching at session start 2) src/monitor/ops-agent.ts — reloadConfig deep merge fix for recovery.automation 3) src/events/index.ts — recovery:approval-auto-skipped event type 4) src/app.ts — getAutomationPolicy callback wiring 5) test/pipeline/auto-recovery.test.ts — test coverage for auto/confirm/null/unmapped scenarios 6) test/web/api/ops-routes.test.ts — API round-trip tests. Report as CRITICAL/MAJOR/MINOR.
codex
Reviewing commit `79b48ae` with a code review focus on the recovery policy and approval-gate integration. I’m pulling the diff first, then I’ll inspect the touched files and tests for correctness gaps and regressions.
exec
/bin/bash -lc 'git show 79b48ae --stat' in /home/lee/OpenLander
 succeeded in 0ms:
commit 79b48aee9f2189cd40ce700d3e808800b1c047ac
Author: lehdqlsl <lehdqlsl@naver.com>
Date:   Thu Apr 9 19:49:57 2026 +0900

    feat(ops): unify recovery automation policy with approval gate + settings UI

    Connect the ops-recovery automationPolicy system to auto-recovery.ts so
    that high-risk tools (rollback, apply_fixes) respect per-project auto/confirm
    settings instead of always requiring manual approval.

    Backend:
    - Add TOOL_TO_RECOVERY_STEP mapping (8 HIGH_RISK tools → rollback/apply_fixes)
    - 2-step approval gate: check automationPolicy first, DecisionEngine fallback
    - Policy snapshot cached at recovery session start
    - Audit event (recovery:approval-auto-skipped) for auto-approved tools
    - Fix reloadConfig shallow merge for recovery.automation
    - Add secretScan/rollbackSuggestion to AIModelFeature type + routing

    Frontend:
    - AutomationPolicyEditor: 4-step auto/confirm toggles + "Full Auto" master
    - Pipeline scope labels: "Container recovery only" vs "All recovery types"
    - AI Features tab: autoRecovery guidance note with Operations link
    - Hot-reload vs restart-required indicators per feature
    - codingPlan "Coming Soon" badge

    Tests:
    - 19 new tests: policy auto/confirm/null/unmapped behavior, API round-trips
    - TOOL_TO_RECOVERY_STEP ↔ HIGH_RISK_DEFAULTS exhaustive mapping check

    Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>

 src/app.ts                                         |   6 +
 src/events/index.ts                                |   8 +
 src/llm/model-registry.ts                          |   6 +-
 src/monitor/activity-event-mapper.ts               |  15 +-
 src/monitor/activity-logger.ts                     |   1 +
 src/monitor/ops-agent.ts                           |   7 +-
 src/pipeline/auto-recovery.ts                      | 153 +++++++---
 src/web/api/setup-routes.ts                        |   2 +
 test/pipeline/auto-recovery.test.ts                | 289 ++++++++++++++++++
 test/web/api/ops-routes.test.ts                    | 328 +++++++++++++++++++++
 web/src/components/settings/AiFeaturesSection.tsx  |  37 +++
 .../components/settings/AutomationPolicyEditor.tsx | 197 +++++++++++++
 web/src/components/settings/OperationsSettings.tsx |   4 +
 web/src/i18n/en.ts                                 |  26 ++
 web/src/i18n/ko.ts                                 |  25 ++
 web/src/lib/api/operations.ts                      |  45 +++
 16 files changed, 1110 insertions(+), 39 deletions(-)

exec
/bin/bash -lc 'git diff 79b48ae''^..79b48ae' in /home/lee/OpenLander
 succeeded in 0ms:
diff --git a/src/app.ts b/src/app.ts
index 8461ef8..6916042 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -44,6 +44,7 @@ import { AgentPool } from './llm/agent-pool.js';
 import { createTools } from './tools/index.js';
 import { ApprovalGate } from './pipeline/approval-gate.js';
 import type { OpsAgent } from './monitor/ops-agent.js';
+import { resolveAutomationPolicy } from './monitor/ops-config-resolver.js';

 const log = createModuleLogger('app');

@@ -400,6 +401,11 @@ export async function createAppContext(
     language: config.language,
     config,
     shouldContinue: (projectId) => coordinator.shouldContinue(projectId),
+    getAutomationPolicy: (projectId) => {
+      const opsConfig = config.ops;
+      const override = db.getProjectOpsOverride(projectId);
+      return resolveAutomationPolicy(opsConfig, override ?? undefined);
+    },
   });
   coordinator.setDeploymentRecovery((projectId, error, step, buildLog) =>
     recoveryHandlers.handleDeploymentRecovery(projectId, error, step, buildLog),
diff --git a/src/events/index.ts b/src/events/index.ts
index 806ea6c..36233ea 100644
--- a/src/events/index.ts
+++ b/src/events/index.ts
@@ -90,6 +90,7 @@ export type EventType =
   | 'recovery:failed'
   | 'recovery:exhausted'
   | 'recovery:approval-needed'
+  | 'recovery:approval-auto-skipped'
   | 'recovery:approval-resolved'
   | 'env:new-keys-detected'
   | 'rollback:suggested'
@@ -351,6 +352,13 @@ export interface EventPayload {
     identity?: RequestIdentity;
     correlationId?: string;
   };
+  'recovery:approval-auto-skipped': {
+    projectId: string;
+    actionRunId: string;
+    toolName: string;
+    recoveryStep: string;
+    correlationId?: string;
+  };
   'recovery:approval-resolved': {
     actionRunId: string;
     approved: boolean;
diff --git a/src/llm/model-registry.ts b/src/llm/model-registry.ts
index 54c76cc..5b8ada7 100644
--- a/src/llm/model-registry.ts
+++ b/src/llm/model-registry.ts
@@ -24,7 +24,9 @@ export type AIModelFeature =
   | 'webAgent'
   | 'envDetection'
   | 'operationalMonitoring'
-  | 'codingPlan';
+  | 'codingPlan'
+  | 'secretScan'
+  | 'rollbackSuggestion';

 export interface ModelRoutingConfig {
   providers: Record<string, LLMProviderEntry>;
@@ -39,6 +41,8 @@ const AI_MODEL_FEATURES: AIModelFeature[] = [
   'envDetection',
   'operationalMonitoring',
   'codingPlan',
+  'secretScan',
+  'rollbackSuggestion',
 ];

 export function isValidAIModelFeature(feature: string): feature is AIModelFeature {
diff --git a/src/monitor/activity-event-mapper.ts b/src/monitor/activity-event-mapper.ts
index 7028f03..a26576a 100644
--- a/src/monitor/activity-event-mapper.ts
+++ b/src/monitor/activity-event-mapper.ts
@@ -123,7 +123,11 @@ export function mapActivityType(eventType: EventType): ActivityEvent['type'] {
   ) {
     return eventType;
   }
-  if (eventType === 'recovery:approval-needed' || eventType === 'recovery:approval-resolved') {
+  if (
+    eventType === 'recovery:approval-needed' ||
+    eventType === 'recovery:approval-auto-skipped' ||
+    eventType === 'recovery:approval-resolved'
+  ) {
     return 'approval';
   }
   if (
@@ -155,6 +159,7 @@ export function mapActivityStatus<T extends EventType>(
   if (eventType === 'recovery:success') return 'resolved';
   if (eventType === 'recovery:failed' || eventType === 'recovery:exhausted') return 'failed';
   if (eventType === 'recovery:approval-needed') return 'pending';
+  if (eventType === 'recovery:approval-auto-skipped') return 'resolved';
   if (eventType === 'recovery:approval-resolved') {
     const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
     return approvalPayload.approved ? 'resolved' : 'failed';
@@ -371,6 +376,14 @@ export function describeActivityEvent<T extends EventType>(
       actionRunId: approvalPayload.actionRunId,
     };
   }
+  if (eventType === 'recovery:approval-auto-skipped') {
+    const skippedPayload = payload as EventPayload['recovery:approval-auto-skipped'];
+    return {
+      title: `Approval auto-skipped: ${skippedPayload.toolName}`,
+      description: `Step "${skippedPayload.recoveryStep}" set to auto mode`,
+      actionRunId: skippedPayload.actionRunId,
+    };
+  }
   if (eventType === 'recovery:approval-resolved') {
     const approvalPayload = payload as EventPayload['recovery:approval-resolved'];
     return {
diff --git a/src/monitor/activity-logger.ts b/src/monitor/activity-logger.ts
index 066e532..82ab16e 100644
--- a/src/monitor/activity-logger.ts
+++ b/src/monitor/activity-logger.ts
@@ -47,6 +47,7 @@ const PERSISTED_EVENT_TYPES: EventType[] = [
   'recovery:failed',
   'recovery:exhausted',
   'recovery:approval-needed',
+  'recovery:approval-auto-skipped',
   'recovery:approval-resolved',
   'recovery:blocked',
   'recovery:stopped',
diff --git a/src/monitor/ops-agent.ts b/src/monitor/ops-agent.ts
index 2e4d31c..cf09165 100644
--- a/src/monitor/ops-agent.ts
+++ b/src/monitor/ops-agent.ts
@@ -439,13 +439,18 @@ export class OpsAgent {
       delete raw['auto_restart'];
     }

-    // Deep-merge recovery sub-object to preserve unset fields
+    // Deep-merge recovery sub-object to preserve unset fields,
+    // including nested automation policy
     if (config.recovery) {
       config = {
         ...config,
         recovery: {
           ...this.config.recovery,
           ...config.recovery,
+          automation: {
+            ...this.config.recovery.automation,
+            ...config.recovery.automation,
+          },
         },
       };
     }
diff --git a/src/pipeline/auto-recovery.ts b/src/pipeline/auto-recovery.ts
index c03f70c..d380e5f 100644
--- a/src/pipeline/auto-recovery.ts
+++ b/src/pipeline/auto-recovery.ts
@@ -17,6 +17,7 @@ import { ApprovalGate, type ApprovalGate as ApprovalGateType } from './approval-
 import { decisionEngine } from '../llm/decision.js';
 import type { PendingFixPatch } from './deploy/helpers.js';
 import { findMatchingPatterns, saveRecoveryPattern } from '../llm/memory.js';
+import type { ConfigurableRecoveryStep, RecoveryAutomationPolicy } from '../monitor/ops-types.js';

 const log = createModuleLogger('auto-recovery');

@@ -26,6 +27,18 @@ const RECOVERY_WINDOW_MS = 60 * 60 * 1000;

 type RecoveryStrategy = 'recipe' | 'llm';

+/** Maps high-risk tool names to their corresponding configurable recovery step. */
+export const TOOL_TO_RECOVERY_STEP: Record<string, ConfigurableRecoveryStep> = {
+  rollback_project: 'rollback',
+  remove_project: 'rollback',
+  platform_force_remove: 'rollback',
+  remove_service: 'rollback',
+  remove_volume: 'rollback',
+  create_database: 'apply_fixes',
+  platform_cleanup_orphans: 'apply_fixes',
+  platform_reconcile: 'apply_fixes',
+};
+
 interface GateCheckResult {
   blocked: boolean;
   reason?: 'infra-error';
@@ -52,6 +65,7 @@ export interface SetupAutoRecoveryParams {
   language: Locale;
   config: OpenLanderConfig;
   shouldContinue?: (projectId: string) => boolean;
+  getAutomationPolicy?: (projectId: string) => RecoveryAutomationPolicy | null;
 }

 export interface AutoRecoveryHandlers {
@@ -271,6 +285,7 @@ export function setupAutoRecovery(params: SetupAutoRecoveryParams): AutoRecovery
     language,
     config,
     shouldContinue: providedShouldContinue,
+    getAutomationPolicy,
   } = params;

   const approvalGate = providedApprovalGate ?? new ApprovalGate();
@@ -399,6 +414,9 @@ export function setupAutoRecovery(params: SetupAutoRecoveryParams): AutoRecovery
       try {
         const sessionId = nanoid(12);
         const contextSnapshot = await buildContextSnapshot(db);
+        // Snapshot automation policy at session start so mid-recovery config changes
+        // don't affect the current session
+        const policySnapshot = getAutomationPolicy?.(projectId) ?? null;
         const approvalState: {
           blocked: 'rejected' | 'timed_out' | 'aborted' | null;
           toolName?: string;
@@ -448,45 +466,108 @@ ${plan.agentGuidance}
               event.type === 'tool_call' &&
               decisionEngine.classify(event.toolName) === 'REQUIRE_APPROVAL'
             ) {
-              const approvalMetadata = {
-                projectId,
-                projectName,
-                toolName: event.toolName,
-                attempt,
-                actionRunId,
-                createdAt: new Date(),
-              };
-
-              await eventBus.emit('recovery:approval-needed', {
-                projectId,
-                actionRunId,
-                toolName: event.toolName,
-                attempt,
-                correlationId: projectId,
-              });
-
-              db.updateActionRunStatus(actionRunId, 'pending_approval');
-              db.updateActionRunApproval(actionRunId, 'pending', event.toolName);
-              approvalState.toolName = event.toolName;
-              const approvalResult = await approvalGate.waitForApproval(
-                actionRunId,
-                approvalMetadata,
-              );
+              // Check automation policy before requiring manual approval
+              const mappedStep = TOOL_TO_RECOVERY_STEP[event.toolName];
+              if (policySnapshot && mappedStep) {
+                const stepMode = policySnapshot[mappedStep];
+                if (stepMode === 'auto') {
+                  // Policy says auto — skip approval gate, emit audit event
+                  await eventBus.emit('recovery:approval-auto-skipped', {
+                    projectId,
+                    actionRunId,
+                    toolName: event.toolName,
+                    recoveryStep: mappedStep,
+                    correlationId: projectId,
+                  });
+                  log.info(
+                    { projectId, toolName: event.toolName, recoveryStep: mappedStep },
+                    'Approval skipped by automation policy (auto mode)',
+                  );
+                  // Fall through — no approval needed
+                } else {
+                  // Policy says confirm — existing approval behavior
+                  const approvalMetadata = {
+                    projectId,
+                    projectName,
+                    toolName: event.toolName,
+                    attempt,
+                    actionRunId,
+                    createdAt: new Date(),
+                  };
+
+                  await eventBus.emit('recovery:approval-needed', {
+                    projectId,
+                    actionRunId,
+                    toolName: event.toolName,
+                    attempt,
+                    correlationId: projectId,
+                  });
+
+                  db.updateActionRunStatus(actionRunId, 'pending_approval');
+                  db.updateActionRunApproval(actionRunId, 'pending', event.toolName);
+                  approvalState.toolName = event.toolName;
+                  const approvalResult = await approvalGate.waitForApproval(
+                    actionRunId,
+                    approvalMetadata,
+                  );
+
+                  if (approvalResult === 'rejected') {
+                    approvalState.blocked = 'rejected';
+                    db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
+                    return;
+                  }
+
+                  if (approvalResult === 'timed_out') {
+                    approvalState.blocked = 'timed_out';
+                    db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
+                    return;
+                  }
+
+                  db.updateActionRunStatus(actionRunId, 'running');
+                  db.updateActionRunApproval(actionRunId, 'approved', event.toolName);
+                }
+              } else {
+                // No policy or tool not mapped — fall back to DecisionEngine behavior
+                const approvalMetadata = {
+                  projectId,
+                  projectName,
+                  toolName: event.toolName,
+                  attempt,
+                  actionRunId,
+                  createdAt: new Date(),
+                };
+
+                await eventBus.emit('recovery:approval-needed', {
+                  projectId,
+                  actionRunId,
+                  toolName: event.toolName,
+                  attempt,
+                  correlationId: projectId,
+                });
+
+                db.updateActionRunStatus(actionRunId, 'pending_approval');
+                db.updateActionRunApproval(actionRunId, 'pending', event.toolName);
+                approvalState.toolName = event.toolName;
+                const approvalResult = await approvalGate.waitForApproval(
+                  actionRunId,
+                  approvalMetadata,
+                );

-              if (approvalResult === 'rejected') {
-                approvalState.blocked = 'rejected';
-                db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
-                return;
-              }
+                if (approvalResult === 'rejected') {
+                  approvalState.blocked = 'rejected';
+                  db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
+                  return;
+                }

-              if (approvalResult === 'timed_out') {
-                approvalState.blocked = 'timed_out';
-                db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
-                return;
-              }
+                if (approvalResult === 'timed_out') {
+                  approvalState.blocked = 'timed_out';
+                  db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
+                  return;
+                }

-              db.updateActionRunStatus(actionRunId, 'running');
-              db.updateActionRunApproval(actionRunId, 'approved', event.toolName);
+                db.updateActionRunStatus(actionRunId, 'running');
+                db.updateActionRunApproval(actionRunId, 'approved', event.toolName);
+              }
             }

             await eventBus.emit('agent:event', {
diff --git a/src/web/api/setup-routes.ts b/src/web/api/setup-routes.ts
index c8c6e2e..be5aee7 100644
--- a/src/web/api/setup-routes.ts
+++ b/src/web/api/setup-routes.ts
@@ -507,6 +507,8 @@ export function createSetupRoutes(ctx: AppContext): Hono {
       'envDetection',
       'operationalMonitoring',
       'codingPlan',
+      'secretScan',
+      'rollbackSuggestion',
     ];
     for (const fk of featureRoutingKeys) {
       const toggle = updated.ai[fk];
diff --git a/test/pipeline/auto-recovery.test.ts b/test/pipeline/auto-recovery.test.ts
index e48a960..9a165e4 100644
--- a/test/pipeline/auto-recovery.test.ts
+++ b/test/pipeline/auto-recovery.test.ts
@@ -5,6 +5,7 @@ import { tmpdir } from 'node:os';

 import {
   setupAutoRecovery,
+  TOOL_TO_RECOVERY_STEP,
   type AutoRecoveryAgent,
   type AutoRecoveryHandlers,
 } from '../../src/pipeline/auto-recovery.js';
@@ -15,6 +16,8 @@ import { QuestionBridge } from '../../src/lib/question-bridge.js';
 import type { DeployPipeline, DeployResult } from '../../src/pipeline/deploy.js';
 import type { DeployQueue } from '../../src/pipeline/deploy-queue.js';
 import { normalizeErrorSignature } from '../../src/llm/memory.js';
+import type { RecoveryAutomationPolicy } from '../../src/monitor/ops-types.js';
+import { ApprovalGate } from '../../src/pipeline/approval-gate.js';

 interface Harness {
   eventBus: EventBus;
@@ -53,6 +56,8 @@ function createDeferred<T>(): Deferred<T> {
 function createHarness(options?: {
   agent?: AutoRecoveryAgent | null;
   redeployImpl?: Harness['redeployMock'];
+  getAutomationPolicy?: (projectId: string) => RecoveryAutomationPolicy | null;
+  approvalGate?: ApprovalGate;
 }): Harness {
   const tmpDir = mkdtempSync(join(tmpdir(), 'openlander-auto-recovery-'));
   const db = new Database(join(tmpDir, 'test.db'));
@@ -93,6 +98,8 @@ function createHarness(options?: {
     questionBridge,
     language: 'en',
     config: testConfig,
+    getAutomationPolicy: options?.getAutomationPolicy,
+    approvalGate: options?.approvalGate,
   });

   return {
@@ -512,3 +519,285 @@ describe('setupAutoRecovery', () => {
     }
   });
 });
+
+// ── Automation policy tests ────────────────────────────────────────────────────
+
+describe('setupAutoRecovery — automation policy', () => {
+  beforeEach(() => {
+    vi.useFakeTimers();
+  });
+
+  afterEach(() => {
+    vi.useRealTimers();
+  });
+
+  it('skips approval gate when automationPolicy.rollback is auto for rollback_project tool', async () => {
+    const autoSkippedHandler = vi.fn();
+
+    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
+      await onEvent({
+        type: 'tool_call',
+        toolName: 'rollback_project',
+        arguments: { project_name: 'proj-auto-policy' },
+        stepIndex: 0,
+      });
+    });
+
+    const policy: RecoveryAutomationPolicy = {
+      restart: 'auto',
+      diagnosis: 'auto',
+      apply_fixes: 'auto',
+      rollback: 'auto',
+    };
+
+    const harness = createHarness({
+      agent: { chatStream: agentChatMock },
+      getAutomationPolicy: () => policy,
+    });
+
+    harness.eventBus.on('recovery:approval-auto-skipped', autoSkippedHandler);
+
+    try {
+      const projectId = 'proj-auto-policy';
+      harness.db.createProject({
+        id: projectId,
+        name: projectId,
+        repoUrl: 'https://github.com/openlander/proj-auto-policy',
+        branch: 'main',
+      });
+      harness.db.updateProject(projectId, { status: 'running' });
+
+      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
+        projectId,
+        'unknown build failure requiring ai',
+        'build',
+      );
+      await vi.advanceTimersByTimeAsync(2_100);
+
+      // With rollback='auto', no pending approval should be set
+      const runs = harness.db.getActionRunsByProject(projectId, 1);
+      expect(runs).toHaveLength(1);
+      expect(runs[0].approval_status).not.toBe('pending');
+
+      // Audit event must be emitted
+      expect(autoSkippedHandler).toHaveBeenCalledOnce();
+      expect(autoSkippedHandler).toHaveBeenCalledWith(
+        expect.objectContaining({
+          projectId,
+          toolName: 'rollback_project',
+          recoveryStep: 'rollback',
+        }),
+      );
+
+      // Let recovery complete (agent stream ended; wait for outcome timeout)
+      await vi.advanceTimersByTimeAsync(300_000);
+      await recoveryPromise;
+    } finally {
+      harness.db.close();
+      rmSync(harness.tmpDir, { recursive: true, force: true });
+    }
+  });
+
+  it('triggers approval gate when automationPolicy.rollback is confirm for rollback_project tool', async () => {
+    const approvalNeededHandler = vi.fn();
+
+    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
+      await onEvent({
+        type: 'tool_call',
+        toolName: 'rollback_project',
+        arguments: { project_name: 'proj-confirm-policy' },
+        stepIndex: 0,
+      });
+    });
+
+    const policy: RecoveryAutomationPolicy = {
+      restart: 'auto',
+      diagnosis: 'auto',
+      apply_fixes: 'auto',
+      rollback: 'confirm',
+    };
+
+    const harness = createHarness({
+      agent: { chatStream: agentChatMock },
+      getAutomationPolicy: () => policy,
+    });
+
+    harness.eventBus.on('recovery:approval-needed', approvalNeededHandler);
+
+    try {
+      const projectId = 'proj-confirm-policy';
+      harness.db.createProject({
+        id: projectId,
+        name: projectId,
+        repoUrl: 'https://github.com/openlander/proj-confirm-policy',
+        branch: 'main',
+      });
+      harness.db.updateProject(projectId, { status: 'running' });
+
+      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
+        projectId,
+        'unknown build failure requiring ai',
+        'build',
+      );
+      await vi.advanceTimersByTimeAsync(2_100);
+
+      // With rollback='confirm', approval should be pending
+      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
+      expect(pendingRun.approval_status).toBe('pending');
+      expect(pendingRun.approval_tool).toBe('rollback_project');
+
+      // Approval event must be emitted
+      expect(approvalNeededHandler).toHaveBeenCalledOnce();
+      expect(approvalNeededHandler).toHaveBeenCalledWith(
+        expect.objectContaining({
+          projectId,
+          toolName: 'rollback_project',
+        }),
+      );
+
+      // Resolve by rejection so the recovery promise can settle
+      harness.recoveryHandlers.resolveApproval(pendingRun.id, false);
+      await vi.advanceTimersByTimeAsync(0);
+      await recoveryPromise;
+    } finally {
+      harness.db.close();
+      rmSync(harness.tmpDir, { recursive: true, force: true });
+    }
+  });
+
+  it('uses DecisionEngine fallback (requires approval) when policy is null', async () => {
+    const approvalNeededHandler = vi.fn();
+
+    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
+      await onEvent({
+        type: 'tool_call',
+        toolName: 'rollback_project',
+        arguments: { project_name: 'proj-null-policy' },
+        stepIndex: 0,
+      });
+    });
+
+    // getAutomationPolicy returns null → no policy active
+    const harness = createHarness({
+      agent: { chatStream: agentChatMock },
+      getAutomationPolicy: () => null,
+    });
+
+    harness.eventBus.on('recovery:approval-needed', approvalNeededHandler);
+
+    try {
+      const projectId = 'proj-null-policy';
+      harness.db.createProject({
+        id: projectId,
+        name: projectId,
+        repoUrl: 'https://github.com/openlander/proj-null-policy',
+        branch: 'main',
+      });
+      harness.db.updateProject(projectId, { status: 'running' });
+
+      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
+        projectId,
+        'unknown build failure requiring ai',
+        'build',
+      );
+      await vi.advanceTimersByTimeAsync(2_100);
+
+      // With null policy, DecisionEngine classifies rollback_project as REQUIRE_APPROVAL
+      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
+      expect(pendingRun.approval_status).toBe('pending');
+      expect(approvalNeededHandler).toHaveBeenCalledOnce();
+
+      harness.recoveryHandlers.resolveApproval(pendingRun.id, false);
+      await vi.advanceTimersByTimeAsync(0);
+      await recoveryPromise;
+    } finally {
+      harness.db.close();
+      rmSync(harness.tmpDir, { recursive: true, force: true });
+    }
+  });
+
+  it('uses DecisionEngine fallback for unmapped tool even when policy is set', async () => {
+    // 'create_deploy_plan' is NOTIFY_THEN_ALLOW (medium risk), not in TOOL_TO_RECOVERY_STEP
+    // Even with a policy, an unmapped tool must fall through to DecisionEngine logic
+    const approvalNeededHandler = vi.fn();
+    const autoSkippedHandler = vi.fn();
+
+    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
+      await onEvent({
+        type: 'tool_call',
+        toolName: 'create_deploy_plan',
+        arguments: { project_id: 'proj-unmapped-tool' },
+        stepIndex: 0,
+      });
+    });
+
+    const policy: RecoveryAutomationPolicy = {
+      restart: 'auto',
+      diagnosis: 'auto',
+      apply_fixes: 'auto',
+      rollback: 'auto',
+    };
+
+    const harness = createHarness({
+      agent: { chatStream: agentChatMock },
+      getAutomationPolicy: () => policy,
+    });
+
+    harness.eventBus.on('recovery:approval-needed', approvalNeededHandler);
+    harness.eventBus.on('recovery:approval-auto-skipped', autoSkippedHandler);
+
+    try {
+      const projectId = 'proj-unmapped-tool';
+      harness.db.createProject({
+        id: projectId,
+        name: projectId,
+        repoUrl: 'https://github.com/openlander/proj-unmapped-tool',
+        branch: 'main',
+      });
+      harness.db.updateProject(projectId, { status: 'running' });
+
+      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
+        projectId,
+        'unknown build failure requiring ai',
+        'build',
+      );
+      await vi.advanceTimersByTimeAsync(2_100);
+
+      // create_deploy_plan is medium risk → NOTIFY_THEN_ALLOW → no approval needed
+      expect(approvalNeededHandler).not.toHaveBeenCalled();
+      expect(autoSkippedHandler).not.toHaveBeenCalled();
+
+      // Let recovery complete (no approval gate blocking it)
+      await vi.advanceTimersByTimeAsync(300_000);
+      await recoveryPromise;
+    } finally {
+      harness.db.close();
+      rmSync(harness.tmpDir, { recursive: true, force: true });
+    }
+  });
+
+  it('TOOL_TO_RECOVERY_STEP maps every HIGH_RISK_DEFAULTS tool to a configurable step', () => {
+    // These are the exact tools DecisionEngine classifies as REQUIRE_APPROVAL by default.
+    // All of them must exist in TOOL_TO_RECOVERY_STEP so the policy can override them.
+    const HIGH_RISK_TOOLS = [
+      'rollback_project',
+      'remove_project',
+      'remove_service',
+      'create_database',
+      'platform_cleanup_orphans',
+      'platform_reconcile',
+      'platform_force_remove',
+      'remove_volume',
+    ] as const;
+
+    const validSteps = new Set(['restart', 'diagnosis', 'apply_fixes', 'rollback']);
+
+    for (const tool of HIGH_RISK_TOOLS) {
+      const mappedStep = TOOL_TO_RECOVERY_STEP[tool];
+      expect(mappedStep, `${tool} must be mapped in TOOL_TO_RECOVERY_STEP`).toBeDefined();
+      expect(validSteps, `${tool} must map to a valid ConfigurableRecoveryStep`).toContain(
+        mappedStep,
+      );
+    }
+  });
+});
diff --git a/test/web/api/ops-routes.test.ts b/test/web/api/ops-routes.test.ts
new file mode 100644
index 0000000..e7500bf
--- /dev/null
+++ b/test/web/api/ops-routes.test.ts
@@ -0,0 +1,328 @@
+/**
+ * Automation policy API round-trip tests for ops-routes.
+ *
+ * Tests that:
+ * - PUT /projects/:projectId/automation → GET /projects/:projectId/automation returns same values
+ * - DELETE /projects/:projectId/automation → GET /projects/:projectId/automation returns defaults
+ */
+
+import { beforeEach, describe, expect, it, vi } from 'vitest';
+import { Hono } from 'hono';
+
+import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
+import type { AppContext } from '../../../src/app.js';
+import { DEFAULT_RECOVERY_AUTOMATION } from '../../../src/monitor/ops-types.js';
+import type { ProjectOpsOverride } from '../../../src/monitor/ops-types.js';
+
+// ---------------------------------------------------------------------------
+// In-memory store helpers to simulate database round-trips
+// ---------------------------------------------------------------------------
+
+function createOpsOverrideStore(): {
+  store: Map<string, ProjectOpsOverride>;
+  get: (projectId: string) => ProjectOpsOverride | undefined;
+  set: (projectId: string, override: ProjectOpsOverride) => void;
+  del: (projectId: string) => void;
+} {
+  const store = new Map<string, ProjectOpsOverride>();
+  return {
+    store,
+    get: (projectId) => store.get(projectId),
+    set: (projectId, override) => store.set(projectId, override),
+    del: (projectId) => store.delete(projectId),
+  };
+}
+
+function createHarness(overrideStore = createOpsOverrideStore()) {
+  const ctx = {
+    opsAgent: {
+      getConfig: () => ({
+        enabled: true,
+        recovery: {
+          enabled: true,
+          automation: { ...DEFAULT_RECOVERY_AUTOMATION },
+        },
+        auto_restart: true,
+        auto_cleanup: true,
+        drift_detection: true,
+        production_only: true,
+        thresholds: {
+          disk_cleanup_percent: 80,
+          recovery_max_per_day: 5,
+          alert_dedup_minutes: 15,
+          digest_time: '09:00',
+        },
+        channels: {},
+      }),
+      getDigest: () => null,
+      generateDigest: vi.fn(),
+      reloadConfig: vi.fn(),
+    },
+    db: {
+      getProject: (id: string) =>
+        id === 'proj-1' ? { id: 'proj-1', name: 'alpha-service', status: 'running' } : undefined,
+      getProjectOpsOverride: (projectId: string) => overrideStore.get(projectId),
+      setProjectOpsOverride: (projectId: string, override: ProjectOpsOverride) =>
+        overrideStore.set(projectId, override),
+      deleteProjectOpsOverride: (projectId: string) => overrideStore.del(projectId),
+      listOpsIncidentsByProject: () => [],
+      listOpsIncidentsByDateRange: () => [],
+      listOpsIncidentEventsByIncidentIds: () => [],
+      listOpsIncidentEvents: () => [],
+      getOpsIncident: () => undefined,
+      getCircuitBreakerState: () => null,
+      resetCircuitBreaker: vi.fn(),
+      listAllCircuitBreakers: () => [],
+      listProjects: () => [{ id: 'proj-1', name: 'alpha-service', status: 'running' }],
+      listServices: () => [],
+      findAllProjectDependencies: () => [],
+      getActionRunsByProject: () => [],
+      getActionRunsByApprovalStatus: () => [],
+    },
+  } as unknown as AppContext;
+
+  const app = new Hono();
+  app.route('/api', createOpsRoutes(ctx));
+  return { app, overrideStore };
+}
+
+// ---------------------------------------------------------------------------
+// Automation policy round-trip tests
+// ---------------------------------------------------------------------------
+
+describe('PUT /api/projects/:projectId/automation → GET returns same values', () => {
+  let harness: ReturnType<typeof createHarness>;
+
+  beforeEach(() => {
+    harness = createHarness();
+  });
+
+  it('PUT sets rollback to auto and GET reflects the change in overrides', async () => {
+    const putResponse = await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'PUT',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ automation: { rollback: 'auto' } }),
+    });
+    expect(putResponse.status).toBe(200);
+
+    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
+    expect(getResponse.status).toBe(200);
+
+    const body = (await getResponse.json()) as {
+      overrides: Record<string, string>;
+      effective: Record<string, string>;
+    };
+    expect(body.overrides).not.toBeNull();
+    expect(body.overrides['rollback']).toBe('auto');
+    expect(body.effective['rollback']).toBe('auto');
+  });
+
+  it('PUT sets apply_fixes to confirm and GET reflects the change in overrides', async () => {
+    await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'PUT',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ automation: { apply_fixes: 'confirm' } }),
+    });
+
+    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
+    const body = (await getResponse.json()) as {
+      overrides: Record<string, string>;
+      effective: Record<string, string>;
+    };
+    expect(body.overrides['apply_fixes']).toBe('confirm');
+    expect(body.effective['apply_fixes']).toBe('confirm');
+  });
+
+  it('PUT full policy and GET returns all four steps with correct values', async () => {
+    const putResponse = await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'PUT',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({
+        automation: { restart: 'auto', diagnosis: 'auto', apply_fixes: 'auto', rollback: 'auto' },
+      }),
+    });
+    expect(putResponse.status).toBe(200);
+
+    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
+    const body = (await getResponse.json()) as {
+      effective: Record<string, string>;
+      isAutopilot: boolean;
+    };
+    expect(body.effective['restart']).toBe('auto');
+    expect(body.effective['diagnosis']).toBe('auto');
+    expect(body.effective['apply_fixes']).toBe('auto');
+    expect(body.effective['rollback']).toBe('auto');
+    expect(body.isAutopilot).toBe(true);
+  });
+
+  it('PUT partial policy merges with existing overrides rather than replacing them', async () => {
+    // First PUT sets rollback to auto
+    await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'PUT',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ automation: { rollback: 'auto' } }),
+    });
+
+    // Second PUT sets apply_fixes to auto — rollback must still be auto
+    await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'PUT',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ automation: { apply_fixes: 'auto' } }),
+    });
+
+    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
+    const body = (await getResponse.json()) as { overrides: Record<string, string> };
+    expect(body.overrides['rollback']).toBe('auto');
+    expect(body.overrides['apply_fixes']).toBe('auto');
+  });
+
+  it('PUT returns 400 when automation step name is invalid', async () => {
+    const response = await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'PUT',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ automation: { unknown_step: 'auto' } }),
+    });
+    expect(response.status).toBe(400);
+    const body = (await response.json()) as { error: string };
+    expect(typeof body.error).toBe('string');
+  });
+
+  it('PUT returns 400 when automation mode value is invalid', async () => {
+    const response = await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'PUT',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ automation: { rollback: 'skip' } }),
+    });
+    expect(response.status).toBe(400);
+  });
+
+  it('PUT returns 404 when project does not exist', async () => {
+    const response = await harness.app.request('/api/projects/nonexistent/automation', {
+      method: 'PUT',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ automation: { rollback: 'auto' } }),
+    });
+    expect(response.status).toBe(404);
+  });
+
+  it('GET returns 404 when project does not exist', async () => {
+    const response = await harness.app.request('/api/projects/nonexistent/automation');
+    expect(response.status).toBe(404);
+  });
+});
+
+// ---------------------------------------------------------------------------
+// DELETE → GET returns defaults
+// ---------------------------------------------------------------------------
+
+describe('DELETE /api/projects/:projectId/automation → GET returns defaults', () => {
+  let harness: ReturnType<typeof createHarness>;
+
+  beforeEach(() => {
+    harness = createHarness();
+  });
+
+  it('DELETE clears project override and GET effective policy falls back to global defaults', async () => {
+    // Arrange: set a project override first
+    await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'PUT',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({ automation: { rollback: 'auto', apply_fixes: 'auto' } }),
+    });
+
+    // Verify override is set
+    const before = (await (
+      await harness.app.request('/api/projects/proj-1/automation')
+    ).json()) as { overrides: Record<string, string> | null };
+    expect(before.overrides).not.toBeNull();
+
+    // Act: delete the override
+    const deleteResponse = await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'DELETE',
+    });
+    expect(deleteResponse.status).toBe(200);
+    const deleteBody = (await deleteResponse.json()) as { deleted: boolean };
+    expect(deleteBody.deleted).toBe(true);
+
+    // Assert: GET now returns null overrides and effective matches global defaults
+    const after = (await (await harness.app.request('/api/projects/proj-1/automation')).json()) as {
+      effective: Record<string, string>;
+      overrides: Record<string, string> | null;
+    };
+    expect(after.overrides).toBeNull();
+    expect(after.effective['rollback']).toBe(DEFAULT_RECOVERY_AUTOMATION.rollback);
+    expect(after.effective['apply_fixes']).toBe(DEFAULT_RECOVERY_AUTOMATION.apply_fixes);
+    expect(after.effective['restart']).toBe(DEFAULT_RECOVERY_AUTOMATION.restart);
+    expect(after.effective['diagnosis']).toBe(DEFAULT_RECOVERY_AUTOMATION.diagnosis);
+  });
+
+  it('DELETE on a project with no existing override still returns deleted:true', async () => {
+    // No prior PUT — deleting a non-existent override must not fail
+    const deleteResponse = await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'DELETE',
+    });
+    expect(deleteResponse.status).toBe(200);
+    const body = (await deleteResponse.json()) as { deleted: boolean };
+    expect(body.deleted).toBe(true);
+  });
+
+  it('GET effective policy after DELETE equals DEFAULT_RECOVERY_AUTOMATION exactly', async () => {
+    // Arrange: set all steps to auto (overriding defaults where they differ)
+    await harness.app.request('/api/projects/proj-1/automation', {
+      method: 'PUT',
+      headers: { 'Content-Type': 'application/json' },
+      body: JSON.stringify({
+        automation: { restart: 'auto', diagnosis: 'auto', apply_fixes: 'auto', rollback: 'auto' },
+      }),
+    });
+
+    // Act: delete
+    await harness.app.request('/api/projects/proj-1/automation', { method: 'DELETE' });
+
+    // Assert: effective matches DEFAULT_RECOVERY_AUTOMATION step by step
+    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
+    const body = (await getResponse.json()) as { effective: Record<string, string> };
+
+    for (const [step, mode] of Object.entries(DEFAULT_RECOVERY_AUTOMATION)) {
+      expect(body.effective[step], `step ${step} must match default after DELETE`).toBe(mode);
+    }
+  });
+});
+
+// ---------------------------------------------------------------------------
+// Automation defaults endpoint
+// ---------------------------------------------------------------------------
+
+describe('GET /api/automation/defaults', () => {
+  let harness: ReturnType<typeof createHarness>;
+
+  beforeEach(() => {
+    harness = createHarness();
+  });
+
+  it('returns defaults field equal to DEFAULT_RECOVERY_AUTOMATION', async () => {
+    const response = await harness.app.request('/api/automation/defaults');
+    expect(response.status).toBe(200);
+    const body = (await response.json()) as { defaults: Record<string, string> };
+    for (const [step, mode] of Object.entries(DEFAULT_RECOVERY_AUTOMATION)) {
+      expect(body.defaults[step]).toBe(mode);
+    }
+  });
+
+  it('returns effective field with all four configurable steps', async () => {
+    const response = await harness.app.request('/api/automation/defaults');
+    const body = (await response.json()) as { effective: Record<string, string> | null };
+    const steps = ['restart', 'diagnosis', 'apply_fixes', 'rollback'];
+    if (body.effective !== null) {
+      for (const step of steps) {
+        expect(body.effective[step]).toBeDefined();
+      }
+    }
+  });
+
+  it('returns isAutopilot boolean field', async () => {
+    const response = await harness.app.request('/api/automation/defaults');
+    const body = (await response.json()) as { isAutopilot: unknown };
+    expect(typeof body.isAutopilot).toBe('boolean');
+  });
+});
diff --git a/web/src/components/settings/AiFeaturesSection.tsx b/web/src/components/settings/AiFeaturesSection.tsx
index dc2fce7..4105e8b 100644
--- a/web/src/components/settings/AiFeaturesSection.tsx
+++ b/web/src/components/settings/AiFeaturesSection.tsx
@@ -244,10 +244,47 @@ export function AiFeaturesSection({ providers }: AiFeaturesSectionProps) {
                         {t('settings.ai.unavailable') || 'UNAVAILABLE'}
                       </span>
                     )}
+                    {key === 'codingPlan' && (
+                      <span className="text-[10px] uppercase tracking-wider font-semibold bg-warning/10 text-warning px-1.5 py-0.5 rounded">
+                        {t('settings.ai.comingSoon') || 'Coming Soon'}
+                      </span>
+                    )}
+                    {MODEL_SELECTOR_FEATURES.has(key) ? (
+                      <span className="text-[10px] font-body text-muted-ol">
+                        {t('settings.ai.appliedImmediately') || 'Applied immediately'}
+                      </span>
+                    ) : (
+                      <span className="text-[10px] font-body text-muted-ol">
+                        {t('settings.ai.restartRequired') || 'Restart required'}
+                      </span>
+                    )}
                   </div>
                   <p className="text-xs font-body text-secondary-ol">
                     {t(`settings.ai.${key}.description`) || ''}
                   </p>
+                  {key === 'autoRecovery' && (
+                    <p className="text-xs font-body text-muted-ol mt-0.5">
+                      {(() => {
+                        const note = t('settings.ai.autoRecoveryNote') || '';
+                        const linkText =
+                          t('settings.ai.operationsSettingsLink') || 'Operations settings';
+                        const linkIdx = note.indexOf(linkText);
+                        if (linkIdx === -1) return note;
+                        return (
+                          <>
+                            {note.slice(0, linkIdx)}
+                            <a
+                              href="/settings?tab=operations"
+                              className="text-agent underline underline-offset-2 hover:opacity-80"
+                            >
+                              {linkText}
+                            </a>
+                            {note.slice(linkIdx + linkText.length)}
+                          </>
+                        );
+                      })()}
+                    </p>
+                  )}
                 </div>
                 <div className="flex items-center gap-3 shrink-0">
                   {MODEL_SELECTOR_FEATURES.has(key) && providers.length > 0 && (
diff --git a/web/src/components/settings/AutomationPolicyEditor.tsx b/web/src/components/settings/AutomationPolicyEditor.tsx
new file mode 100644
index 0000000..00ba2be
--- /dev/null
+++ b/web/src/components/settings/AutomationPolicyEditor.tsx
@@ -0,0 +1,197 @@
+import { useState, useEffect } from 'react';
+import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
+import { Switch } from '@/components/ui/switch';
+import { Label } from '@/components/ui/label';
+import { Badge } from '@/components/ui/badge';
+import { useLanguage } from '@/i18n/context';
+import {
+  fetchAutomationDefaults,
+  type AutomationStep,
+  type AutomationMode,
+  type AutomationPolicy,
+} from '@/lib/api/operations';
+
+const STEPS: {
+  key: AutomationStep;
+  labelKey: string;
+  noteKey: string;
+}[] = [
+  {
+    key: 'restart',
+    labelKey: 'settings.operations.automation.restart',
+    noteKey: 'settings.operations.automation.restartNote',
+  },
+  {
+    key: 'diagnosis',
+    labelKey: 'settings.operations.automation.diagnosis',
+    noteKey: 'settings.operations.automation.diagnosisNote',
+  },
+  {
+    key: 'apply_fixes',
+    labelKey: 'settings.operations.automation.applyFixes',
+    noteKey: 'settings.operations.automation.applyFixesNote',
+  },
+  {
+    key: 'rollback',
+    labelKey: 'settings.operations.automation.rollback',
+    noteKey: 'settings.operations.automation.rollbackNote',
+  },
+];
+
+interface AutomationPolicyEditorProps {
+  /** When provided, the policy values are externally controlled */
+  value?: Partial<Record<AutomationStep, AutomationMode>>;
+  /** Called when any step mode changes */
+  onChange?: (policy: Record<AutomationStep, AutomationMode>) => void;
+}
+
+const DEFAULT_POLICY: AutomationPolicy = {
+  restart: 'confirm',
+  diagnosis: 'confirm',
+  apply_fixes: 'confirm',
+  rollback: 'confirm',
+};
+
+export function AutomationPolicyEditor({ value, onChange }: AutomationPolicyEditorProps) {
+  const { t } = useLanguage();
+  const [policy, setPolicy] = useState<AutomationPolicy>(DEFAULT_POLICY);
+  const [effectivePolicy, setEffectivePolicy] = useState<AutomationPolicy | null>(null);
+  const [loading, setLoading] = useState(true);
+  const [error, setError] = useState<string | null>(null);
+
+  useEffect(() => {
+    void fetchAutomationDefaults()
+      .then((data) => {
+        const effective = data.effective ?? data.defaults;
+        setEffectivePolicy(effective);
+        setPolicy(effective);
+        setLoading(false);
+      })
+      .catch(() => {
+        setError(t('settings.operations.automation.loadFailed'));
+        setLoading(false);
+      });
+  }, [t]);
+
+  // Sync external value when provided
+  useEffect(() => {
+    if (value) {
+      setPolicy((prev) => ({ ...prev, ...value }));
+    }
+  }, [value]);
+
+  const currentPolicy = value ? { ...DEFAULT_POLICY, ...value } : policy;
+  const isFullAuto = STEPS.every((s) => currentPolicy[s.key] === 'auto');
+
+  const updateStep = (step: AutomationStep, mode: AutomationMode) => {
+    const next = { ...currentPolicy, [step]: mode };
+    setPolicy(next);
+    onChange?.(next);
+  };
+
+  const toggleFullAuto = (enabled: boolean) => {
+    const mode: AutomationMode = enabled ? 'auto' : 'confirm';
+    const next: AutomationPolicy = {
+      restart: mode,
+      diagnosis: mode,
+      apply_fixes: mode,
+      rollback: mode,
+    };
+    setPolicy(next);
+    onChange?.(next);
+  };
+
+  if (loading) {
+    return (
+      <Card>
+        <CardContent className="py-6">
+          <p className="text-sm text-muted-foreground">
+            {t('settings.operations.automation.loading')}
+          </p>
+        </CardContent>
+      </Card>
+    );
+  }
+
+  if (error) {
+    return (
+      <Card>
+        <CardContent className="py-6">
+          <p className="text-sm text-destructive">{error}</p>
+        </CardContent>
+      </Card>
+    );
+  }
+
+  return (
+    <Card>
+      <CardHeader>
+        <CardTitle>{t('settings.operations.automation.title')}</CardTitle>
+        <CardDescription>{t('settings.operations.automation.description')}</CardDescription>
+      </CardHeader>
+      <CardContent className="space-y-4">
+        {/* Full Auto master toggle */}
+        <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/50">
+          <div>
+            <Label className="text-sm font-medium">
+              {t('settings.operations.automation.fullAuto')}
+            </Label>
+            <p className="text-xs text-muted-foreground">
+              {t('settings.operations.automation.fullAutoDesc')}
+            </p>
+          </div>
+          <Switch checked={isFullAuto} onCheckedChange={toggleFullAuto} />
+        </div>
+
+        {/* Individual step toggles */}
+        <div className="space-y-3">
+          {STEPS.map(({ key, labelKey, noteKey }) => (
+            <div key={key} className="flex items-center justify-between">
+              <div className="space-y-0.5">
+                <Label className="text-sm">{t(labelKey)}</Label>
+                <p className="text-xs text-muted-foreground">{t(noteKey)}</p>
+              </div>
+              <div className="flex items-center gap-2">
+                <Badge
+                  variant={currentPolicy[key] === 'auto' ? 'default' : 'secondary'}
+                  className="text-xs min-w-[4rem] justify-center"
+                >
+                  {currentPolicy[key] === 'auto'
+                    ? t('settings.operations.automation.modeAuto')
+                    : t('settings.operations.automation.modeConfirm')}
+                </Badge>
+                <Switch
+                  checked={currentPolicy[key] === 'auto'}
+                  onCheckedChange={(checked) => updateStep(key, checked ? 'auto' : 'confirm')}
+                />
+              </div>
+            </div>
+          ))}
+        </div>
+
+        {/* Effective policy display */}
+        {effectivePolicy && (
+          <div className="mt-4 rounded-lg border p-3">
+            <p className="text-xs font-medium text-muted-foreground mb-2">
+              {t('settings.operations.automation.effective')}
+            </p>
+            <div className="flex flex-wrap gap-2">
+              {STEPS.map(({ key, labelKey }) => (
+                <Badge
+                  key={key}
+                  variant={effectivePolicy[key] === 'auto' ? 'default' : 'outline'}
+                  className="text-xs"
+                >
+                  {t(labelKey)}:{' '}
+                  {effectivePolicy[key] === 'auto'
+                    ? t('settings.operations.automation.modeAuto')
+                    : t('settings.operations.automation.modeConfirm')}
+                </Badge>
+              ))}
+            </div>
+          </div>
+        )}
+      </CardContent>
+    </Card>
+  );
+}
diff --git a/web/src/components/settings/OperationsSettings.tsx b/web/src/components/settings/OperationsSettings.tsx
index 3cb5b37..7827431 100644
--- a/web/src/components/settings/OperationsSettings.tsx
+++ b/web/src/components/settings/OperationsSettings.tsx
@@ -6,6 +6,7 @@ import { Label } from '@/components/ui/label';
 import { Button } from '@/components/ui/button';
 import { fetchOpsConfig, updateOpsConfig } from '@/lib/api/operations';
 import { useLanguage } from '@/i18n/context';
+import { AutomationPolicyEditor } from './AutomationPolicyEditor';

 interface OpsConfigState {
   enabled: boolean;
@@ -126,6 +127,9 @@ export function OperationsSettings() {
         </CardContent>
       </Card>

+      {/* Automation Policy */}
+      <AutomationPolicyEditor />
+
       {/* Thresholds */}
       <Card>
         <CardHeader>
diff --git a/web/src/i18n/en.ts b/web/src/i18n/en.ts
index 229a88a..5ee4885 100644
--- a/web/src/i18n/en.ts
+++ b/web/src/i18n/en.ts
@@ -237,10 +237,16 @@ export const translations = {
       errorLoad: 'Failed to load AI features',
       errorUpdate: 'Failed to update feature',
       unavailable: 'Unavailable',
+      comingSoon: 'Coming Soon',
       modelDefault: 'Default',
       modelSelector: 'Model',
       autoSetup: 'Auto Setup',
       autoSetupSuccess: 'AI features configured automatically',
+      autoRecoveryNote:
+        'Controls whether the AI agent is enabled. Approval policies for recovery are managed in Operations settings.',
+      operationsSettingsLink: 'Operations settings',
+      restartRequired: 'Restart required',
+      appliedImmediately: 'Applied immediately',
       autoRecovery: {
         label: 'Auto Recovery',
         description: 'Automatically attempt to fix build failures',
@@ -403,6 +409,26 @@ export const translations = {
       save: 'Save Settings',
       saving: 'Saving...',
       saved: 'Saved ✓',
+      automation: {
+        title: 'Automation Policy',
+        description:
+          'Configure which recovery steps run automatically or require manual confirmation.',
+        fullAuto: 'Full Auto',
+        fullAutoDesc: 'Set all steps to automatic execution',
+        restart: 'Restart',
+        restartNote: 'Container recovery only',
+        diagnosis: 'Diagnosis',
+        diagnosisNote: 'Container recovery only',
+        applyFixes: 'Apply Fixes',
+        applyFixesNote: 'All recovery types',
+        rollback: 'Rollback',
+        rollbackNote: 'All recovery types',
+        modeAuto: 'Auto',
+        modeConfirm: 'Confirm',
+        effective: 'Effective Policy',
+        loading: 'Loading automation policy...',
+        loadFailed: 'Failed to load automation policy',
+      },
     },
     security: {
       apiToken: 'API Token',
diff --git a/web/src/i18n/ko.ts b/web/src/i18n/ko.ts
index 485942a..8382373 100644
--- a/web/src/i18n/ko.ts
+++ b/web/src/i18n/ko.ts
@@ -236,10 +236,16 @@ export const translations = {
       errorLoad: 'AI 기능을 불러오지 못했습니다',
       errorUpdate: '기능 업데이트에 실패했습니다',
       unavailable: '사용 불가',
+      comingSoon: '준비 중',
       modelDefault: '기본값',
       modelSelector: '모델',
       autoSetup: '자동 설정',
       autoSetupSuccess: 'AI 기능이 자동으로 설정되었습니다',
+      autoRecoveryNote:
+        'AI 에이전트 활성화 여부를 제어합니다. 복구 시 승인 정책은 운영 설정에서 관리합니다.',
+      operationsSettingsLink: '운영 설정',
+      restartRequired: '재시작 필요',
+      appliedImmediately: '즉시 적용',
       autoRecovery: {
         label: '자동 복구',
         description: '빌드 실패 시 자동으로 수정을 시도합니다',
@@ -402,6 +408,25 @@ export const translations = {
       save: '설정 저장',
       saving: '저장 중...',
       saved: '저장됨 ✓',
+      automation: {
+        title: '자동화 정책',
+        description: '복구 단계별 자동 실행 또는 수동 확인 여부를 설정합니다.',
+        fullAuto: '전체 자동',
+        fullAutoDesc: '모든 단계를 자동 실행으로 설정',
+        restart: '재시작',
+        restartNote: '컨테이너 복구에만 적용',
+        diagnosis: '진단',
+        diagnosisNote: '컨테이너 복구에만 적용',
+        applyFixes: '수정 적용',
+        applyFixesNote: '모든 복구에 적용',
+        rollback: '롤백',
+        rollbackNote: '모든 복구에 적용',
+        modeAuto: '자동',
+        modeConfirm: '확인',
+        effective: '적용 중인 정책',
+        loading: '자동화 정책 불러오는 중...',
+        loadFailed: '자동화 정책을 불러오지 못했습니다',
+      },
     },
     security: {
       apiToken: 'API 토큰',
diff --git a/web/src/lib/api/operations.ts b/web/src/lib/api/operations.ts
index 82c88ae..9ac94d3 100644
--- a/web/src/lib/api/operations.ts
+++ b/web/src/lib/api/operations.ts
@@ -241,3 +241,48 @@ export async function fetchDependencyGraph(): Promise<{
   if (!resp.ok) throw new Error(`fetchDependencyGraph failed: ${resp.status}`);
   return resp.json() as Promise<{ nodes: DependencyNode[]; edges: DependencyEdge[] }>;
 }
+
+// === Automation Policy types ===
+
+export type AutomationStep = 'restart' | 'diagnosis' | 'apply_fixes' | 'rollback';
+export type AutomationMode = 'auto' | 'confirm';
+export type AutomationPolicy = Record<AutomationStep, AutomationMode>;
+
+export interface AutomationDefaultsResponse {
+  defaults: AutomationPolicy;
+  effective: AutomationPolicy | null;
+  isAutopilot: boolean;
+}
+
+export interface ProjectAutomationResponse {
+  effective: AutomationPolicy | null;
+  overrides: Partial<AutomationPolicy> | null;
+  isAutopilot: boolean;
+}
+
+export async function fetchAutomationDefaults(): Promise<AutomationDefaultsResponse> {
+  const resp = await fetchWithAuth('/api/ops/automation/defaults');
+  if (!resp.ok) throw new Error(`fetchAutomationDefaults failed: ${resp.status}`);
+  return resp.json() as Promise<AutomationDefaultsResponse>;
+}
+
+export async function fetchProjectAutomation(
+  projectId: string,
+): Promise<ProjectAutomationResponse> {
+  const resp = await fetchWithAuth(`/api/ops/projects/${projectId}/automation`);
+  if (!resp.ok) throw new Error(`fetchProjectAutomation failed: ${resp.status}`);
+  return resp.json() as Promise<ProjectAutomationResponse>;
+}
+
+export async function updateProjectAutomation(
+  projectId: string,
+  automation: Partial<AutomationPolicy>,
+): Promise<ProjectAutomationResponse> {
+  const resp = await fetchWithAuth(`/api/ops/projects/${projectId}/automation`, {
+    method: 'PUT',
+    headers: { 'Content-Type': 'application/json' },
+    body: JSON.stringify({ automation }),
+  });
+  if (!resp.ok) throw new Error(`updateProjectAutomation failed: ${resp.status}`);
+  return resp.json() as Promise<ProjectAutomationResponse>;
+}

codex
The commit is larger than the requested focus, so I’m narrowing onto the backend paths that affect approval behavior and config reload semantics. Next I’m checking whether the new policy path actually preserves prior guarantees or silently broadens auto-execution.
exec
/bin/bash -lc "nl -ba src/pipeline/auto-recovery.ts | sed -n '1,240p'" in /home/lee/OpenLander
exec
/bin/bash -lc "nl -ba src/pipeline/auto-recovery.ts | sed -n '380,620p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { nanoid } from 'nanoid';
     2
     3	import type { ChatStreamEvent } from '../types/agent-events.js';
     4	import type { BuildDebugger } from './build-debugger.js';
     5	import type { Database } from '../db/index.js';
     6	import type { EventBus } from '../events/index.js';
     7	import type { EventPayload } from '../events/index.js';
     8	import type { QuestionBridge } from '../lib/question-bridge.js';
     9	import { createModuleLogger } from '../lib/logger.js';
    10	import { buildContextSnapshot } from '../llm/context-assembler.js';
    11	import { dispatchRecovery, type Locale, type RecoveryPlan } from './recovery-dispatch.js';
    12	import { matchRecipe, type RecipeAction } from './recipes.js';
    13	import type { DeployQueue } from './deploy-queue.js';
    14	import type { DeployPipeline } from './deploy.js';
    15	import type { OpenLanderConfig } from '../config/index.js';
    16	import { ApprovalGate, type ApprovalGate as ApprovalGateType } from './approval-gate.js';
    17	import { decisionEngine } from '../llm/decision.js';
    18	import type { PendingFixPatch } from './deploy/helpers.js';
    19	import { findMatchingPatterns, saveRecoveryPattern } from '../llm/memory.js';
    20	import type { ConfigurableRecoveryStep, RecoveryAutomationPolicy } from '../monitor/ops-types.js';
    21
    22	const log = createModuleLogger('auto-recovery');
    23
    24	const RECOVERY_OUTCOME_FALLBACK_TIMEOUT_MS = 300_000;
    25	const RECOVERY_OUTCOME_MAX_TIMEOUT_MS = 600_000;
    26	const RECOVERY_WINDOW_MS = 60 * 60 * 1000;
    27
    28	type RecoveryStrategy = 'recipe' | 'llm';
    29
    30	/** Maps high-risk tool names to their corresponding configurable recovery step. */
    31	export const TOOL_TO_RECOVERY_STEP: Record<string, ConfigurableRecoveryStep> = {
    32	  rollback_project: 'rollback',
    33	  remove_project: 'rollback',
    34	  platform_force_remove: 'rollback',
    35	  remove_service: 'rollback',
    36	  remove_volume: 'rollback',
    37	  create_database: 'apply_fixes',
    38	  platform_cleanup_orphans: 'apply_fixes',
    39	  platform_reconcile: 'apply_fixes',
    40	};
    41
    42	interface GateCheckResult {
    43	  blocked: boolean;
    44	  reason?: 'infra-error';
    45	}
    46
    47	export interface AutoRecoveryAgent {
    48	  chatStream(
    49	    input: string,
    50	    onEvent: (event: ChatStreamEvent) => Promise<void>,
    51	    sessionId?: string,
    52	    scope?: { type: string; projectId?: string },
    53	  ): Promise<void>;
    54	}
    55
    56	export interface SetupAutoRecoveryParams {
    57	  eventBus: EventBus;
    58	  agent: AutoRecoveryAgent | null;
    59	  db: Database;
    60	  buildDebugger: BuildDebugger | null;
    61	  deployQueue: DeployQueue;
    62	  pipeline: DeployPipeline;
    63	  questionBridge: QuestionBridge;
    64	  approvalGate?: ApprovalGateType;
    65	  language: Locale;
    66	  config: OpenLanderConfig;
    67	  shouldContinue?: (projectId: string) => boolean;
    68	  getAutomationPolicy?: (projectId: string) => RecoveryAutomationPolicy | null;
    69	}
    70
    71	export interface AutoRecoveryHandlers {
    72	  handleDeploymentRecovery(
    73	    projectId: string,
    74	    error: string,
    75	    step?: string,
    76	    buildLog?: string,
    77	    eventType?: 'deploy:failed' | 'compose:failed',
    78	  ): Promise<void>;
    79	  handleEnvNewKeysDetected(payload: EventPayload['env:new-keys-detected']): Promise<void>;
    80	  handleSecretDetected(payload: EventPayload['secret:detected']): Promise<void>;
    81	  handleRollbackSuggested(payload: EventPayload['rollback:suggested']): Promise<void>;
    82	  resolveApproval(actionRunId: string, approved: boolean): void;
    83	}
    84
    85	function normalizeError(error: string): string {
    86	  return error
    87	    .replace(/[0-9a-f]{8,}/gi, '<id>')
    88	    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}[^\s]*/g, '<timestamp>')
    89	    .replace(/:\d{4,5}/g, ':<port>')
    90	    .replace(/\s+/g, ' ')
    91	    .trim();
    92	}
    93
    94	function isRecent(createdAt: string, nowMs: number): boolean {
    95	  const ts = new Date(createdAt).getTime();
    96	  if (!Number.isFinite(ts)) {
    97	    return false;
    98	  }
    99	  return ts > nowMs - RECOVERY_WINDOW_MS;
   100	}
   101
   102	function getDynamicOutcomeTimeoutMs(db: Database, projectId: string): number {
   103	  const logs = db.getDeployLogs(projectId, 10);
   104	  const durations = logs
   105	    .map((logRow) => logRow.duration_ms)
   106	    .filter((duration): duration is number => typeof duration === 'number' && duration > 0);
   107
   108	  if (durations.length === 0) {
   109	    return RECOVERY_OUTCOME_FALLBACK_TIMEOUT_MS;
   110	  }
   111
   112	  const averageDuration =
   113	    durations.reduce((sum, duration) => sum + duration, 0) / Math.max(durations.length, 1);
   114
   115	  const buffered = Math.round(averageDuration * 1.5);
   116	  return Math.min(
   117	    Math.max(buffered, RECOVERY_OUTCOME_FALLBACK_TIMEOUT_MS),
   118	    RECOVERY_OUTCOME_MAX_TIMEOUT_MS,
   119	  );
   120	}
   121
   122	function runGateChecks(projectId: string, error: string, db: Database): GateCheckResult {
   123	  const infraPatterns = [
   124	    /docker daemon/i,
   125	    /cannot connect to docker/i,
   126	    /permission denied.*docker/i,
   127	  ];
   128	  if (infraPatterns.some((pattern) => pattern.test(error))) {
   129	    return { blocked: true, reason: 'infra-error' };
   130	  }
   131
   132	  void projectId;
   133	  void db;
   134
   135	  return { blocked: false };
   136	}
   137
   138	async function emitTimelineMessage(
   139	  eventBus: EventBus,
   140	  projectId: string,
   141	  content: string,
   142	): Promise<void> {
   143	  const event: ChatStreamEvent & { timestamp: string } = {
   144	    type: 'message',
   145	    content,
   146	    timestamp: new Date().toISOString(),
   147	  };
   148
   149	  await eventBus.emit('agent:event', {
   150	    projectId,
   151	    event,
   152	  });
   153	}
   154
   155	function waitForRecoveryOutcome(
   156	  eventBus: EventBus,
   157	  projectId: string,
   158	  timeoutMs: number,
   159	): Promise<{ success: boolean; timedOut: boolean }> {
   160	  return new Promise((resolve) => {
   161	    let settled = false;
   162	    let unsubscribeSuccess: () => void = () => undefined;
   163	    let unsubscribeFailed: () => void = () => undefined;
   164	    const subscribeOnce = eventBus['once'].bind(eventBus);
   165
   166	    const finalize = (success: boolean, timedOut: boolean): void => {
   167	      if (settled) {
   168	        return;
   169	      }
   170
   171	      settled = true;
   172	      clearTimeout(timer);
   173	      unsubscribeSuccess();
   174	      unsubscribeFailed();
   175	      resolve({ success, timedOut });
   176	    };
   177
   178	    const waitForSuccess = (): void => {
   179	      unsubscribeSuccess = subscribeOnce('deploy:success', (payload) => {
   180	        if (payload.projectId === projectId) {
   181	          finalize(true, false);
   182	          return;
   183	        }
   184
   185	        waitForSuccess();
   186	      });
   187	    };
   188
   189	    const waitForFailure = (): void => {
   190	      unsubscribeFailed = subscribeOnce('deploy:failed', (payload) => {
   191	        if (payload.projectId === projectId) {
   192	          finalize(false, false);
   193	          return;
   194	        }
   195
   196	        waitForFailure();
   197	      });
   198	    };
   199
   200	    waitForSuccess();
   201	    waitForFailure();
   202
   203	    const timer = setTimeout(() => {
   204	      finalize(false, true);
   205	    }, timeoutMs);
   206	  });
   207	}
   208
   209	function mapFailStep(step?: string): 'clone' | 'dockerfile' | 'build' | 'run' | 'runtime' {
   210	  if (step === 'clone' || step === 'dockerfile' || step === 'build' || step === 'run') {
   211	    return step;
   212	  }
   213
   214	  return 'runtime';
   215	}
   216
   217	function selectRecoveryStrategy(recipeMatched: boolean, hasAgent: boolean): RecoveryStrategy {
   218	  if (recipeMatched || !hasAgent) {
   219	    return 'recipe';
   220	  }
   221
   222	  return 'llm';
   223	}
   224
   225	function buildPendingFixFromAction(
   226	  action: RecipeAction,
   227	): { filePath: string; patches: PendingFixPatch[] } | null {
   228	  switch (action.type) {
   229	    case 'dockerfile_replace_pattern':
   230	      return {
   231	        filePath: 'Dockerfile',
   232	        patches: [{ pattern: action.pattern, replacement: action.replacement, flags: 'gm' }],
   233	      };
   234	    case 'dockerfile_add_line': {
   235	      const insertBefore = action.position === 'before';
   236	      const replacement = insertBefore ? `${action.line}\n$&` : `$&\n${action.line}`;
   237	      return {
   238	        filePath: 'Dockerfile',
   239	        patches: [{ pattern: action.anchor, replacement, flags: 'm' }],
   240	      };

 succeeded in 0ms:
   380	      : JSON.stringify({ strategy });
   381	    const trySavePattern = (success: boolean): void => {
   382	      try {
   383	        saveRecoveryPattern(db, projectId, error, fixActionStr, success, plan.category);
   384	      } catch (patternErr) {
   385	        log.warn({ err: patternErr, projectId }, 'Failed to save recovery pattern');
   386	      }
   387	    };
   388	    const actionRunId = db.createActionRun({
   389	      projectId,
   390	      triggerSource: 'auto_recovery',
   391	      recoveryStrategy: matchingPatterns.length > 0 ? 'memory' : strategy,
   392	      correlationId: projectId,
   393	    });
   394
   395	    await eventBus.emit('recovery:start', {
   396	      projectId,
   397	      error,
   398	      attempt,
   399	      correlationId: projectId,
   400	    });
   401
   402	    questionBridge.setActiveProject(projectId);
   403
   404	    const project = db.getProject(projectId);
   405	    const projectName = project?.name ?? projectId;
   406
   407	    if (strategy === 'llm' && agent) {
   408	      await emitTimelineMessage(
   409	        eventBus,
   410	        projectId,
   411	        'AI is analyzing the failure and attempting to fix it...',
   412	      );
   413
   414	      try {
   415	        const sessionId = nanoid(12);
   416	        const contextSnapshot = await buildContextSnapshot(db);
   417	        // Snapshot automation policy at session start so mid-recovery config changes
   418	        // don't affect the current session
   419	        const policySnapshot = getAutomationPolicy?.(projectId) ?? null;
   420	        const approvalState: {
   421	          blocked: 'rejected' | 'timed_out' | 'aborted' | null;
   422	          toolName?: string;
   423	        } = { blocked: null };
   424	        let recoveryMessage = `Deploy of "${projectName}" failed.
   425
   426	## Failure Context
   427	- Project: ${projectName} (${projectId})
   428	- Failed Step: ${step ?? 'unknown'}
   429	- Error: ${error}${
   430	          buildLog
   431	            ? `
   432
   433	## Build Log (last 3000 chars)
   434	${buildLog.slice(-3000)}`
   435	            : ''
   436	        }
   437
   438	## Server Context Snapshot
   439	${contextSnapshot}
   440
   441	${plan.agentGuidance}
   442
   443	## General Recovery Rules
   444	1. If build log is provided above, analyze it directly. Otherwise call debug_build_error("${projectName}").
   445	2. After fixing, redeploy with create_deploy_plan and execute_deploy_plan.
   446	3. Do NOT just suggest fixes - execute them.`;
   447
   448	        if (isAdvisory) {
   449	          recoveryMessage +=
   450	            "\n\nThis appears to be an infrastructure resource issue. You likely cannot fix this via tools alone. Diagnose the issue, explain it clearly, and suggest manual steps (e.g., docker system prune, increase memory). Do NOT retry the deploy unless you've confirmed the resource issue is resolved.";
   451	        }
   452
   453	        await agent.chatStream(
   454	          recoveryMessage,
   455	          async (event) => {
   456	            if (event.type === 'tool_call' && !shouldContinue(projectId)) {
   457	              approvalState.blocked = 'aborted';
   458	              log.info(
   459	                { projectId },
   460	                'shouldContinue: project no longer eligible, stopping recovery tool execution',
   461	              );
   462	              return;
   463	            }
   464
   465	            if (
   466	              event.type === 'tool_call' &&
   467	              decisionEngine.classify(event.toolName) === 'REQUIRE_APPROVAL'
   468	            ) {
   469	              // Check automation policy before requiring manual approval
   470	              const mappedStep = TOOL_TO_RECOVERY_STEP[event.toolName];
   471	              if (policySnapshot && mappedStep) {
   472	                const stepMode = policySnapshot[mappedStep];
   473	                if (stepMode === 'auto') {
   474	                  // Policy says auto — skip approval gate, emit audit event
   475	                  await eventBus.emit('recovery:approval-auto-skipped', {
   476	                    projectId,
   477	                    actionRunId,
   478	                    toolName: event.toolName,
   479	                    recoveryStep: mappedStep,
   480	                    correlationId: projectId,
   481	                  });
   482	                  log.info(
   483	                    { projectId, toolName: event.toolName, recoveryStep: mappedStep },
   484	                    'Approval skipped by automation policy (auto mode)',
   485	                  );
   486	                  // Fall through — no approval needed
   487	                } else {
   488	                  // Policy says confirm — existing approval behavior
   489	                  const approvalMetadata = {
   490	                    projectId,
   491	                    projectName,
   492	                    toolName: event.toolName,
   493	                    attempt,
   494	                    actionRunId,
   495	                    createdAt: new Date(),
   496	                  };
   497
   498	                  await eventBus.emit('recovery:approval-needed', {
   499	                    projectId,
   500	                    actionRunId,
   501	                    toolName: event.toolName,
   502	                    attempt,
   503	                    correlationId: projectId,
   504	                  });
   505
   506	                  db.updateActionRunStatus(actionRunId, 'pending_approval');
   507	                  db.updateActionRunApproval(actionRunId, 'pending', event.toolName);
   508	                  approvalState.toolName = event.toolName;
   509	                  const approvalResult = await approvalGate.waitForApproval(
   510	                    actionRunId,
   511	                    approvalMetadata,
   512	                  );
   513
   514	                  if (approvalResult === 'rejected') {
   515	                    approvalState.blocked = 'rejected';
   516	                    db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
   517	                    return;
   518	                  }
   519
   520	                  if (approvalResult === 'timed_out') {
   521	                    approvalState.blocked = 'timed_out';
   522	                    db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
   523	                    return;
   524	                  }
   525
   526	                  db.updateActionRunStatus(actionRunId, 'running');
   527	                  db.updateActionRunApproval(actionRunId, 'approved', event.toolName);
   528	                }
   529	              } else {
   530	                // No policy or tool not mapped — fall back to DecisionEngine behavior
   531	                const approvalMetadata = {
   532	                  projectId,
   533	                  projectName,
   534	                  toolName: event.toolName,
   535	                  attempt,
   536	                  actionRunId,
   537	                  createdAt: new Date(),
   538	                };
   539
   540	                await eventBus.emit('recovery:approval-needed', {
   541	                  projectId,
   542	                  actionRunId,
   543	                  toolName: event.toolName,
   544	                  attempt,
   545	                  correlationId: projectId,
   546	                });
   547
   548	                db.updateActionRunStatus(actionRunId, 'pending_approval');
   549	                db.updateActionRunApproval(actionRunId, 'pending', event.toolName);
   550	                approvalState.toolName = event.toolName;
   551	                const approvalResult = await approvalGate.waitForApproval(
   552	                  actionRunId,
   553	                  approvalMetadata,
   554	                );
   555
   556	                if (approvalResult === 'rejected') {
   557	                  approvalState.blocked = 'rejected';
   558	                  db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
   559	                  return;
   560	                }
   561
   562	                if (approvalResult === 'timed_out') {
   563	                  approvalState.blocked = 'timed_out';
   564	                  db.updateActionRunApproval(actionRunId, 'rejected', event.toolName);
   565	                  return;
   566	                }
   567
   568	                db.updateActionRunStatus(actionRunId, 'running');
   569	                db.updateActionRunApproval(actionRunId, 'approved', event.toolName);
   570	              }
   571	            }
   572
   573	            await eventBus.emit('agent:event', {
   574	              projectId,
   575	              event: { ...event, timestamp: new Date().toISOString() },
   576	            });
   577	          },
   578	          sessionId,
   579	          { type: 'recovery', projectId },
   580	        );
   581
   582	        if (approvalState.blocked) {
   583	          const failureReason =
   584	            approvalState.blocked === 'aborted'
   585	              ? 'Recovery aborted because project is no longer eligible to continue'
   586	              : 'High-risk tool was rejected or timed out';
   587	          db.updateActionRunStatus(actionRunId, 'failed', failureReason);
   588	          if (approvalState.blocked === 'aborted') {
   589	            await eventBus.emit('recovery:stopped', {
   590	              projectId,
   591	              reason: failureReason,
   592	              correlationId: projectId,
   593	            });
   594	          } else {
   595	            await eventBus.emit('recovery:failed', {
   596	              projectId,
   597	              error: failureReason,
   598	              attempt,
   599	              correlationId: projectId,
   600	            });
   601	          }
   602	          trySavePattern(false);
   603	          return;
   604	        }
   605
   606	        const timeoutMs = getDynamicOutcomeTimeoutMs(db, projectId);
   607	        const outcome = await waitForRecoveryOutcome(eventBus, projectId, timeoutMs);
   608	        const durationMs = Date.now() - recoveryStartTime;
   609	        if (outcome.success) {
   610	          db.updateActionRunStatus(actionRunId, 'succeeded');
   611	          await eventBus.emit('recovery:success', {
   612	            projectId,
   613	            attempt,
   614	            durationMs,
   615	            lastError: normalizedError,
   616	            correlationId: projectId,
   617	          });
   618	          trySavePattern(true);
   619	        } else {
   620	          const failureReason = outcome.timedOut

exec
/bin/bash -lc "nl -ba src/monitor/ops-agent.ts | sed -n '420,470p'" in /home/lee/OpenLander
 succeeded in 0ms:
   420	    const existing = (this.llmCallsPerProject.get(projectId) ?? []).filter((t) => t > hourAgo);
   421	    this.llmCallsPerProject.set(projectId, [...existing, now]);
   422
   423	    const cleanGlobal = this.llmCallsGlobal.filter((t) => t > hourAgo);
   424	    this.llmCallsGlobal.length = 0;
   425	    this.llmCallsGlobal.push(...cleanGlobal, now);
   426	  }
   427
   428	  getConfig(): OpsConfig {
   429	    return this.config;
   430	  }
   431
   432	  reloadConfig(config: Partial<OpsConfig>): void {
   433	    const raw = config as Record<string, unknown>;
   434	    if ('auto_restart' in raw && !('recovery' in raw)) {
   435	      raw['recovery'] = {
   436	        enabled: Boolean(raw['auto_restart']),
   437	        automation: DEFAULT_RECOVERY_AUTOMATION,
   438	      };
   439	      delete raw['auto_restart'];
   440	    }
   441
   442	    // Deep-merge recovery sub-object to preserve unset fields,
   443	    // including nested automation policy
   444	    if (config.recovery) {
   445	      config = {
   446	        ...config,
   447	        recovery: {
   448	          ...this.config.recovery,
   449	          ...config.recovery,
   450	          automation: {
   451	            ...this.config.recovery.automation,
   452	            ...config.recovery.automation,
   453	          },
   454	        },
   455	      };
   456	    }
   457
   458	    this.config = { ...this.config, ...config };
   459	    this.config.auto_restart = this.config.recovery.enabled;
   460	    this.alerting.updateConfig(this.config);
   461
   462	    const digestTime = this.config.thresholds.digest_time;
   463	    if (digestTime) {
   464	      this.digest.scheduleDigest(digestTime);
   465	    } else {
   466	      this.digest.stopSchedule();
   467	    }
   468	  }
   469	}

exec
/bin/bash -lc "nl -ba src/app.ts | sed -n '388,420p'" in /home/lee/OpenLander
 succeeded in 0ms:
   388	      log.error({ error }, 'Unhandled error in deploy:failed event handler');
   389	    }
   390	  });
   391
   392	  const recoveryHandlers = setupAutoRecovery({
   393	    eventBus,
   394	    agent: autoRecoveryEnabled ? agent : null,
   395	    db,
   396	    buildDebugger: buildDebuggerEnabled ? buildDebugger : null,
   397	    deployQueue,
   398	    pipeline,
   399	    questionBridge,
   400	    approvalGate,
   401	    language: config.language,
   402	    config,
   403	    shouldContinue: (projectId) => coordinator.shouldContinue(projectId),
   404	    getAutomationPolicy: (projectId) => {
   405	      const opsConfig = config.ops;
   406	      const override = db.getProjectOpsOverride(projectId);
   407	      return resolveAutomationPolicy(opsConfig, override ?? undefined);
   408	    },
   409	  });
   410	  coordinator.setDeploymentRecovery((projectId, error, step, buildLog) =>
   411	    recoveryHandlers.handleDeploymentRecovery(projectId, error, step, buildLog),
   412	  );
   413
   414	  eventBus.on('env:new-keys-detected', (payload) => {
   415	    void recoveryHandlers.handleEnvNewKeysDetected(payload);
   416	  });
   417	  eventBus.on('secret:detected', (payload) => {
   418	    void recoveryHandlers.handleSecretDetected(payload);
   419	  });
   420	  eventBus.on('rollback:suggested', (payload) => {

codex
I’ve isolated the main control flow. Now I’m checking the supporting types and the existing approval classifier to verify the mapping is exhaustive in the right direction, not just internally self-consistent.
exec
/bin/bash -lc 'rg -n "REQUIRE_APPROVAL|HIGH_RISK_DEFAULTS|rollback_project|platform_reconcile|create_database|remove_volume|remove_service|platform_force_remove|remove_project|platform_cleanup_orphans" src test' in /home/lee/OpenLander
 succeeded in 0ms:
src/pipeline/auto-recovery.ts:32:  rollback_project: 'rollback',
src/pipeline/auto-recovery.ts:33:  remove_project: 'rollback',
src/pipeline/auto-recovery.ts:34:  platform_force_remove: 'rollback',
src/pipeline/auto-recovery.ts:35:  remove_service: 'rollback',
src/pipeline/auto-recovery.ts:36:  remove_volume: 'rollback',
src/pipeline/auto-recovery.ts:37:  create_database: 'apply_fixes',
src/pipeline/auto-recovery.ts:38:  platform_cleanup_orphans: 'apply_fixes',
src/pipeline/auto-recovery.ts:39:  platform_reconcile: 'apply_fixes',
src/pipeline/auto-recovery.ts:467:              decisionEngine.classify(event.toolName) === 'REQUIRE_APPROVAL'
test/tool-registry.test.ts:26:  'rollback_project',
test/tool-registry.test.ts:51:  'remove_service',
test/pipeline/approval-gate.test.ts:13:    toolName: 'rollback_project',
test/pipeline/approval-gate.test.ts:103:      toolName: 'rollback_project',
test/pipeline/approval-gate.test.ts:107:      toolName: 'create_database',
test/pipeline/approval-gate.test.ts:121:    ).toBe('rollback_project');
test/llm/agent-decision.test.ts:87:    rollback_project: { execute: toolExecuteMock },
test/llm/agent-decision.test.ts:149:    scenario.toolName = 'rollback_project';
test/llm/agent-decision.test.ts:181:    scenario.toolName = 'rollback_project';
test/llm/agent-decision.test.ts:213:        event.toolName === 'rollback_project' &&
test/llm/decision.test.ts:15:  it('high riskLevel → REQUIRE_APPROVAL', () => {
test/llm/decision.test.ts:16:    expect(engine.classify('any_tool', 'high')).toBe('REQUIRE_APPROVAL');
test/llm/decision.test.ts:19:  it('rollback_project → REQUIRE_APPROVAL', () => {
test/llm/decision.test.ts:20:    expect(engine.classify('rollback_project')).toBe('REQUIRE_APPROVAL');
test/llm/decision.test.ts:23:  it('remove_service → REQUIRE_APPROVAL', () => {
test/llm/decision.test.ts:24:    expect(engine.classify('remove_service')).toBe('REQUIRE_APPROVAL');
test/llm/decision.test.ts:27:  it('create_database → REQUIRE_APPROVAL', () => {
test/llm/decision.test.ts:28:    expect(engine.classify('create_database')).toBe('REQUIRE_APPROVAL');
test/mcp/tool-registry-snapshot.test.ts:71:  'remove_service',
test/mcp/tool-registry-snapshot.test.ts:72:  'remove_volume',
test/mcp/tool-registry-snapshot.test.ts:75:  'rollback_project',
test/mcp/composite-routing.test.ts:82:    it('routes rollback_project action (validates params)', async () => {
test/mcp/composite-routing.test.ts:84:        { action: 'rollback_project', params: {} },
test/mcp/composite-routing.test.ts:88:      expect(result).toHaveProperty('action', 'rollback_project');
test/mcp/composite-routing.test.ts:181:    it('routes remove_service action (validates params)', async () => {
test/mcp/composite-routing.test.ts:183:        { action: 'remove_service', params: {} },
test/mcp/composite-routing.test.ts:187:      expect(result).toHaveProperty('action', 'remove_service');
test/pipeline/auto-recovery.test.ts:297:        toolName: 'rollback_project',
test/pipeline/auto-recovery.test.ts:327:      expect(pendingRun.approval_tool).toBe('rollback_project');
test/pipeline/auto-recovery.test.ts:356:        toolName: 'rollback_project',
test/pipeline/auto-recovery.test.ts:534:  it('skips approval gate when automationPolicy.rollback is auto for rollback_project tool', async () => {
test/pipeline/auto-recovery.test.ts:540:        toolName: 'rollback_project',
test/pipeline/auto-recovery.test.ts:587:          toolName: 'rollback_project',
test/pipeline/auto-recovery.test.ts:601:  it('triggers approval gate when automationPolicy.rollback is confirm for rollback_project tool', async () => {
test/pipeline/auto-recovery.test.ts:607:        toolName: 'rollback_project',
test/pipeline/auto-recovery.test.ts:647:      expect(pendingRun.approval_tool).toBe('rollback_project');
test/pipeline/auto-recovery.test.ts:654:          toolName: 'rollback_project',
test/pipeline/auto-recovery.test.ts:674:        toolName: 'rollback_project',
test/pipeline/auto-recovery.test.ts:705:      // With null policy, DecisionEngine classifies rollback_project as REQUIRE_APPROVAL
test/pipeline/auto-recovery.test.ts:779:  it('TOOL_TO_RECOVERY_STEP maps every HIGH_RISK_DEFAULTS tool to a configurable step', () => {
test/pipeline/auto-recovery.test.ts:780:    // These are the exact tools DecisionEngine classifies as REQUIRE_APPROVAL by default.
test/pipeline/auto-recovery.test.ts:783:      'rollback_project',
test/pipeline/auto-recovery.test.ts:784:      'remove_project',
test/pipeline/auto-recovery.test.ts:785:      'remove_service',
test/pipeline/auto-recovery.test.ts:786:      'create_database',
test/pipeline/auto-recovery.test.ts:787:      'platform_cleanup_orphans',
test/pipeline/auto-recovery.test.ts:788:      'platform_reconcile',
test/pipeline/auto-recovery.test.ts:789:      'platform_force_remove',
test/pipeline/auto-recovery.test.ts:790:      'remove_volume',
test/tools/deploy-lock-mcp-tools.test.ts:99:  it('rollback_project returns DEPLOY_LOCKED response when project lock is held', async () => {
test/tools/deploy-lock-mcp-tools.test.ts:101:    const tool = getTool(ctx, 'rollback_project');
src/pipeline/preflight.ts:205:          detail: `Container "${containerName}" already exists (${existingContainer.managedByOpenLander ? 'managed' : 'external'}, ${existingContainer.state}). Use restart_project to redeploy, or remove_project first.`,
test/web/tool-result-card.test.tsx:96:  it('renders rollback_project with compact structured view', () => {
test/web/tool-result-card.test.tsx:103:      toolName: 'rollback_project',
test/tools/platform-actions.test.ts:95:      'platform_cleanup_orphans',
test/tools/platform-actions.test.ts:96:      'platform_reconcile',
test/tools/platform-actions.test.ts:97:      'platform_force_remove',
test/tools/platform-actions.test.ts:105:  it('platform_cleanup_orphans rejects confirm=false', async () => {
test/tools/platform-actions.test.ts:109:      getTool('platform_cleanup_orphans').execute(
test/tools/platform-actions.test.ts:116:  it('platform_reconcile rejects confirm=false', async () => {
test/tools/platform-actions.test.ts:120:      getTool('platform_reconcile').execute({ confirm: false }, { target: 'mcp', appCtx: ctx }),
test/tools/platform-actions.test.ts:124:  it('platform_force_remove rejects confirm=false', async () => {
test/tools/platform-actions.test.ts:128:      getTool('platform_force_remove').execute(
test/tools/platform-actions.test.ts:135:  it('platform_cleanup_orphans dry_run lists orphan and does not remove', async () => {
test/tools/platform-actions.test.ts:145:    const result = (await getTool('platform_cleanup_orphans').execute(
test/tools/platform-actions.test.ts:165:  it('platform_cleanup_orphans skips infrastructure containers', async () => {
test/tools/platform-actions.test.ts:178:    const result = (await getTool('platform_cleanup_orphans').execute(
test/tools/platform-actions.test.ts:194:  it('platform_cleanup_orphans executes stop+remove when dry_run=false', async () => {
test/tools/platform-actions.test.ts:199:    const result = (await getTool('platform_cleanup_orphans').execute(
test/tools/platform-actions.test.ts:215:  it('platform_reconcile marks ghost project records as error', async () => {
test/tools/platform-actions.test.ts:222:    const result = (await getTool('platform_reconcile').execute(
test/tools/platform-actions.test.ts:237:  it('platform_reconcile dry_run returns actions without mutation', async () => {
test/tools/platform-actions.test.ts:244:    const result = (await getTool('platform_reconcile').execute(
test/tools/platform-actions.test.ts:264:  it('platform_reconcile removes orphan managed containers when executing', async () => {
test/tools/platform-actions.test.ts:269:    const result = (await getTool('platform_reconcile').execute(
test/tools/platform-actions.test.ts:283:  it('platform_force_remove protects infrastructure containers', async () => {
test/tools/platform-actions.test.ts:291:      getTool('platform_force_remove').execute(
test/tools/platform-actions.test.ts:301:  it('platform_force_remove returns not_found for missing container', async () => {
test/tools/platform-actions.test.ts:305:    const result = await getTool('platform_force_remove').execute(
test/tools/platform-actions.test.ts:315:  it('platform_force_remove stops and removes non-protected container', async () => {
test/tools/platform-actions.test.ts:322:    const result = await getTool('platform_force_remove').execute(
test/volume-minio.test.ts:282:      'remove_volume',
test/volume-minio.test.ts:405:  it('list_volumes maps labels and remove_volume rejects unmanaged then succeeds for managed volume', async () => {
test/volume-minio.test.ts:408:    const removeVolumeTool = getMcpTool(ctx, 'remove_volume');
src/monitor/alerts.ts:734:        'Remove them with platform_cleanup_orphans or docker rm.';
test/web/api/approval-routes.test.ts:19:    toolName: 'rollback_project',
src/llm/agent-pool.ts:19:  'rollback_project',
src/llm/agent-pool.ts:21:  'remove_project',
src/llm/agent.ts:507:            decision === 'REQUIRE_APPROVAL' &&
src/llm/decision.ts:2:export type Decision = 'ALLOW' | 'NOTIFY_THEN_ALLOW' | 'REQUIRE_APPROVAL';
src/llm/decision.ts:4:const HIGH_RISK_DEFAULTS = new Set([
src/llm/decision.ts:5:  'rollback_project',
src/llm/decision.ts:6:  'remove_project',
src/llm/decision.ts:7:  'remove_service',
src/llm/decision.ts:8:  'create_database',
src/llm/decision.ts:9:  'platform_cleanup_orphans',
src/llm/decision.ts:10:  'platform_reconcile',
src/llm/decision.ts:11:  'platform_force_remove',
src/llm/decision.ts:12:  'remove_volume',
src/llm/decision.ts:44:        return 'REQUIRE_APPROVAL';
src/llm/decision.ts:49:    if (HIGH_RISK_DEFAULTS.has(toolName)) {
src/llm/prompts.ts:131:**Confirmations**: When the user names a specific project and action unambiguously ("재배포해줘 frontend", "restart api"), execute immediately — no re-confirming. ALWAYS confirm for destructive actions (remove_project, stop all, delete data).
src/llm/prompts.ts:173:| Remove a project entirely     | remove_project       | Confirm first — this deletes everything. |
src/llm/prompts.ts:185:| Rollback a bad deploy         | rollback_project     | Reverts to previous Docker image.        |
src/llm/prompts.ts:329:3. Only call remove_project if user confirms
src/llm/prompts.ts:339:| "삭제해줘", "remove frontend"              | remove_project (CONFIRM FIRST!) |
src/llm/prompts.ts:514:3. If agreed, call rollback_project with the project_name (e.g., rollback_project("my-app"))
test/mcp-service-tools.test.ts:96:      'remove_service',
test/mcp-service-tools.test.ts:111:      'remove_service',
test/mcp-service-tools.test.ts:322:    const removeTool = getTool(ctx, 'remove_service');
src/mcp/composite-tools.ts:37:  'rollback_project',
src/mcp/composite-tools.ts:105:  'remove_service',
src/mcp/composite-tools.ts:116:  'remove_volume',
src/mcp/composite-tools.ts:158:  'platform_cleanup_orphans',
src/mcp/composite-tools.ts:159:  'platform_force_remove',
src/mcp/composite-tools.ts:173: * The 1-off is because create_database / list_databases were not included (create_service_database merged into create_database, but create_database itself is service.ts:205-235 which targets 'agent')
src/mcp/server.ts:80:- rollback_project — Revert to previous Docker image.
src/mcp/server.ts:93:- start_service / stop_service / remove_service — Lifecycle management. IMPORTANT: remove_service deletes ALL data. Always backup_service first.
src/mcp/server.ts:100:- remove_volume — Delete a volume. Container must be stopped first. WARNING: permanently deletes all data.
src/mcp/server.ts:296:Key actions: deploy, create_deploy_plan, execute_deploy_plan, get_deploy_status, rollback_project, get_build_log
src/tools/defs/volume.ts:226:    name: 'remove_volume',
src/tools/defs/volume.ts:266:            `Volume "${dockerVolumeName}" is currently in use by a container. Stop the container first, then retry remove_volume.`,
src/tools/defs/deploy.ts:71:    name: 'rollback_project',
src/tools/defs/platform-actions.ts:30:    name: 'platform_cleanup_orphans',
src/tools/defs/platform-actions.ts:40:      ensureConfirmed(confirm, 'platform_cleanup_orphans');
src/tools/defs/platform-actions.ts:92:    name: 'platform_reconcile',
src/tools/defs/platform-actions.ts:102:      ensureConfirmed(confirm, 'platform_reconcile');
src/tools/defs/platform-actions.ts:188:    name: 'platform_force_remove',
src/tools/defs/platform-actions.ts:197:      ensureConfirmed(confirm, 'platform_force_remove');
src/tools/defs/service.ts:204:    name: 'create_database',
src/tools/defs/service.ts:401:    name: 'remove_service',
src/tools/defs/service.ts:416:        warning: `All persistent data for ${serviceType} service "${serviceName}" has been permanently deleted. This cannot be undone. If you needed the data, it is now lost. Use backup_service before remove_service in the future.`,
src/tools/defs/service.ts:426:      "Create a backup snapshot of a service's persistent data (database files, etc.). Returns { status, backupId, path, sizeBytes }. Use BEFORE remove_service to prevent data loss.",

exec
/bin/bash -lc "nl -ba src/llm/decision.ts | sed -n '1,220p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	export type RiskLevel = 'low' | 'medium' | 'high';
     2	export type Decision = 'ALLOW' | 'NOTIFY_THEN_ALLOW' | 'REQUIRE_APPROVAL';
     3
     4	const HIGH_RISK_DEFAULTS = new Set([
     5	  'rollback_project',
     6	  'remove_project',
     7	  'remove_service',
     8	  'create_database',
     9	  'platform_cleanup_orphans',
    10	  'platform_reconcile',
    11	  'platform_force_remove',
    12	  'remove_volume',
    13	]);
    14
    15	const READ_ONLY_TOOLS = new Set([
    16	  'get_logs',
    17	  'get_deploy_status',
    18	  'get_project_stats',
    19	  'get_server_stats',
    20	  'list_projects',
    21	  'list_env_vars',
    22	  'list_services',
    23	  'list_domains',
    24	  'get_project',
    25	  'get_service',
    26	  'get_system_info',
    27	  'list_volumes',
    28	  'get_deploy_logs',
    29	  'get_container_stats',
    30	  'scan_dockerfiles',
    31	  'detect_services',
    32	  'get_build_logs',
    33	]);
    34
    35	export class DecisionEngine {
    36	  classify(toolName: string, riskLevel?: RiskLevel): Decision {
    37	    const level = riskLevel ?? this.getDefaultRisk(toolName);
    38	    switch (level) {
    39	      case 'low':
    40	        return 'ALLOW';
    41	      case 'medium':
    42	        return 'NOTIFY_THEN_ALLOW';
    43	      case 'high':
    44	        return 'REQUIRE_APPROVAL';
    45	    }
    46	  }
    47
    48	  private getDefaultRisk(toolName: string): RiskLevel {
    49	    if (HIGH_RISK_DEFAULTS.has(toolName)) {
    50	      return 'high';
    51	    }
    52	    if (READ_ONLY_TOOLS.has(toolName)) {
    53	      return 'low';
    54	    }
    55	    return 'medium';
    56	  }
    57	}
    58
    59	export const decisionEngine = new DecisionEngine();

exec
/bin/bash -lc "nl -ba src/monitor/ops-config-resolver.ts | sed -n '1,240p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	/**
     2	 * OpsConfig Resolver
     3	 *
     4	 * Resolves the effective automation policy for recovery operations.
     5	 * Implements 3-tier merge: DEFAULT → globalConfig.recovery.automation → projectOverride?.automation
     6	 */
     7
     8	import {
     9	  type ConfigurableRecoveryStep,
    10	  type OpsConfig,
    11	  type ProjectOpsOverride,
    12	  type RecoveryAutomationPolicy,
    13	  DEFAULT_RECOVERY_AUTOMATION,
    14	} from './ops-types.js';
    15
    16	/**
    17	 * Resolves the effective automation policy for a recovery operation.
    18	 * Applies 3-tier merge: DEFAULT → globalConfig.recovery.automation → projectOverride?.automation
    19	 *
    20	 * Returns null if recovery is disabled (globalConfig.recovery.enabled === false).
    21	 *
    22	 * @param globalConfig - The global OpsConfig
    23	 * @param projectOverride - Optional project-level overrides
    24	 * @returns The resolved RecoveryAutomationPolicy, or null if recovery is disabled
    25	 */
    26	export function resolveAutomationPolicy(
    27	  globalConfig: OpsConfig,
    28	  projectOverride?: ProjectOpsOverride,
    29	): RecoveryAutomationPolicy | null {
    30	  if (!globalConfig.recovery.enabled) {
    31	    return null;
    32	  }
    33
    34	  const steps: ConfigurableRecoveryStep[] = ['restart', 'diagnosis', 'apply_fixes', 'rollback'];
    35
    36	  // Start with defaults, then layer global config (required — always present)
    37	  const result: RecoveryAutomationPolicy = { ...DEFAULT_RECOVERY_AUTOMATION };
    38	  const globalAutomation = globalConfig.recovery.automation as Partial<RecoveryAutomationPolicy>;
    39	  for (const step of steps) {
    40	    const val = globalAutomation[step];
    41	    if (val !== undefined) {
    42	      result[step] = val;
    43	    }
    44	  }
    45
    46	  // Layer 3: project override (Partial — only defined steps override)
    47	  if (projectOverride?.automation) {
    48	    for (const step of steps) {
    49	      const override = projectOverride.automation[step];
    50	      if (override !== undefined) {
    51	        result[step] = override;
    52	      }
    53	    }
    54	  }
    55
    56	  return result;
    57	}
    58
    59	/**
    60	 * Returns true if all steps in the policy are set to 'auto' (no human confirmation needed).
    61	 *
    62	 * @param policy - The RecoveryAutomationPolicy to check
    63	 * @returns true if all steps are 'auto', false otherwise
    64	 */
    65	export function isAutopilot(policy: RecoveryAutomationPolicy): boolean {
    66	  const steps: ConfigurableRecoveryStep[] = ['restart', 'diagnosis', 'apply_fixes', 'rollback'];
    67	  return steps.every((step) => policy[step] === 'auto');
    68	}

exec
/bin/bash -lc "nl -ba src/monitor/ops-types.ts | sed -n '1,240p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	/**
     2	 * OpsAgent Type System
     3	 *
     4	 * All type definitions for the OpsAgent module.
     5	 * No implementation — pure TypeScript types and interfaces.
     6	 */
     7
     8	export type AlertSeverity = 'critical' | 'warning' | 'info';
     9	export type IncidentStatus = 'open' | 'active' | 'resolved' | 'escalated';
    10	export type RecoveryStepType =
    11	  | 'restart'
    12	  | 'healthcheck'
    13	  | 'diagnosis'
    14	  | 'fix'
    15	  | 'rollback'
    16	  | 'escalate';
    17	export type RecoveryStepStatus =
    18	  | 'pending'
    19	  | 'running'
    20	  | 'succeeded'
    21	  | 'failed'
    22	  | 'pending_approval';
    23
    24	export type RecoveryStepMode = 'auto' | 'confirm';
    25	export type ConfigurableRecoveryStep = 'restart' | 'diagnosis' | 'apply_fixes' | 'rollback';
    26	export type RecoveryAutomationPolicy = Record<ConfigurableRecoveryStep, RecoveryStepMode>;
    27
    28	export interface ProjectOpsOverride {
    29	  automation?: Partial<RecoveryAutomationPolicy>;
    30	}
    31
    32	export interface RecoveryConfig {
    33	  enabled: boolean;
    34	  automation: RecoveryAutomationPolicy;
    35	}
    36
    37	export interface OpsAlert {
    38	  severity: AlertSeverity;
    39	  project: { id: string; name: string };
    40	  event_type: string;
    41	  title: string;
    42	  description: string;
    43	  context: Record<string, unknown>;
    44	  suggestion: string | null;
    45	  actions_taken: string[];
    46	  incident_id: string | null;
    47	  timestamp: number;
    48	}
    49
    50	export interface OpsEvent {
    51	  type: string;
    52	  payload: unknown;
    53	  timestamp: number;
    54	}
    55
    56	export interface OpsRecoveryStep {
    57	  step: RecoveryStepType;
    58	  status: RecoveryStepStatus;
    59	  started_at: number;
    60	  completed_at: number | null;
    61	  result: string | null;
    62	}
    63
    64	export interface OpsConfig {
    65	  enabled: boolean;
    66	  recovery: RecoveryConfig;
    67	  auto_restart: boolean; // Derived from recovery.enabled for frontend compatibility
    68	  auto_cleanup: boolean;
    69	  drift_detection: boolean;
    70	  production_only: boolean;
    71	  thresholds: {
    72	    disk_cleanup_percent: number; // default 80
    73	    recovery_max_per_day: number; // default 5
    74	    alert_dedup_minutes: number; // default 15
    75	    digest_time: string; // default "09:00"
    76	  };
    77	  channels: {
    78	    email?: {
    79	      host: string;
    80	      port: number;
    81	      secure: boolean;
    82	      auth: { user: string; pass: string };
    83	      from: string;
    84	      to: string[];
    85	    };
    86	  };
    87	}
    88
    89	export interface CircuitBreakerConfig {
    90	  max_failures: number; // default 5
    91	  window_hours: number; // default 24
    92	  half_open_probe_interval_ms: number; // default 3600000 (1h)
    93	}
    94
    95	export const DEFAULT_RECOVERY_AUTOMATION: RecoveryAutomationPolicy = {
    96	  restart: 'auto',
    97	  diagnosis: 'auto',
    98	  apply_fixes: 'confirm',
    99	  rollback: 'confirm',
   100	};
   101
   102	export const DEFAULT_RECOVERY_CONFIG: RecoveryConfig = {
   103	  enabled: true,
   104	  automation: DEFAULT_RECOVERY_AUTOMATION,
   105	};
   106
   107	export const DEFAULT_OPS_CONFIG: OpsConfig = {
   108	  enabled: true,
   109	  recovery: DEFAULT_RECOVERY_CONFIG,
   110	  auto_restart: true,
   111	  auto_cleanup: true,
   112	  drift_detection: true,
   113	  production_only: true,
   114	  thresholds: {
   115	    disk_cleanup_percent: 80,
   116	    recovery_max_per_day: 5,
   117	    alert_dedup_minutes: 15,
   118	    digest_time: '09:00',
   119	  },
   120	  channels: {},
   121	};
   122
   123	export const DEFAULT_CIRCUIT_BREAKER_CONFIG: CircuitBreakerConfig = {
   124	  max_failures: 5,
   125	  window_hours: 24,
   126	  half_open_probe_interval_ms: 3_600_000,
   127	};

codex
The config resolver itself looks sensible. The next question is whether `auto-recovery` is actually reading the live ops policy after runtime updates, or whether it’s bound to the bootstrap config forever.
exec
/bin/bash -lc "nl -ba src/web/api/ops-routes.ts | sed -n '1,280p'" in /home/lee/OpenLander
exec
/bin/bash -lc "rg -n \"new OpsAgent|reloadConfig\\(|config\\.ops|opsAgent|updateOpsConfig|fetchOpsConfig|createOpsRoutes|/api/ops\" src test web/src" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { Hono } from 'hono';
     2
     3	import type { AppContext } from '../../app.js';
     4	import type { OpsIncidentEventRow, OpsIncidentRow } from '../../db/types.js';
     5	import { updateConfig } from '../../config/index.js';
     6	import { resolveAutomationPolicy, isAutopilot } from '../../monitor/ops-config-resolver.js';
     7	import { DEFAULT_OPS_CONFIG, DEFAULT_RECOVERY_AUTOMATION } from '../../monitor/ops-types.js';
     8
     9	interface ActivityItem {
    10	  id: string;
    11	  timestamp: string;
    12	  type: 'incident' | 'recovery' | 'approval' | 'circuit_breaker' | 'cleanup' | 'alert';
    13	  severity: 'critical' | 'warning' | 'info';
    14	  projectId: string;
    15	  projectName: string;
    16	  title: string;
    17	  description: string;
    18	  status: 'active' | 'resolved' | 'pending' | 'failed';
    19	  incidentId?: string;
    20	  actionRunId?: string;
    21	  correlationId?: string;
    22	  cascadeGroup?: string[];
    23	  triggerType?: string;
    24	  triggerDetails?: string;
    25	}
    26
    27	interface ParsedIncidentTrigger {
    28	  triggerType?: string;
    29	  triggerDetails?: string;
    30	}
    31
    32	interface IncidentEventMetadata {
    33	  trigger_type?: string;
    34	  trigger_details?: string;
    35	  affected_project_ids?: string[];
    36	}
    37
    38	function groupEventsByIncidentId(
    39	  events: OpsIncidentEventRow[],
    40	): Map<string, OpsIncidentEventRow[]> {
    41	  const grouped = new Map<string, OpsIncidentEventRow[]>();
    42	  for (const event of events) {
    43	    const existing = grouped.get(event.incident_id);
    44	    if (existing) {
    45	      existing.push(event);
    46	      continue;
    47	    }
    48	    grouped.set(event.incident_id, [event]);
    49	  }
    50	  return grouped;
    51	}
    52
    53	function parseEventMetadata(metadata: string | null): IncidentEventMetadata | null {
    54	  if (!metadata) return null;
    55	  try {
    56	    return JSON.parse(metadata) as IncidentEventMetadata;
    57	  } catch {
    58	    return null;
    59	  }
    60	}
    61
    62	function parseTriggerFromText(text: string | null | undefined): ParsedIncidentTrigger {
    63	  if (!text) return {};
    64	  const cleaned = text
    65	    .replace(/^Incident detected:\s*/i, '')
    66	    .replace(/^Recurring event:\s*/i, '')
    67	    .trim();
    68	  if (!cleaned) return {};
    69	  const [typePart, ...detailsParts] = cleaned.split(' — ');
    70	  const triggerType = typePart?.trim();
    71	  if (!triggerType) return {};
    72	  const details = detailsParts.join(' — ').trim();
    73	  return {
    74	    triggerType,
    75	    triggerDetails: details || undefined,
    76	  };
    77	}
    78
    79	function extractIncidentTrigger(
    80	  incident: OpsIncidentRow,
    81	  events: OpsIncidentEventRow[],
    82	): ParsedIncidentTrigger {
    83	  const detected = events.find((event) => event.event_type === 'detected');
    84	  if (detected) {
    85	    const metadata = parseEventMetadata(detected.metadata);
    86	    if (metadata?.trigger_type) {
    87	      return {
    88	        triggerType: metadata.trigger_type,
    89	        triggerDetails: metadata.trigger_details,
    90	      };
    91	    }
    92	    const detectedTrigger = parseTriggerFromText(detected.description);
    93	    if (detectedTrigger.triggerType) return detectedTrigger;
    94	  }
    95	  return parseTriggerFromText(incident.root_cause);
    96	}
    97
    98	function mapIncidentResponse(incident: OpsIncidentRow, events: OpsIncidentEventRow[]) {
    99	  const trigger = extractIncidentTrigger(incident, events);
   100	  const title = incident.root_cause ?? 'Incident detected';
   101	  return {
   102	    ...incident,
   103	    title,
   104	    triggerType: trigger.triggerType,
   105	    triggerDetails: trigger.triggerDetails,
   106	  };
   107	}
   108
   109	function mapIncidentEventResponse(event: OpsIncidentEventRow) {
   110	  return {
   111	    ...event,
   112	    type: event.event_type,
   113	    message: event.description,
   114	  };
   115	}
   116
   117	export function createOpsRoutes(ctx: AppContext): Hono {
   118	  const api = new Hono();
   119
   120	  // --- Incidents ---
   121
   122	  api.get('/incidents', (c) => {
   123	    const projectId = c.req.query('projectId');
   124	    const status = c.req.query('status');
   125	    const limit = Number(c.req.query('limit') ?? 50);
   126
   127	    try {
   128	      let incidents;
   129	      if (projectId) {
   130	        incidents = ctx.db.listOpsIncidentsByProject(projectId, limit);
   131	      } else {
   132	        const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
   133	        incidents = ctx.db.listOpsIncidentsByDateRange(from, Date.now());
   134	      }
   135
   136	      if (status) {
   137	        incidents = incidents.filter((i) => i.status === status);
   138	      }
   139
   140	      const page = incidents.slice(0, limit);
   141	      const events = ctx.db.listOpsIncidentEventsByIncidentIds(page.map((incident) => incident.id));
   142	      const eventsByIncidentId = groupEventsByIncidentId(events);
   143	      return c.json({
   144	        incidents: page.map((incident) =>
   145	          mapIncidentResponse(incident, eventsByIncidentId.get(incident.id) ?? []),
   146	        ),
   147	      });
   148	    } catch {
   149	      return c.json({ error: 'Failed to fetch incidents' }, 500);
   150	    }
   151	  });
   152
   153	  api.get('/incidents/:id', (c) => {
   154	    const id = c.req.param('id');
   155
   156	    try {
   157	      const incident = ctx.db.getOpsIncident(id);
   158	      if (!incident) {
   159	        return c.json({ error: 'Incident not found' }, 404);
   160	      }
   161
   162	      const events = ctx.db.listOpsIncidentEvents(id);
   163	      return c.json({
   164	        incident: mapIncidentResponse(incident, events),
   165	        events: events.map(mapIncidentEventResponse),
   166	      });
   167	    } catch {
   168	      return c.json({ error: 'Failed to fetch incident' }, 500);
   169	    }
   170	  });
   171
   172	  api.get('/incidents/:id/events', (c) => {
   173	    const id = c.req.param('id');
   174
   175	    try {
   176	      const incident = ctx.db.getOpsIncident(id);
   177	      if (!incident) {
   178	        return c.json({ error: 'Incident not found' }, 404);
   179	      }
   180
   181	      const events = ctx.db.listOpsIncidentEvents(id);
   182	      return c.json({ events: events.map(mapIncidentEventResponse) });
   183	    } catch {
   184	      return c.json({ error: 'Failed to fetch incident events' }, 500);
   185	    }
   186	  });
   187
   188	  // --- OpsAgent Config ---
   189
   190	  api.get('/config', (c) => {
   191	    const config = ctx.opsAgent?.getConfig() ?? {};
   192	    return c.json({ config });
   193	  });
   194
   195	  api.put('/config', async (c) => {
   196	    try {
   197	      const body = await c.req.json<Record<string, unknown>>();
   198	      ctx.opsAgent?.reloadConfig(body);
   199	      updateConfig({ ops: body });
   200	      return c.json({ config: ctx.opsAgent?.getConfig() ?? {} });
   201	    } catch {
   202	      return c.json({ error: 'Invalid config' }, 400);
   203	    }
   204	  });
   205
   206	  // --- Digest ---
   207
   208	  api.get('/digest/latest', (c) => {
   209	    const digest = ctx.opsAgent?.getDigest() ?? null;
   210	    return c.json({ digest });
   211	  });
   212
   213	  api.post('/digest/trigger', async (c) => {
   214	    try {
   215	      await ctx.opsAgent?.generateDigest();
   216	      return c.json({ triggered: true });
   217	    } catch (err) {
   218	      return c.json({ triggered: false, error: String(err) }, 500);
   219	    }
   220	  });
   221
   222	  // --- Circuit Breaker ---
   223
   224	  api.get('/circuit-breaker/:projectId', (c) => {
   225	    const projectId = c.req.param('projectId');
   226
   227	    try {
   228	      const state = ctx.db.getCircuitBreakerState(projectId);
   229	      return c.json({ state });
   230	    } catch {
   231	      return c.json({ state: null });
   232	    }
   233	  });
   234
   235	  api.post('/circuit-breaker/:projectId/reset', (c) => {
   236	    const projectId = c.req.param('projectId');
   237
   238	    try {
   239	      ctx.db.resetCircuitBreaker(projectId);
   240	      return c.json({ reset: true });
   241	    } catch {
   242	      return c.json({ reset: false }, 500);
   243	    }
   244	  });
   245
   246	  // --- Health ---
   247
   248	  api.get('/health', (c) => {
   249	    return c.json({
   250	      status: 'ok',
   251	      queue: 0,
   252	      running: ctx.opsAgent !== undefined,
   253	    });
   254	  });
   255
   256	  // --- Global Circuit Breakers ---
   257
   258	  api.get('/circuit-breakers', (c) => {
   259	    try {
   260	      const allBreakers = ctx.db.listAllCircuitBreakers();
   261	      const projects = ctx.db.listProjects();
   262	      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
   263	      const breakers = allBreakers
   264	        .map((b) => ({
   265	          projectId: b.project_id,
   266	          projectName: projectMap.get(b.project_id) ?? b.project_id,
   267	          state: b.state,
   268	          failureCount: b.failure_count,
   269	          lastFailureAt: b.last_failure_at,
   270	          openedAt: b.opened_at,
   271	          resetAt: b.reset_at,
   272	        }))
   273	        .sort((a, b) => {
   274	          const order: Record<string, number> = { open: 0, half_open: 1, closed: 2 };
   275	          return (order[a.state] ?? 2) - (order[b.state] ?? 2);
   276	        });
   277	      return c.json({ breakers });
   278	    } catch (err) {
   279	      return c.json({ error: String(err) }, 500);
   280	    }

 succeeded in 0ms:
web/src/hooks/use-ops-center-data.ts:227:      fetchWithAuth('/api/ops/agent/active')
src/pipeline/cloudflare.ts:56:  reloadConfig(config: CloudflareConfig): void {
web/src/hooks/use-agent-activity.ts:26:      const res = await fetchWithAuth('/api/ops/agent/active').catch(() => null);
web/src/lib/api/operations.ts:29:export async function fetchOpsConfig(): Promise<{ config: OpsConfig }> {
web/src/lib/api/operations.ts:30:  const res = await fetchWithAuth('/api/ops/config');
web/src/lib/api/operations.ts:37:export async function updateOpsConfig(config: Partial<OpsConfig>): Promise<{ config: OpsConfig }> {
web/src/lib/api/operations.ts:38:  const res = await fetchWithAuth('/api/ops/config', {
web/src/lib/api/operations.ts:52:  const res = await fetchWithAuth('/api/ops/digest/trigger', {
web/src/lib/api/operations.ts:103:  const response = await fetchWithAuth(`/api/ops/incidents?${params.toString()}`);
web/src/lib/api/operations.ts:111:  const response = await fetchWithAuth(`/api/ops/incidents/${id}`);
web/src/lib/api/operations.ts:117:  const response = await fetchWithAuth(`/api/ops/circuit-breaker/${projectId}`);
web/src/lib/api/operations.ts:126:  const response = await fetchWithAuth(`/api/ops/circuit-breaker/${projectId}/reset`, {
web/src/lib/api/operations.ts:136:  const response = await fetchWithAuth(`/api/ops/incidents/${incidentId}/events`);
web/src/lib/api/operations.ts:223:  const resp = await fetchWithAuth(`/api/ops/activity${query}`);
web/src/lib/api/operations.ts:231:  const resp = await fetchWithAuth('/api/ops/circuit-breakers');
web/src/lib/api/operations.ts:240:  const resp = await fetchWithAuth('/api/ops/dependencies');
web/src/lib/api/operations.ts:264:  const resp = await fetchWithAuth('/api/ops/automation/defaults');
web/src/lib/api/operations.ts:272:  const resp = await fetchWithAuth(`/api/ops/projects/${projectId}/automation`);
web/src/lib/api/operations.ts:281:  const resp = await fetchWithAuth(`/api/ops/projects/${projectId}/automation`, {
test/monitor/recovery-coordinator.test.ts:143:    const opsAgent: OpsAgentRef = { enqueue: vi.fn() };
test/monitor/recovery-coordinator.test.ts:147:    coordinator.start({ opsAgent });
test/monitor/recovery-coordinator.test.ts:160:    expect(opsAgent.enqueue).toHaveBeenCalledWith({
test/monitor/recovery-coordinator.test.ts:228:    const opsAgent: OpsAgentRef = { enqueue: vi.fn() };
test/monitor/recovery-coordinator.test.ts:232:    coordinator.start({ opsAgent });
test/monitor/recovery-coordinator.test.ts:241:    expect(opsAgent.enqueue).toHaveBeenCalledWith({
test/monitor/recovery-coordinator.test.ts:338:    const opsAgent: OpsAgentRef = { enqueue: vi.fn() };
test/monitor/recovery-coordinator.test.ts:340:    coordinator.start({ opsAgent });
test/monitor/recovery-coordinator.test.ts:347:    expect(opsAgent.enqueue).toHaveBeenCalledTimes(1);
test/monitor/recovery-coordinator.test.ts:357:    expect(opsAgent.enqueue).toHaveBeenCalledTimes(2);
test/monitor/ops-agent.test.ts:61:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:68:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:75:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:82:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:99:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:122:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:133:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:147:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:167:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:182:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:193:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:203:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:218:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:225:      const agent = new OpsAgent(mockCtx, { enabled: false });
test/monitor/ops-agent.test.ts:231:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:232:      agent.reloadConfig({ auto_cleanup: false });
test/monitor/ops-agent.test.ts:238:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:239:      agent.reloadConfig({ auto_restart: true } as any);
test/monitor/ops-agent.test.ts:244:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:245:      agent.reloadConfig({ auto_restart: false } as any);
test/monitor/ops-agent.test.ts:250:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:251:      agent.reloadConfig({
test/monitor/ops-agent.test.ts:261:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:266:      agent.reloadConfig({
test/monitor/ops-agent.test.ts:273:      agent.reloadConfig({
test/monitor/ops-agent.test.ts:295:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:341:      const agent = new OpsAgent(mockCtx);
test/monitor/ops-agent.test.ts:354:      const agent = new OpsAgent(mockCtx);
src/app.ts:169:  opsAgent?: OpsAgent;
src/app.ts:405:      const opsConfig = config.ops;
src/app.ts:639:  void ctx.opsAgent?.stop();
test/tools/ops-automation.test.ts:30:    opsAgent: {
src/monitor/recovery-coordinator.ts:60:  private opsAgent: OpsAgentRef | undefined;
src/monitor/recovery-coordinator.ts:77:  start(opts?: { opsAgent?: OpsAgentRef }): void {
src/monitor/recovery-coordinator.ts:82:    if (opts?.opsAgent) {
src/monitor/recovery-coordinator.ts:83:      this.opsAgent = opts.opsAgent;
src/monitor/recovery-coordinator.ts:123:    log.info({ hasOpsAgent: Boolean(this.opsAgent) }, 'RecoveryCoordinator started');
src/monitor/recovery-coordinator.ts:177:  setOpsAgent(opsAgent: OpsAgentRef): void {
src/monitor/recovery-coordinator.ts:178:    this.opsAgent = opsAgent;
src/monitor/recovery-coordinator.ts:244:      if (this.opsAgent) {
src/monitor/recovery-coordinator.ts:246:        this.opsAgent.enqueue({
src/monitor/recovery-coordinator.ts:261:      const correlationId = this.opsAgent ? undefined : payload.projectId;
src/monitor/recovery-coordinator.ts:298:      if (this.opsAgent) {
src/monitor/recovery-coordinator.ts:300:        this.opsAgent.enqueue({
src/monitor/recovery-coordinator.ts:314:      const correlationId = this.opsAgent ? undefined : payload.projectId;
src/monitor/ops-recovery.ts:628:      const config = this.ctx.opsAgent?.getConfig();
test/web/api/ops-incident-routes.test.ts:4:import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
test/web/api/ops-incident-routes.test.ts:78:    opsAgent: {
test/web/api/ops-incident-routes.test.ts:106:  app.route('/api', createOpsRoutes(ctx));
test/web/api/ops-incident-routes.test.ts:156:// ── Regression tests: /api/ops/incidents response shape ───────────────────────
test/web/api/ops-incident-routes.test.ts:221:      opsAgent: {
test/web/api/ops-incident-routes.test.ts:252:    errorApp.route('/api', createOpsRoutes(brokenCtx));
test/web/api/ops-incident-routes.test.ts:261:// ── Regression tests: /api/ops/circuit-breakers response shape ────────────────
test/web/api/ops-incident-routes.test.ts:316:      opsAgent: {
test/web/api/ops-incident-routes.test.ts:343:    emptyApp.route('/api', createOpsRoutes(emptyCtx));
test/web/api/ops-incident-routes.test.ts:352:// ── Regression tests: /api/ops/activity response shape ────────────────────────
src/monitor/ops-agent.ts:432:  reloadConfig(config: Partial<OpsConfig>): void {
src/web/server.ts:320:  if (ctx.opsAgent) {
src/web/server.ts:324:  const opsAgent = new OpsAgent(ctx, ctx.config.ops);
src/web/server.ts:325:  ctx.opsAgent = opsAgent;
src/web/server.ts:326:  await opsAgent.start();
src/web/server.ts:327:  ctx.coordinator.setOpsAgent(opsAgent);
test/web/api/ops-automation-routes.test.ts:4:import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
test/web/api/ops-automation-routes.test.ts:16:    opsAgent: {
test/web/api/ops-automation-routes.test.ts:43:  app.route('/api', createOpsRoutes(ctx));
test/web/api/ops-routes.test.ts:12:import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
test/web/api/ops-routes.test.ts:38:    opsAgent: {
test/web/api/ops-routes.test.ts:85:  app.route('/api', createOpsRoutes(ctx));
web/src/components/project/OperationsTab.tsx:7:  fetchOpsConfig,
web/src/components/project/OperationsTab.tsx:8:  updateOpsConfig,
web/src/components/project/OperationsTab.tsx:84:        fetchOpsConfig().catch(() => ({ config: null })),
web/src/components/project/OperationsTab.tsx:125:      await updateOpsConfig({ enabled });
src/web/api/setup/cloudflare-routes.ts:132:    ctx.cloudflare.reloadConfig(cloudflareConfig);
src/web/api/routes.ts:15:import { createOpsRoutes } from './ops-routes.js';
src/web/api/routes.ts:492:  api.route('/ops', createOpsRoutes(ctx));
src/web/api/ops-routes.ts:117:export function createOpsRoutes(ctx: AppContext): Hono {
src/web/api/ops-routes.ts:191:    const config = ctx.opsAgent?.getConfig() ?? {};
src/web/api/ops-routes.ts:198:      ctx.opsAgent?.reloadConfig(body);
src/web/api/ops-routes.ts:200:      return c.json({ config: ctx.opsAgent?.getConfig() ?? {} });
src/web/api/ops-routes.ts:209:    const digest = ctx.opsAgent?.getDigest() ?? null;
src/web/api/ops-routes.ts:215:      await ctx.opsAgent?.generateDigest();
src/web/api/ops-routes.ts:252:      running: ctx.opsAgent !== undefined,
src/web/api/ops-routes.ts:286:    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
src/web/api/ops-routes.ts:301:    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
src/web/api/ops-routes.ts:339:    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
src/tools/defs/ops-automation.ts:41:      const config = context.appCtx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
src/tools/defs/ops-automation.ts:86:      const config = context.appCtx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
web/src/components/settings/OperationsSettings.tsx:7:import { fetchOpsConfig, updateOpsConfig } from '@/lib/api/operations';
web/src/components/settings/OperationsSettings.tsx:61:    void fetchOpsConfig().then((data) => {
web/src/components/settings/OperationsSettings.tsx:97:      await updateOpsConfig(payload);

exec
/bin/bash -lc "nl -ba src/app.ts | sed -n '250,388p'" in /home/lee/OpenLander
 succeeded in 0ms:
   250	  });
   251
   252	  const normalizedLlm = normalizeLlmConfig(config.llm);
   253
   254	  const hasLlmConfigured = (() => {
   255	    if (Object.keys(normalizedLlm.providers).length === 0) {
   256	      return false;
   257	    }
   258
   259	    const defaultProvider = normalizedLlm.providers[normalizedLlm.defaultRoute.providerId];
   260	    if (!defaultProvider) {
   261	      return false;
   262	    }
   263
   264	    return !!(defaultProvider.apiKey || defaultProvider.authToken);
   265	  })();
   266
   267	  const modelRegistry = new ModelRegistry(
   268	    hasLlmConfigured
   269	      ? {
   270	          providers: normalizedLlm.providers,
   271	          defaultRoute: normalizedLlm.defaultRoute,
   272	          routes: normalizedLlm.routes,
   273	        }
   274	      : { providers: {}, defaultRoute: { providerId: '__none__' } },
   275	  );
   276
   277	  const model: LanguageModel | null = hasLlmConfigured
   278	    ? createModelProxy(modelRegistry, 'default')
   279	    : null;
   280
   281	  const autoDetector = new AutoDetector(
   282	    hasLlmConfigured ? createModelProxy(modelRegistry, 'envDetection') : null,
   283	  );
   284
   285	  const webAgentEnabled = config.ai.webAgent.enabled;
   286	  const autoRecoveryEnabled = config.ai.autoRecovery.enabled;
   287	  const buildDebuggerEnabled = config.ai.buildDebugger.enabled;
   288
   289	  // v0.3: Build debugger (requires LLM) — created before pipeline so it can be injected
   290	  let buildDebugger: BuildDebugger | null = null;
   291	  if (hasLlmConfigured && buildDebuggerEnabled) {
   292	    try {
   293	      buildDebugger = new BuildDebugger(
   294	        createModelProxy(modelRegistry, 'buildDebugger'),
   295	        config.language,
   296	        db,
   297	        config.llm.provider,
   298	      );
   299	    } catch (err) {
   300	      log.debug({ err }, 'Build debugger creation failed');
   301	    }
   302	  }
   303
   304	  // v1.0: Recovery coordinator — single owner of all recovery decisions
   305	  const coordinator = new RecoveryCoordinator(db, eventBus, config);
   306	  coordinator.start();
   307
   308	  const pipeline = new DeployPipeline(
   309	    docker,
   310	    db,
   311	    env,
   312	    config,
   313	    jobManager,
   314	    composePipeline,
   315	    autoDetector,
   316	    coordinator,
   317	  );
   318	  const approvalGate = new ApprovalGate();
   319
   320	  let agentPool: AgentPool | null = null;
   321	  let agent: Agent | null = null;
   322	  if (hasLlmConfigured && webAgentEnabled) {
   323	    try {
   324	      agentPool = new AgentPool(
   325	        createModelProxy(modelRegistry, 'webAgent'),
   326	        db,
   327	        async (scope) => buildContextSnapshot(db, docker, scope),
   328	        config.llm.provider,
   329	        config.language,
   330	        approvalGate,
   331	      );
   332	    } catch (err) {
   333	      log.debug({ err }, 'AgentPool creation failed — web agent disabled');
   334	      agentPool = null;
   335	    }
   336	  }
   337
   338	  if (hasLlmConfigured && autoRecoveryEnabled) {
   339	    if (agentPool) {
   340	      agent = agentPool.getRecoveryAgent();
   341	    } else {
   342	      try {
   343	        agent = new Agent(
   344	          createModelProxy(modelRegistry, 'autoRecovery'),
   345	          db,
   346	          async (scope) => buildContextSnapshot(db, docker, scope),
   347	          config.llm.provider,
   348	          config.language,
   349	          'auto_recovery',
   350	        );
   351	      } catch (err) {
   352	        log.debug({ err }, 'Recovery agent creation failed — agent will be null');
   353	      }
   354	    }
   355	  }
   356
   357	  // v0.7: Question bridge (agent ↔ UI)
   358	  const questionBridge = new QuestionBridge();
   359	  questionBridge.setEventBus(eventBus);
   360	  if (agentPool) {
   361	    agentPool.setQuestionBridge(questionBridge);
   362	  }
   363	  if (agent) {
   364	    agent.setQuestionBridge(questionBridge);
   365	  }
   366
   367	  const deployQueue = new DeployQueue();
   368
   369	  // Track active project for question events
   370	  eventBus.on('deploy:start', (payload) => {
   371	    try {
   372	      questionBridge.setActiveProject(payload.projectId);
   373	    } catch (error) {
   374	      log.error({ error }, 'Unhandled error in deploy:start event handler');
   375	    }
   376	  });
   377	  eventBus.on('deploy:success', () => {
   378	    try {
   379	      questionBridge.setActiveProject(null);
   380	    } catch (error) {
   381	      log.error({ error }, 'Unhandled error in deploy:success event handler');
   382	    }
   383	  });
   384	  eventBus.on('deploy:failed', () => {
   385	    try {
   386	      questionBridge.setActiveProject(null);
   387	    } catch (error) {
   388	      log.error({ error }, 'Unhandled error in deploy:failed event handler');

codex
I found the likely integration seam: `/api/ops/config` updates the `OpsAgent`, but `auto-recovery` is wired through the original app config object. I’m verifying whether `updateConfig()` mutates that object in place or persists elsewhere, because that decides whether runtime policy changes are effective.
exec
/bin/bash -lc 'rg -n "export function updateConfig|function updateConfig|const updateConfig" src/config src' in /home/lee/OpenLander
 succeeded in 0ms:
src/config/index.ts:452:export function updateConfig(partial: DeepPartial<OpenLanderConfig>): OpenLanderConfig {
src/config/index.ts:452:export function updateConfig(partial: DeepPartial<OpenLanderConfig>): OpenLanderConfig {

exec
/bin/bash -lc "nl -ba src/config/index.ts | sed -n '1,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
     2	import { join, dirname } from 'node:path';
     3	import { homedir } from 'node:os';
     4	import { createModuleLogger } from '../lib/logger.js';
     5	import type {
     6	  LLMProviderEntry,
     7	  LLMRoute,
     8	  AIModelFeature,
     9	  ModelRoutingConfig,
    10	} from '../llm/model-registry.js';
    11	import type { LLMProviderType } from '../llm/providers.js';
    12	import type { OpsConfig } from '../monitor/ops-types.js';
    13	import { DEFAULT_OPS_CONFIG } from '../monitor/ops-types.js';
    14
    15	const log = createModuleLogger('config');
    16
    17	/**
    18	 * OpenLander configuration system.
    19	 *
    20	 * Config is stored at ~/.openlander/config.json.
    21	 * Forward-compatible with v0.5 — new fields are added with defaults,
    22	 * existing configs never break.
    23	 */
    24
    25	// --- Environment Policies ---
    26
    27	/** Supported deployment environment types. */
    28	export type OpenLanderEnv = 'production' | 'development';
    29	export const SHARED_NETWORK_NAME = 'openlander';
    30	export const DOCKER_LABELS = {
    31	  MANAGED: 'openlander.managed',
    32	  ROLE: 'openlander.role',
    33	  PROJECT: 'openlander.project',
    34	  SERVICE: 'openlander.service',
    35	  VOLUME: 'openlander.volume',
    36	  MOUNT_PATH: 'openlander.mount_path',
    37	} as const;
    38
    39	/** Valid environment names for input validation. */
    40	const VALID_ENVIRONMENTS: ReadonlySet<string> = new Set<string>(['production', 'development']);
    41
    42	/** Deploy-level policy that varies per environment type. */
    43	export interface EnvironmentPolicy {
    44	  networkName: string;
    45	  portRangeStart: number;
    46	  portRangeEnd: number;
    47	}
    48
    49	/** Default policies per environment. Pipeline functions read these via getPolicy(). */
    50	const DEFAULT_POLICIES: Record<OpenLanderEnv, EnvironmentPolicy> = {
    51	  production: {
    52	    networkName: SHARED_NETWORK_NAME,
    53	    portRangeStart: 10001,
    54	    portRangeEnd: 10999,
    55	  },
    56	  development: {
    57	    networkName: SHARED_NETWORK_NAME,
    58	    portRangeStart: 20001,
    59	    portRangeEnd: 20999,
    60	  },
    61	};
    62
    63	/**
    64	 * Get the deploy policy for an environment type.
    65	 * Pipeline code should always go through this function — never read DEFAULT_POLICIES directly.
    66	 * Future: this will layer global config overrides and per-project overrides on top.
    67	 */
    68	export function getPolicy(envType: OpenLanderEnv): EnvironmentPolicy {
    69	  return DEFAULT_POLICIES[envType];
    70	}
    71
    72	/** Validate whether a string is a valid environment type. */
    73	export function isValidEnvironment(value: string): value is OpenLanderEnv {
    74	  return VALID_ENVIRONMENTS.has(value);
    75	}
    76
    77	// --- Config schema ---
    78
    79	export interface OpenLanderConfig {
    80	  /** User-facing language for UI and agent responses */
    81	  language: 'en' | 'ko';
    82
    83	  /** v0.1: LLM provider settings */
    84	  llm: LLMProviderConfig;
    85
    86	  /** v0.1: Server settings */
    87	  server: ServerConfig;
    88
    89	  /** v0.1: Docker settings */
    90	  docker: DockerConfig;
    91
    92	  /** v0.1: Git settings */
    93	  git: GitConfig;
    94
    95	  /** v0.2: Cloudflare settings */
    96	  cloudflare: CloudflareConfig;
    97
    98	  /** v0.2: Monitoring settings */
    99	  monitoring: MonitoringConfig;
   100
   101	  /** v0.3: MCP server settings */
   102	  mcp: MCPConfig;
   103
   104	  /** v0.4: Channel/bot settings */
   105	  channels: ChannelConfig;
   106
   107	  /** v0.5: Git hosting providers (GitHub, GitLab, etc.) */
   108	  gitProviders: GitProvidersConfig;
   109
   110	  /** v0.5: Local model settings */
   111	  localModel: LocalModelConfig;
   112
   113	  /** v0.9: Traefik reverse proxy settings */
   114	  traefik: TraefikConfig;
   115
   116	  /** v1.0: AI feature toggles */
   117	  ai: AIFeaturesConfig;
   118
   119	  /** v1.1: Google OAuth credentials for Gemini API access */
   120	  google: GoogleOAuthConfig;
   121
   122	  /** v1.1: Operations agent settings */
   123	  ops: OpsConfig;
   124	}
   125
   126	export interface GoogleOAuthConfig {
   127	  clientId: string;
   128	  clientSecret: string;
   129	}
   130
   131	export interface LLMProviderConfig {
   132	  provider: LLMProviderType;
   133	  apiKey: string;
   134	  model: string;
   135	  /** v0.2: OAuth access token (used instead of apiKey when OAuth is active) */
   136	  authToken: string;
   137	  /** v1.1: Multi-provider registry. If present, used for feature-based routing. */
   138	  providers?: Record<string, LLMProviderEntry>;
   139	  /** v1.1: Default route when no feature-specific route is configured. */
   140	  defaultRoute?: LLMRoute;
   141	  /** v1.1: Per-feature model routing overrides. */
   142	  routes?: Partial<Record<AIModelFeature, LLMRoute>>;
   143	}
   144
   145	export interface ServerConfig {
   146	  port: number;
   147	  host: string;
   148	  /** Base URL for internal access */
   149	  baseUrl: string;
   150	  corsOrigin?: string;
   151	}
   152
   153	export interface DockerConfig {
   154	  socketPath: string;
   155	  /** Network name for Traefik routing (production default) */
   156	  networkName: string;
   157	  /** Port range for managed containers (production defaults) */
   158	  portRangeStart: number;
   159	  portRangeEnd: number;
   160	}
   161
   162	export interface GitConfig {
   163	  sshKeyPath: string;
   164	  /** Directory to store cloned repos */
   165	  cloneDir: string;
   166	}
   167
   168	export interface CloudflareConfig {
   169	  /** API token for DNS + Tunnel management */
   170	  apiToken: string;
   171	  /** Tunnel ID for production domains */
   172	  tunnelId: string;
   173	  /** Account ID */
   174	  accountId: string;
   175	}
   176
   177	export interface MonitoringConfig {
   178	  /** Healthcheck interval in seconds */
   179	  healthcheckIntervalSec: number;
   180	  /** Days of inactivity before suggesting cleanup */
   181	  inactivityThresholdDays: number;
   182	}
   183
   184	export interface McpServerEntry {
   185	  /** Unique server identifier */
   186	  id: string;
   187	  /** Display name */
   188	  name: string;
   189	  /** Transport type */
   190	  transport: 'stdio' | 'sse' | 'http';
   191	  /** Server URL (for sse/http transports) */
   192	  url?: string;
   193	  /** Command to run (for stdio transport) */
   194	  command?: string;
   195	  /** Command arguments (for stdio transport) */
   196	  args?: string[];
   197	  /** HTTP headers (for sse/http transports) */
   198	  headers?: Record<string, string>;
   199	  /** Environment variables (for stdio transport) */
   200	  env?: Record<string, string>;
   201	  /** Whether this server is enabled */
   202	  enabled: boolean;
   203	}
   204
   205	export interface MCPConfig {
   206	  /** Whether MCP server is enabled */
   207	  enabled: boolean;
   208	  /** MCP transport: stdio or sse */
   209	  transport: 'stdio' | 'sse';
   210	  /** External MCP servers the agent can consume tools from */
   211	  servers: McpServerEntry[];
   212	  /** Whether to expose platform tools (Docker, Git, etc.) via MCP */
   213	  platformTools?: boolean;
   214	  /** MCP tool consolidation mode: 'unified' (consolidated tools) or 'legacy' (separate tools) */
   215	  mode?: 'unified' | 'legacy';
   216	}
   217
   218	export interface EmailChannelConfig {
   219	  enabled: boolean;
   220	  host: string;
   221	  port: number;
   222	  secure: boolean;
   223	  auth: { user: string; pass: string };
   224	  from: string;
   225	  to: string[];
   226	}
   227
   228	export interface ChannelConfig {
   229	  slack: { enabled: boolean; token: string; signingSecret: string; recoveryChannelId?: string };
   230	  discord: {
   231	    enabled: boolean;
   232	    token: string;
   233	    applicationId: string;
   234	    publicKey: string;
   235	    recoveryChannelId?: string;
   236	  };
   237	  telegram: { enabled: boolean; token: string; webhookSecret: string; recoveryChannelId?: string };
   238	  email: EmailChannelConfig;
   239	}
   240
   241	export interface LocalModelConfig {
   242	  /** Whether to prefer local model over API */
   243	  preferLocal: boolean;
   244	  /** Model name for Ollama */
   245	  modelName: string;
   246	}
   247
   248	/** Traefik reverse proxy mode configuration. */
   249	export interface TraefikConfig {
   250	  /** Proxy mode: 'managed' (OpenLander runs Traefik) or 'external' (use existing Traefik). */
   251	  mode: 'managed' | 'external';
   252	  /** External mode: Name of the Docker network to connect containers to. */
   253	  externalNetwork?: string;
   254	}
   255
   256	export interface AIFeatureToggle {
   257	  enabled: boolean;
   258	  /** v1.1: Which registered provider to use for this feature. Falls back to defaultRoute. */
   259	  providerId?: string;
   260	  /** v1.1: Model override for this feature. Falls back to provider.defaultModel. */

exec
/bin/bash -lc "nl -ba src/web/server.ts | sed -n '300,335p'" in /home/lee/OpenLander
 succeeded in 0ms:
   300	    log.info({ version: VERSION, port: options.port }, `OpenLander v${VERSION} listening`);
   301	    const host = options.host || 'localhost';
   302	    console.log(`\n  OpenLander v${VERSION}\n  http://${host}:${String(options.port)}\n`);
   303	  });
   304	  injectWebSocket(server);
   305
   306	  // v0.2: Start health monitoring
   307	  if (ctx.config.ai.operationalMonitoring.enabled) {
   308	    ctx.healthMonitor.start();
   309	    ctx.alertMonitor.start();
   310	    void startOpsAgent(ctx);
   311	  }
   312
   313	  // v0.4: Start channel connections
   314	  void ctx.channelManager.start();
   315
   316	  void verifyLlmOnStartup(ctx);
   317	}
   318
   319	async function startOpsAgent(ctx: AppContext): Promise<void> {
   320	  if (ctx.opsAgent) {
   321	    return;
   322	  }
   323
   324	  const opsAgent = new OpsAgent(ctx, ctx.config.ops);
   325	  ctx.opsAgent = opsAgent;
   326	  await opsAgent.start();
   327	  ctx.coordinator.setOpsAgent(opsAgent);
   328	  log.info('OpsAgent started');
   329	}
   330
   331	async function verifyLlmOnStartup(ctx: AppContext): Promise<void> {
   332	  if (!ctx.model) return;
   333	  try {
   334	    const { generateText } = await import('ai');
   335	    await generateText({

exec
/bin/bash -lc "nl -ba src/config/index.ts | sed -n '430,500p'" in /home/lee/OpenLander
 succeeded in 0ms:
   430	    const raw = readFileSync(configPath, 'utf-8');
   431	    const saved = JSON.parse(raw) as Partial<OpenLanderConfig>;
   432	    const merged = deepMerge(defaults, saved);
   433
   434	    // Normalize MCP mode to ensure it's always valid
   435	    merged.mcp.mode = normalizeMcpMode(merged.mcp.mode);
   436
   437	    return merged;
   438	  } catch (err) {
   439	    log.debug({ err }, 'Config file corrupted — returning defaults');
   440	    return { ...defaults };
   441	  }
   442	}
   443
   444	/** Save configuration to disk. */
   445	export function saveConfig(config: OpenLanderConfig): void {
   446	  const configPath = getConfigPath();
   447	  mkdirSync(dirname(configPath), { recursive: true });
   448	  writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
   449	}
   450
   451	/** Update specific config fields (partial update). */
   452	export function updateConfig(partial: DeepPartial<OpenLanderConfig>): OpenLanderConfig {
   453	  const current = loadConfig();
   454	  const updated = deepMerge(current, partial as Partial<OpenLanderConfig>);
   455	  saveConfig(updated);
   456	  return updated;
   457	}
   458
   459	/** Check if initial onboarding has been completed. */
   460	export function isOnboarded(): boolean {
   461	  return existsSync(getConfigPath());
   462	}
   463
   464	// --- LLM config normalization ---
   465
   466	export type NormalizedLlmConfig = LLMProviderConfig & {
   467	  providers: NonNullable<LLMProviderConfig['providers']>;
   468	  defaultRoute: NonNullable<LLMProviderConfig['defaultRoute']>;
   469	};
   470
   471	/**
   472	 * Normalizes LLM config for use with ModelRegistry.
   473	 * If the new `providers` field is absent, synthesizes it from legacy single-provider fields.
   474	 * Does NOT mutate the config object or write to disk.
   475	 */
   476	export function normalizeLlmConfig(llm: LLMProviderConfig): NormalizedLlmConfig {
   477	  if (llm.providers && llm.defaultRoute) {
   478	    return llm as NormalizedLlmConfig;
   479	  }
   480
   481	  return {
   482	    ...llm,
   483	    providers: {
   484	      default: {
   485	        provider: llm.provider,
   486	        apiKey: llm.apiKey,
   487	        authToken: llm.authToken,
   488	        defaultModel: llm.model,
   489	      },
   490	    },
   491	    defaultRoute: { providerId: 'default' },
   492	  };
   493	}
   494
   495	// --- Re-exports from model-registry ---
   496
   497	export type { LLMProviderEntry, LLMRoute, AIModelFeature, ModelRoutingConfig };
   498
   499	// --- Utility types ---
   500

codex
The config update path does not mutate `ctx.config`; it reloads from disk and persists separately. That makes the current `getAutomationPolicy` wiring suspicious for hot-updated policies, so I’m checking whether the new ops routes/tests accidentally mask that stale-read behavior.
exec
/bin/bash -lc "nl -ba src/web/api/ops-routes.ts | sed -n '280,380p'" in /home/lee/OpenLander
 succeeded in 0ms:
   280	    }
   281	  });
   282
   283	  // --- Automation Policy ---
   284
   285	  api.get('/automation/defaults', (c) => {
   286	    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
   287	    const policy = resolveAutomationPolicy(config);
   288	    return c.json({
   289	      defaults: DEFAULT_RECOVERY_AUTOMATION,
   290	      effective: policy,
   291	      isAutopilot: policy ? isAutopilot(policy) : false,
   292	    });
   293	  });
   294
   295	  api.get('/projects/:projectId/automation', (c) => {
   296	    const projectId = c.req.param('projectId');
   297	    const project = ctx.db.getProject(projectId);
   298	    if (!project) {
   299	      return c.json({ error: 'Project not found' }, 404);
   300	    }
   301	    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
   302	    const override = ctx.db.getProjectOpsOverride(projectId);
   303	    const policy = resolveAutomationPolicy(config, override);
   304	    return c.json({
   305	      effective: policy,
   306	      overrides: override?.automation ?? null,
   307	      isAutopilot: policy ? isAutopilot(policy) : false,
   308	    });
   309	  });
   310
   311	  api.put('/projects/:projectId/automation', async (c) => {
   312	    const projectId = c.req.param('projectId');
   313	    const project = ctx.db.getProject(projectId);
   314	    if (!project) {
   315	      return c.json({ error: 'Project not found' }, 404);
   316	    }
   317	    let body: { automation?: Record<string, string> };
   318	    try {
   319	      body = await c.req.json<{ automation?: Record<string, string> }>();
   320	    } catch {
   321	      return c.json({ error: 'Invalid JSON body' }, 400);
   322	    }
   323	    const validSteps = new Set(['restart', 'diagnosis', 'apply_fixes', 'rollback']);
   324	    const validModes = new Set(['auto', 'confirm']);
   325	    for (const [step, mode] of Object.entries(body.automation ?? {})) {
   326	      if (!validSteps.has(step)) {
   327	        return c.json({ error: `Invalid step: ${step}` }, 400);
   328	      }
   329	      if (!validModes.has(mode)) {
   330	        return c.json({ error: `Invalid mode: ${mode}` }, 400);
   331	      }
   332	    }
   333	    const typed = body.automation as
   334	      | Partial<Record<'restart' | 'diagnosis' | 'apply_fixes' | 'rollback', 'auto' | 'confirm'>>
   335	      | undefined;
   336	    const existing = ctx.db.getProjectOpsOverride(projectId);
   337	    const merged = { ...existing?.automation, ...typed };
   338	    ctx.db.setProjectOpsOverride(projectId, { automation: merged });
   339	    const config = ctx.opsAgent?.getConfig() ?? DEFAULT_OPS_CONFIG;
   340	    const override = ctx.db.getProjectOpsOverride(projectId);
   341	    const policy = resolveAutomationPolicy(config, override);
   342	    return c.json({
   343	      effective: policy,
   344	      overrides: override?.automation ?? null,
   345	      isAutopilot: policy ? isAutopilot(policy) : false,
   346	    });
   347	  });
   348
   349	  api.delete('/projects/:projectId/automation', (c) => {
   350	    const projectId = c.req.param('projectId');
   351	    ctx.db.deleteProjectOpsOverride(projectId);
   352	    return c.json({ deleted: true });
   353	  });
   354
   355	  // --- Unified Activity Feed ---
   356
   357	  api.get('/activity', (c) => {
   358	    try {
   359	      const projectId = c.req.query('projectId');
   360	      const types = c.req.query('types')?.split(',').filter(Boolean) ?? [];
   361	      const severity = c.req.query('severity');
   362	      const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 200);
   363	      const before = c.req.query('before');
   364
   365	      const projects = ctx.db.listProjects();
   366	      const projectMap = new Map(projects.map((p) => [p.id, p.name]));
   367	      const activities: ActivityItem[] = [];
   368
   369	      // Incidents
   370	      if (types.length === 0 || types.includes('incident') || types.includes('alert')) {
   371	        const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
   372	        const incidents = projectId
   373	          ? ctx.db.listOpsIncidentsByProject(projectId, 100)
   374	          : ctx.db.listOpsIncidentsByDateRange(sevenDaysAgo, Date.now());
   375	        const eventsByIncidentId = groupEventsByIncidentId(
   376	          ctx.db.listOpsIncidentEventsByIncidentIds(incidents.map((incident) => incident.id)),
   377	        );
   378
   379	        for (const inc of incidents) {
   380	          const incidentEvents = eventsByIncidentId.get(inc.id) ?? [];

exec
/bin/bash -lc "nl -ba test/web/api/ops-routes.test.ts | sed -n '1,260p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	/**
     2	 * Automation policy API round-trip tests for ops-routes.
     3	 *
     4	 * Tests that:
     5	 * - PUT /projects/:projectId/automation → GET /projects/:projectId/automation returns same values
     6	 * - DELETE /projects/:projectId/automation → GET /projects/:projectId/automation returns defaults
     7	 */
     8
     9	import { beforeEach, describe, expect, it, vi } from 'vitest';
    10	import { Hono } from 'hono';
    11
    12	import { createOpsRoutes } from '../../../src/web/api/ops-routes.js';
    13	import type { AppContext } from '../../../src/app.js';
    14	import { DEFAULT_RECOVERY_AUTOMATION } from '../../../src/monitor/ops-types.js';
    15	import type { ProjectOpsOverride } from '../../../src/monitor/ops-types.js';
    16
    17	// ---------------------------------------------------------------------------
    18	// In-memory store helpers to simulate database round-trips
    19	// ---------------------------------------------------------------------------
    20
    21	function createOpsOverrideStore(): {
    22	  store: Map<string, ProjectOpsOverride>;
    23	  get: (projectId: string) => ProjectOpsOverride | undefined;
    24	  set: (projectId: string, override: ProjectOpsOverride) => void;
    25	  del: (projectId: string) => void;
    26	} {
    27	  const store = new Map<string, ProjectOpsOverride>();
    28	  return {
    29	    store,
    30	    get: (projectId) => store.get(projectId),
    31	    set: (projectId, override) => store.set(projectId, override),
    32	    del: (projectId) => store.delete(projectId),
    33	  };
    34	}
    35
    36	function createHarness(overrideStore = createOpsOverrideStore()) {
    37	  const ctx = {
    38	    opsAgent: {
    39	      getConfig: () => ({
    40	        enabled: true,
    41	        recovery: {
    42	          enabled: true,
    43	          automation: { ...DEFAULT_RECOVERY_AUTOMATION },
    44	        },
    45	        auto_restart: true,
    46	        auto_cleanup: true,
    47	        drift_detection: true,
    48	        production_only: true,
    49	        thresholds: {
    50	          disk_cleanup_percent: 80,
    51	          recovery_max_per_day: 5,
    52	          alert_dedup_minutes: 15,
    53	          digest_time: '09:00',
    54	        },
    55	        channels: {},
    56	      }),
    57	      getDigest: () => null,
    58	      generateDigest: vi.fn(),
    59	      reloadConfig: vi.fn(),
    60	    },
    61	    db: {
    62	      getProject: (id: string) =>
    63	        id === 'proj-1' ? { id: 'proj-1', name: 'alpha-service', status: 'running' } : undefined,
    64	      getProjectOpsOverride: (projectId: string) => overrideStore.get(projectId),
    65	      setProjectOpsOverride: (projectId: string, override: ProjectOpsOverride) =>
    66	        overrideStore.set(projectId, override),
    67	      deleteProjectOpsOverride: (projectId: string) => overrideStore.del(projectId),
    68	      listOpsIncidentsByProject: () => [],
    69	      listOpsIncidentsByDateRange: () => [],
    70	      listOpsIncidentEventsByIncidentIds: () => [],
    71	      listOpsIncidentEvents: () => [],
    72	      getOpsIncident: () => undefined,
    73	      getCircuitBreakerState: () => null,
    74	      resetCircuitBreaker: vi.fn(),
    75	      listAllCircuitBreakers: () => [],
    76	      listProjects: () => [{ id: 'proj-1', name: 'alpha-service', status: 'running' }],
    77	      listServices: () => [],
    78	      findAllProjectDependencies: () => [],
    79	      getActionRunsByProject: () => [],
    80	      getActionRunsByApprovalStatus: () => [],
    81	    },
    82	  } as unknown as AppContext;
    83
    84	  const app = new Hono();
    85	  app.route('/api', createOpsRoutes(ctx));
    86	  return { app, overrideStore };
    87	}
    88
    89	// ---------------------------------------------------------------------------
    90	// Automation policy round-trip tests
    91	// ---------------------------------------------------------------------------
    92
    93	describe('PUT /api/projects/:projectId/automation → GET returns same values', () => {
    94	  let harness: ReturnType<typeof createHarness>;
    95
    96	  beforeEach(() => {
    97	    harness = createHarness();
    98	  });
    99
   100	  it('PUT sets rollback to auto and GET reflects the change in overrides', async () => {
   101	    const putResponse = await harness.app.request('/api/projects/proj-1/automation', {
   102	      method: 'PUT',
   103	      headers: { 'Content-Type': 'application/json' },
   104	      body: JSON.stringify({ automation: { rollback: 'auto' } }),
   105	    });
   106	    expect(putResponse.status).toBe(200);
   107
   108	    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
   109	    expect(getResponse.status).toBe(200);
   110
   111	    const body = (await getResponse.json()) as {
   112	      overrides: Record<string, string>;
   113	      effective: Record<string, string>;
   114	    };
   115	    expect(body.overrides).not.toBeNull();
   116	    expect(body.overrides['rollback']).toBe('auto');
   117	    expect(body.effective['rollback']).toBe('auto');
   118	  });
   119
   120	  it('PUT sets apply_fixes to confirm and GET reflects the change in overrides', async () => {
   121	    await harness.app.request('/api/projects/proj-1/automation', {
   122	      method: 'PUT',
   123	      headers: { 'Content-Type': 'application/json' },
   124	      body: JSON.stringify({ automation: { apply_fixes: 'confirm' } }),
   125	    });
   126
   127	    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
   128	    const body = (await getResponse.json()) as {
   129	      overrides: Record<string, string>;
   130	      effective: Record<string, string>;
   131	    };
   132	    expect(body.overrides['apply_fixes']).toBe('confirm');
   133	    expect(body.effective['apply_fixes']).toBe('confirm');
   134	  });
   135
   136	  it('PUT full policy and GET returns all four steps with correct values', async () => {
   137	    const putResponse = await harness.app.request('/api/projects/proj-1/automation', {
   138	      method: 'PUT',
   139	      headers: { 'Content-Type': 'application/json' },
   140	      body: JSON.stringify({
   141	        automation: { restart: 'auto', diagnosis: 'auto', apply_fixes: 'auto', rollback: 'auto' },
   142	      }),
   143	    });
   144	    expect(putResponse.status).toBe(200);
   145
   146	    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
   147	    const body = (await getResponse.json()) as {
   148	      effective: Record<string, string>;
   149	      isAutopilot: boolean;
   150	    };
   151	    expect(body.effective['restart']).toBe('auto');
   152	    expect(body.effective['diagnosis']).toBe('auto');
   153	    expect(body.effective['apply_fixes']).toBe('auto');
   154	    expect(body.effective['rollback']).toBe('auto');
   155	    expect(body.isAutopilot).toBe(true);
   156	  });
   157
   158	  it('PUT partial policy merges with existing overrides rather than replacing them', async () => {
   159	    // First PUT sets rollback to auto
   160	    await harness.app.request('/api/projects/proj-1/automation', {
   161	      method: 'PUT',
   162	      headers: { 'Content-Type': 'application/json' },
   163	      body: JSON.stringify({ automation: { rollback: 'auto' } }),
   164	    });
   165
   166	    // Second PUT sets apply_fixes to auto — rollback must still be auto
   167	    await harness.app.request('/api/projects/proj-1/automation', {
   168	      method: 'PUT',
   169	      headers: { 'Content-Type': 'application/json' },
   170	      body: JSON.stringify({ automation: { apply_fixes: 'auto' } }),
   171	    });
   172
   173	    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
   174	    const body = (await getResponse.json()) as { overrides: Record<string, string> };
   175	    expect(body.overrides['rollback']).toBe('auto');
   176	    expect(body.overrides['apply_fixes']).toBe('auto');
   177	  });
   178
   179	  it('PUT returns 400 when automation step name is invalid', async () => {
   180	    const response = await harness.app.request('/api/projects/proj-1/automation', {
   181	      method: 'PUT',
   182	      headers: { 'Content-Type': 'application/json' },
   183	      body: JSON.stringify({ automation: { unknown_step: 'auto' } }),
   184	    });
   185	    expect(response.status).toBe(400);
   186	    const body = (await response.json()) as { error: string };
   187	    expect(typeof body.error).toBe('string');
   188	  });
   189
   190	  it('PUT returns 400 when automation mode value is invalid', async () => {
   191	    const response = await harness.app.request('/api/projects/proj-1/automation', {
   192	      method: 'PUT',
   193	      headers: { 'Content-Type': 'application/json' },
   194	      body: JSON.stringify({ automation: { rollback: 'skip' } }),
   195	    });
   196	    expect(response.status).toBe(400);
   197	  });
   198
   199	  it('PUT returns 404 when project does not exist', async () => {
   200	    const response = await harness.app.request('/api/projects/nonexistent/automation', {
   201	      method: 'PUT',
   202	      headers: { 'Content-Type': 'application/json' },
   203	      body: JSON.stringify({ automation: { rollback: 'auto' } }),
   204	    });
   205	    expect(response.status).toBe(404);
   206	  });
   207
   208	  it('GET returns 404 when project does not exist', async () => {
   209	    const response = await harness.app.request('/api/projects/nonexistent/automation');
   210	    expect(response.status).toBe(404);
   211	  });
   212	});
   213
   214	// ---------------------------------------------------------------------------
   215	// DELETE → GET returns defaults
   216	// ---------------------------------------------------------------------------
   217
   218	describe('DELETE /api/projects/:projectId/automation → GET returns defaults', () => {
   219	  let harness: ReturnType<typeof createHarness>;
   220
   221	  beforeEach(() => {
   222	    harness = createHarness();
   223	  });
   224
   225	  it('DELETE clears project override and GET effective policy falls back to global defaults', async () => {
   226	    // Arrange: set a project override first
   227	    await harness.app.request('/api/projects/proj-1/automation', {
   228	      method: 'PUT',
   229	      headers: { 'Content-Type': 'application/json' },
   230	      body: JSON.stringify({ automation: { rollback: 'auto', apply_fixes: 'auto' } }),
   231	    });
   232
   233	    // Verify override is set
   234	    const before = (await (
   235	      await harness.app.request('/api/projects/proj-1/automation')
   236	    ).json()) as { overrides: Record<string, string> | null };
   237	    expect(before.overrides).not.toBeNull();
   238
   239	    // Act: delete the override
   240	    const deleteResponse = await harness.app.request('/api/projects/proj-1/automation', {
   241	      method: 'DELETE',
   242	    });
   243	    expect(deleteResponse.status).toBe(200);
   244	    const deleteBody = (await deleteResponse.json()) as { deleted: boolean };
   245	    expect(deleteBody.deleted).toBe(true);
   246
   247	    // Assert: GET now returns null overrides and effective matches global defaults
   248	    const after = (await (await harness.app.request('/api/projects/proj-1/automation')).json()) as {
   249	      effective: Record<string, string>;
   250	      overrides: Record<string, string> | null;
   251	    };
   252	    expect(after.overrides).toBeNull();
   253	    expect(after.effective['rollback']).toBe(DEFAULT_RECOVERY_AUTOMATION.rollback);
   254	    expect(after.effective['apply_fixes']).toBe(DEFAULT_RECOVERY_AUTOMATION.apply_fixes);
   255	    expect(after.effective['restart']).toBe(DEFAULT_RECOVERY_AUTOMATION.restart);
   256	    expect(after.effective['diagnosis']).toBe(DEFAULT_RECOVERY_AUTOMATION.diagnosis);
   257	  });
   258
   259	  it('DELETE on a project with no existing override still returns deleted:true', async () => {
   260	    // No prior PUT — deleting a non-existent override must not fail

exec
/bin/bash -lc "nl -ba test/web/api/ops-routes.test.ts | sed -n '260,520p'" in /home/lee/OpenLander
 succeeded in 0ms:
   260	    // No prior PUT — deleting a non-existent override must not fail
   261	    const deleteResponse = await harness.app.request('/api/projects/proj-1/automation', {
   262	      method: 'DELETE',
   263	    });
   264	    expect(deleteResponse.status).toBe(200);
   265	    const body = (await deleteResponse.json()) as { deleted: boolean };
   266	    expect(body.deleted).toBe(true);
   267	  });
   268
   269	  it('GET effective policy after DELETE equals DEFAULT_RECOVERY_AUTOMATION exactly', async () => {
   270	    // Arrange: set all steps to auto (overriding defaults where they differ)
   271	    await harness.app.request('/api/projects/proj-1/automation', {
   272	      method: 'PUT',
   273	      headers: { 'Content-Type': 'application/json' },
   274	      body: JSON.stringify({
   275	        automation: { restart: 'auto', diagnosis: 'auto', apply_fixes: 'auto', rollback: 'auto' },
   276	      }),
   277	    });
   278
   279	    // Act: delete
   280	    await harness.app.request('/api/projects/proj-1/automation', { method: 'DELETE' });
   281
   282	    // Assert: effective matches DEFAULT_RECOVERY_AUTOMATION step by step
   283	    const getResponse = await harness.app.request('/api/projects/proj-1/automation');
   284	    const body = (await getResponse.json()) as { effective: Record<string, string> };
   285
   286	    for (const [step, mode] of Object.entries(DEFAULT_RECOVERY_AUTOMATION)) {
   287	      expect(body.effective[step], `step ${step} must match default after DELETE`).toBe(mode);
   288	    }
   289	  });
   290	});
   291
   292	// ---------------------------------------------------------------------------
   293	// Automation defaults endpoint
   294	// ---------------------------------------------------------------------------
   295
   296	describe('GET /api/automation/defaults', () => {
   297	  let harness: ReturnType<typeof createHarness>;
   298
   299	  beforeEach(() => {
   300	    harness = createHarness();
   301	  });
   302
   303	  it('returns defaults field equal to DEFAULT_RECOVERY_AUTOMATION', async () => {
   304	    const response = await harness.app.request('/api/automation/defaults');
   305	    expect(response.status).toBe(200);
   306	    const body = (await response.json()) as { defaults: Record<string, string> };
   307	    for (const [step, mode] of Object.entries(DEFAULT_RECOVERY_AUTOMATION)) {
   308	      expect(body.defaults[step]).toBe(mode);
   309	    }
   310	  });
   311
   312	  it('returns effective field with all four configurable steps', async () => {
   313	    const response = await harness.app.request('/api/automation/defaults');
   314	    const body = (await response.json()) as { effective: Record<string, string> | null };
   315	    const steps = ['restart', 'diagnosis', 'apply_fixes', 'rollback'];
   316	    if (body.effective !== null) {
   317	      for (const step of steps) {
   318	        expect(body.effective[step]).toBeDefined();
   319	      }
   320	    }
   321	  });
   322
   323	  it('returns isAutopilot boolean field', async () => {
   324	    const response = await harness.app.request('/api/automation/defaults');
   325	    const body = (await response.json()) as { isAutopilot: unknown };
   326	    expect(typeof body.isAutopilot).toBe('boolean');
   327	  });
   328	});

exec
/bin/bash -lc "nl -ba test/pipeline/auto-recovery.test.ts | sed -n '520,840p'" in /home/lee/OpenLander
 succeeded in 0ms:
   520	  });
   521	});
   522
   523	// ── Automation policy tests ────────────────────────────────────────────────────
   524
   525	describe('setupAutoRecovery — automation policy', () => {
   526	  beforeEach(() => {
   527	    vi.useFakeTimers();
   528	  });
   529
   530	  afterEach(() => {
   531	    vi.useRealTimers();
   532	  });
   533
   534	  it('skips approval gate when automationPolicy.rollback is auto for rollback_project tool', async () => {
   535	    const autoSkippedHandler = vi.fn();
   536
   537	    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
   538	      await onEvent({
   539	        type: 'tool_call',
   540	        toolName: 'rollback_project',
   541	        arguments: { project_name: 'proj-auto-policy' },
   542	        stepIndex: 0,
   543	      });
   544	    });
   545
   546	    const policy: RecoveryAutomationPolicy = {
   547	      restart: 'auto',
   548	      diagnosis: 'auto',
   549	      apply_fixes: 'auto',
   550	      rollback: 'auto',
   551	    };
   552
   553	    const harness = createHarness({
   554	      agent: { chatStream: agentChatMock },
   555	      getAutomationPolicy: () => policy,
   556	    });
   557
   558	    harness.eventBus.on('recovery:approval-auto-skipped', autoSkippedHandler);
   559
   560	    try {
   561	      const projectId = 'proj-auto-policy';
   562	      harness.db.createProject({
   563	        id: projectId,
   564	        name: projectId,
   565	        repoUrl: 'https://github.com/openlander/proj-auto-policy',
   566	        branch: 'main',
   567	      });
   568	      harness.db.updateProject(projectId, { status: 'running' });
   569
   570	      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
   571	        projectId,
   572	        'unknown build failure requiring ai',
   573	        'build',
   574	      );
   575	      await vi.advanceTimersByTimeAsync(2_100);
   576
   577	      // With rollback='auto', no pending approval should be set
   578	      const runs = harness.db.getActionRunsByProject(projectId, 1);
   579	      expect(runs).toHaveLength(1);
   580	      expect(runs[0].approval_status).not.toBe('pending');
   581
   582	      // Audit event must be emitted
   583	      expect(autoSkippedHandler).toHaveBeenCalledOnce();
   584	      expect(autoSkippedHandler).toHaveBeenCalledWith(
   585	        expect.objectContaining({
   586	          projectId,
   587	          toolName: 'rollback_project',
   588	          recoveryStep: 'rollback',
   589	        }),
   590	      );
   591
   592	      // Let recovery complete (agent stream ended; wait for outcome timeout)
   593	      await vi.advanceTimersByTimeAsync(300_000);
   594	      await recoveryPromise;
   595	    } finally {
   596	      harness.db.close();
   597	      rmSync(harness.tmpDir, { recursive: true, force: true });
   598	    }
   599	  });
   600
   601	  it('triggers approval gate when automationPolicy.rollback is confirm for rollback_project tool', async () => {
   602	    const approvalNeededHandler = vi.fn();
   603
   604	    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
   605	      await onEvent({
   606	        type: 'tool_call',
   607	        toolName: 'rollback_project',
   608	        arguments: { project_name: 'proj-confirm-policy' },
   609	        stepIndex: 0,
   610	      });
   611	    });
   612
   613	    const policy: RecoveryAutomationPolicy = {
   614	      restart: 'auto',
   615	      diagnosis: 'auto',
   616	      apply_fixes: 'auto',
   617	      rollback: 'confirm',
   618	    };
   619
   620	    const harness = createHarness({
   621	      agent: { chatStream: agentChatMock },
   622	      getAutomationPolicy: () => policy,
   623	    });
   624
   625	    harness.eventBus.on('recovery:approval-needed', approvalNeededHandler);
   626
   627	    try {
   628	      const projectId = 'proj-confirm-policy';
   629	      harness.db.createProject({
   630	        id: projectId,
   631	        name: projectId,
   632	        repoUrl: 'https://github.com/openlander/proj-confirm-policy',
   633	        branch: 'main',
   634	      });
   635	      harness.db.updateProject(projectId, { status: 'running' });
   636
   637	      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
   638	        projectId,
   639	        'unknown build failure requiring ai',
   640	        'build',
   641	      );
   642	      await vi.advanceTimersByTimeAsync(2_100);
   643
   644	      // With rollback='confirm', approval should be pending
   645	      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
   646	      expect(pendingRun.approval_status).toBe('pending');
   647	      expect(pendingRun.approval_tool).toBe('rollback_project');
   648
   649	      // Approval event must be emitted
   650	      expect(approvalNeededHandler).toHaveBeenCalledOnce();
   651	      expect(approvalNeededHandler).toHaveBeenCalledWith(
   652	        expect.objectContaining({
   653	          projectId,
   654	          toolName: 'rollback_project',
   655	        }),
   656	      );
   657
   658	      // Resolve by rejection so the recovery promise can settle
   659	      harness.recoveryHandlers.resolveApproval(pendingRun.id, false);
   660	      await vi.advanceTimersByTimeAsync(0);
   661	      await recoveryPromise;
   662	    } finally {
   663	      harness.db.close();
   664	      rmSync(harness.tmpDir, { recursive: true, force: true });
   665	    }
   666	  });
   667
   668	  it('uses DecisionEngine fallback (requires approval) when policy is null', async () => {
   669	    const approvalNeededHandler = vi.fn();
   670
   671	    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
   672	      await onEvent({
   673	        type: 'tool_call',
   674	        toolName: 'rollback_project',
   675	        arguments: { project_name: 'proj-null-policy' },
   676	        stepIndex: 0,
   677	      });
   678	    });
   679
   680	    // getAutomationPolicy returns null → no policy active
   681	    const harness = createHarness({
   682	      agent: { chatStream: agentChatMock },
   683	      getAutomationPolicy: () => null,
   684	    });
   685
   686	    harness.eventBus.on('recovery:approval-needed', approvalNeededHandler);
   687
   688	    try {
   689	      const projectId = 'proj-null-policy';
   690	      harness.db.createProject({
   691	        id: projectId,
   692	        name: projectId,
   693	        repoUrl: 'https://github.com/openlander/proj-null-policy',
   694	        branch: 'main',
   695	      });
   696	      harness.db.updateProject(projectId, { status: 'running' });
   697
   698	      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
   699	        projectId,
   700	        'unknown build failure requiring ai',
   701	        'build',
   702	      );
   703	      await vi.advanceTimersByTimeAsync(2_100);
   704
   705	      // With null policy, DecisionEngine classifies rollback_project as REQUIRE_APPROVAL
   706	      const pendingRun = harness.db.getActionRunsByProject(projectId, 1)[0];
   707	      expect(pendingRun.approval_status).toBe('pending');
   708	      expect(approvalNeededHandler).toHaveBeenCalledOnce();
   709
   710	      harness.recoveryHandlers.resolveApproval(pendingRun.id, false);
   711	      await vi.advanceTimersByTimeAsync(0);
   712	      await recoveryPromise;
   713	    } finally {
   714	      harness.db.close();
   715	      rmSync(harness.tmpDir, { recursive: true, force: true });
   716	    }
   717	  });
   718
   719	  it('uses DecisionEngine fallback for unmapped tool even when policy is set', async () => {
   720	    // 'create_deploy_plan' is NOTIFY_THEN_ALLOW (medium risk), not in TOOL_TO_RECOVERY_STEP
   721	    // Even with a policy, an unmapped tool must fall through to DecisionEngine logic
   722	    const approvalNeededHandler = vi.fn();
   723	    const autoSkippedHandler = vi.fn();
   724
   725	    const agentChatMock = vi.fn<AutoRecoveryAgent['chatStream']>(async (_input, onEvent) => {
   726	      await onEvent({
   727	        type: 'tool_call',
   728	        toolName: 'create_deploy_plan',
   729	        arguments: { project_id: 'proj-unmapped-tool' },
   730	        stepIndex: 0,
   731	      });
   732	    });
   733
   734	    const policy: RecoveryAutomationPolicy = {
   735	      restart: 'auto',
   736	      diagnosis: 'auto',
   737	      apply_fixes: 'auto',
   738	      rollback: 'auto',
   739	    };
   740
   741	    const harness = createHarness({
   742	      agent: { chatStream: agentChatMock },
   743	      getAutomationPolicy: () => policy,
   744	    });
   745
   746	    harness.eventBus.on('recovery:approval-needed', approvalNeededHandler);
   747	    harness.eventBus.on('recovery:approval-auto-skipped', autoSkippedHandler);
   748
   749	    try {
   750	      const projectId = 'proj-unmapped-tool';
   751	      harness.db.createProject({
   752	        id: projectId,
   753	        name: projectId,
   754	        repoUrl: 'https://github.com/openlander/proj-unmapped-tool',
   755	        branch: 'main',
   756	      });
   757	      harness.db.updateProject(projectId, { status: 'running' });
   758
   759	      const recoveryPromise = harness.recoveryHandlers.handleDeploymentRecovery(
   760	        projectId,
   761	        'unknown build failure requiring ai',
   762	        'build',
   763	      );
   764	      await vi.advanceTimersByTimeAsync(2_100);
   765
   766	      // create_deploy_plan is medium risk → NOTIFY_THEN_ALLOW → no approval needed
   767	      expect(approvalNeededHandler).not.toHaveBeenCalled();
   768	      expect(autoSkippedHandler).not.toHaveBeenCalled();
   769
   770	      // Let recovery complete (no approval gate blocking it)
   771	      await vi.advanceTimersByTimeAsync(300_000);
   772	      await recoveryPromise;
   773	    } finally {
   774	      harness.db.close();
   775	      rmSync(harness.tmpDir, { recursive: true, force: true });
   776	    }
   777	  });
   778
   779	  it('TOOL_TO_RECOVERY_STEP maps every HIGH_RISK_DEFAULTS tool to a configurable step', () => {
   780	    // These are the exact tools DecisionEngine classifies as REQUIRE_APPROVAL by default.
   781	    // All of them must exist in TOOL_TO_RECOVERY_STEP so the policy can override them.
   782	    const HIGH_RISK_TOOLS = [
   783	      'rollback_project',
   784	      'remove_project',
   785	      'remove_service',
   786	      'create_database',
   787	      'platform_cleanup_orphans',
   788	      'platform_reconcile',
   789	      'platform_force_remove',
   790	      'remove_volume',
   791	    ] as const;
   792
   793	    const validSteps = new Set(['restart', 'diagnosis', 'apply_fixes', 'rollback']);
   794
   795	    for (const tool of HIGH_RISK_TOOLS) {
   796	      const mappedStep = TOOL_TO_RECOVERY_STEP[tool];
   797	      expect(mappedStep, `${tool} must be mapped in TOOL_TO_RECOVERY_STEP`).toBeDefined();
   798	      expect(validSteps, `${tool} must map to a valid ConfigurableRecoveryStep`).toContain(
   799	        mappedStep,
   800	      );
   801	    }
   802	  });
   803	});

codex
I’ve confirmed one real integration risk around live config reads. I’m doing one more pass across the recovery planner/types to separate that from any merely debatable mapping choices in `TOOL_TO_RECOVERY_STEP`.
exec
/bin/bash -lc "rg -n \"apply_fixes|rollback|restart|diagnosis|automation\" src/monitor src/pipeline | sed -n '1,240p'" in /home/lee/OpenLander
 succeeded in 0ms:
src/pipeline/auto-recovery.ts:32:  rollback_project: 'rollback',
src/pipeline/auto-recovery.ts:33:  remove_project: 'rollback',
src/pipeline/auto-recovery.ts:34:  platform_force_remove: 'rollback',
src/pipeline/auto-recovery.ts:35:  remove_service: 'rollback',
src/pipeline/auto-recovery.ts:36:  remove_volume: 'rollback',
src/pipeline/auto-recovery.ts:37:  create_database: 'apply_fixes',
src/pipeline/auto-recovery.ts:38:  platform_cleanup_orphans: 'apply_fixes',
src/pipeline/auto-recovery.ts:39:  platform_reconcile: 'apply_fixes',
src/pipeline/auto-recovery.ts:81:  handleRollbackSuggested(payload: EventPayload['rollback:suggested']): Promise<void>;
src/pipeline/auto-recovery.ts:417:        // Snapshot automation policy at session start so mid-recovery config changes
src/pipeline/auto-recovery.ts:469:              // Check automation policy before requiring manual approval
src/pipeline/auto-recovery.ts:484:                    'Approval skipped by automation policy (auto mode)',
src/pipeline/auto-recovery.ts:716:        const diagnosis = await buildDebugger.diagnose({
src/pipeline/auto-recovery.ts:722:        await emitTimelineMessage(eventBus, projectId, `Debug summary: ${diagnosis.summary}`);
src/pipeline/auto-recovery.ts:872:  function handleRollbackSuggested(payload: EventPayload['rollback:suggested']): Promise<void> {
src/pipeline/auto-recovery.ts:873:    if (!config.ai.rollbackSuggestion.enabled) return Promise.resolve();
src/pipeline/auto-recovery.ts:877:        category: 'rollback_suggested',
src/pipeline/auto-recovery.ts:882:            label: `Review rollback to previous image ${payload.previousImageTag}`,
src/pipeline/auto-recovery.ts:888:    const message = `Health checks are failing for ${payload.projectName} after deployment. ${String(payload.consecutiveFailures)} consecutive failures. Previous version available (${payload.previousImageTag}). Ask the user if they want to rollback.`;
src/pipeline/auto-recovery.ts:899:          `rollback-${payload.projectId}`,
src/pipeline/auto-recovery.ts:903:      { projectId: payload.projectId, eventType: 'rollback:suggested' },
src/monitor/llm-diagnosis.ts:7:const log = createModuleLogger('llm-diagnosis');
src/monitor/llm-diagnosis.ts:9:const DIAGNOSIS_SYSTEM_PROMPT = `You are a runtime crash diagnosis assistant for Dockerized applications.
src/monitor/llm-diagnosis.ts:11:Given crash context from OpenLander (category, restart count, stderr snippet), produce:
src/monitor/llm-diagnosis.ts:23:  restartCount: number;
src/monitor/llm-diagnosis.ts:33:    if (typeof existing.diagnosis === 'string' && existing.diagnosis.trim().length > 0) {
src/monitor/llm-diagnosis.ts:43:        'Skipping runtime diagnosis — no AI provider configured',
src/monitor/llm-diagnosis.ts:49:    const prompt = `A container has crashed ${String(params.restartCount)} times.
src/monitor/llm-diagnosis.ts:56:    const diagnosisStartTime = Date.now();
src/monitor/llm-diagnosis.ts:65:    const diagnosis = response.text.trim();
src/monitor/llm-diagnosis.ts:66:    const durationMs = Date.now() - diagnosisStartTime;
src/monitor/llm-diagnosis.ts:78:      result: diagnosis.length > 0 ? 'success' : 'failure',
src/monitor/llm-diagnosis.ts:83:    if (diagnosis.length === 0) {
src/monitor/llm-diagnosis.ts:92:      typeof latestIncident.diagnosis === 'string' &&
src/monitor/llm-diagnosis.ts:93:      latestIncident.diagnosis.trim().length > 0
src/monitor/llm-diagnosis.ts:98:    params.db.updateRuntimeIncidentDiagnosis(params.incidentId, diagnosis);
src/monitor/llm-diagnosis.ts:99:    return diagnosis;
src/monitor/llm-diagnosis.ts:106:        restartCount: params.restartCount,
src/monitor/llm-diagnosis.ts:109:      'LLM runtime diagnosis failed',
src/monitor/ops-config-resolver.ts:4: * Resolves the effective automation policy for recovery operations.
src/monitor/ops-config-resolver.ts:5: * Implements 3-tier merge: DEFAULT → globalConfig.recovery.automation → projectOverride?.automation
src/monitor/ops-config-resolver.ts:17: * Resolves the effective automation policy for a recovery operation.
src/monitor/ops-config-resolver.ts:18: * Applies 3-tier merge: DEFAULT → globalConfig.recovery.automation → projectOverride?.automation
src/monitor/ops-config-resolver.ts:34:  const steps: ConfigurableRecoveryStep[] = ['restart', 'diagnosis', 'apply_fixes', 'rollback'];
src/monitor/ops-config-resolver.ts:38:  const globalAutomation = globalConfig.recovery.automation as Partial<RecoveryAutomationPolicy>;
src/monitor/ops-config-resolver.ts:47:  if (projectOverride?.automation) {
src/monitor/ops-config-resolver.ts:49:      const override = projectOverride.automation[step];
src/monitor/ops-config-resolver.ts:66:  const steps: ConfigurableRecoveryStep[] = ['restart', 'diagnosis', 'apply_fixes', 'rollback'];
src/pipeline/recipes.ts:5: * instant diagnosis without requiring an LLM call.
src/pipeline/recipes.ts:6: * When a recipe matches, the diagnosis is returned directly.
src/pipeline/recipes.ts:16:  diagnosis: string;
src/pipeline/recipes.ts:54:    diagnosis:
src/pipeline/recipes.ts:64:    diagnosis:
src/pipeline/recipes.ts:76:    diagnosis: 'The `sharp` package requires `libvips` which is not available in the base image.',
src/pipeline/recipes.ts:82:    diagnosis:
src/pipeline/recipes.ts:89:    diagnosis:
src/pipeline/recipes.ts:96:    diagnosis:
src/pipeline/recipes.ts:109:    diagnosis:
src/pipeline/recipes.ts:116:    diagnosis: 'A required module is not installed or the import path is wrong.',
src/pipeline/recipes.ts:122:    diagnosis: 'The build or run process lacks permissions to access a file or directory.',
src/pipeline/recipes.ts:128:    diagnosis:
src/pipeline/recipes.ts:136:    diagnosis:
src/pipeline/recipes.ts:144:    diagnosis:
src/pipeline/recipes.ts:152:    diagnosis:
src/pipeline/recipes.ts:160:    diagnosis:
src/pipeline/recipes.ts:168:    diagnosis:
src/pipeline/recipes.ts:175:    diagnosis:
src/pipeline/recipes.ts:183:    diagnosis:
src/pipeline/recipes.ts:191:    diagnosis:
src/pipeline/recipes.ts:199:    diagnosis:
src/pipeline/recipes.ts:206:    diagnosis: 'The application is trying to bind to a port that is already in use.',
src/pipeline/recipes.ts:213:    diagnosis:
src/pipeline/recipes.ts:220:    diagnosis:
src/pipeline/recipes.ts:227:    diagnosis:
src/pipeline/recipes.ts:234:    diagnosis:
src/pipeline/recipes.ts:242:    diagnosis:
src/pipeline/recipes.ts:249:    diagnosis:
src/pipeline/port.ts:117:    // Include ports from running AND restarting containers
src/pipeline/port.ts:119:      .filter((c) => c.state === 'running' || c.state === 'restarting')
src/pipeline/docker.ts:46:  /** Docker restart policy (default: on-failure with MaximumRetryCount: 5). */
src/pipeline/docker.ts:47:  restartPolicy?: { Name: string; MaximumRetryCount?: number };
src/pipeline/docker.ts:60:  restart?: string;
src/pipeline/docker.ts:469:        RestartPolicy: options.restartPolicy ?? { Name: 'on-failure', MaximumRetryCount: 5 },
src/pipeline/docker.ts:496:    const restartPolicyName =
src/pipeline/docker.ts:497:      opts.restart === 'no' ||
src/pipeline/docker.ts:498:      opts.restart === 'always' ||
src/pipeline/docker.ts:499:      opts.restart === 'on-failure' ||
src/pipeline/docker.ts:500:      opts.restart === 'unless-stopped'
src/pipeline/docker.ts:501:        ? opts.restart
src/pipeline/docker.ts:543:        RestartPolicy: { Name: restartPolicyName },
src/pipeline/docker.ts:869:   * Detects crash loops (container restarts) and immediate exits.
src/pipeline/docker.ts:885:            error: `Container is in restart loop (exit code: ${String(info.State.ExitCode)})`,
src/pipeline/docker.ts:925:          error: `Container entered restart loop (exit code: ${String(info.State.ExitCode)})`,
src/pipeline/traefik.ts:492:      // Only check running or restarting containers
src/pipeline/traefik.ts:493:      if (container.state !== 'running' && container.state !== 'restarting') {
src/monitor/ops-recovery.ts:26:    diagnosisPrompt: (name: string, reason: string) => string;
src/monitor/ops-recovery.ts:27:    fixesWithDiagnosis: (name: string, reason: string, diagnosis: string) => string;
src/monitor/ops-recovery.ts:29:    rollback: (name: string, reason: string) => string;
src/monitor/ops-recovery.ts:34:    diagnosisPrompt: (name, reason) =>
src/monitor/ops-recovery.ts:36:    fixesWithDiagnosis: (name, reason, diagnosis) =>
src/monitor/ops-recovery.ts:37:      `[${name}]\n\n📌 원인\n${reason}\n\n🔍 진단\n${diagnosis.slice(0, 200)}\n\n🔧 조치\n자동 수정을 적용합니다.`,
src/monitor/ops-recovery.ts:40:    rollback: (name, reason) =>
src/monitor/ops-recovery.ts:46:    diagnosisPrompt: (name, reason) =>
src/monitor/ops-recovery.ts:48:    fixesWithDiagnosis: (name, reason, diagnosis) =>
src/monitor/ops-recovery.ts:49:      `[${name}]\n\n📌 Cause\n${reason}\n\n🔍 Diagnosis\n${diagnosis.slice(0, 200)}\n\n🔧 Action\nApplying automatic fixes.`,
src/monitor/ops-recovery.ts:52:    rollback: (name, reason) =>
src/monitor/ops-recovery.ts:64:  automationPolicy: RecoveryAutomationPolicy;
src/monitor/ops-recovery.ts:157:    const mode = context.automationPolicy[step];
src/monitor/ops-recovery.ts:222:    const restartGate = await this.gateStep(context, 'restart', 'Container restart');
src/monitor/ops-recovery.ts:223:    if (restartGate !== 'proceed') {
src/monitor/ops-recovery.ts:226:        `Recovery gated: restart step ${restartGate} by operator`,
src/monitor/ops-recovery.ts:230:    this.addIncidentEvent(incidentId, 'action_taken', 'Step restart: attempting container restart');
src/monitor/ops-recovery.ts:231:    const restartResult = await this.restartContainer(projectId, containerId);
src/monitor/ops-recovery.ts:232:    if (!restartResult.success) {
src/monitor/ops-recovery.ts:234:      const restartFailureReason = `Restart failed: ${restartResult.reason}`;
src/monitor/ops-recovery.ts:236:      const diagnosisGate = await this.gateStep(
src/monitor/ops-recovery.ts:238:        'diagnosis',
src/monitor/ops-recovery.ts:239:        this.msg.diagnosisPrompt(context.projectName, restartFailureReason),
src/monitor/ops-recovery.ts:241:      if (diagnosisGate !== 'proceed') {
src/monitor/ops-recovery.ts:244:          `Recovery gated: diagnosis step ${diagnosisGate} by operator`,
src/monitor/ops-recovery.ts:251:        `Step diagnosis: ${restartFailureReason}`,
src/monitor/ops-recovery.ts:254:      const restartLogs = await this.readContainerLogs(context.containerId);
src/monitor/ops-recovery.ts:255:      const restartDiagnosis = await this.generateDiagnosis(
src/monitor/ops-recovery.ts:257:        restartFailureReason,
src/monitor/ops-recovery.ts:258:        restartLogs,
src/monitor/ops-recovery.ts:260:      if (restartDiagnosis && context.incidentId) {
src/monitor/ops-recovery.ts:262:          diagnosis: restartDiagnosis,
src/monitor/ops-recovery.ts:263:          root_cause: restartFailureReason,
src/monitor/ops-recovery.ts:267:      let restartFixNotes: string[] = [];
src/monitor/ops-recovery.ts:268:      const fixesDesc = restartDiagnosis
src/monitor/ops-recovery.ts:269:        ? this.msg.fixesWithDiagnosis(context.projectName, restartFailureReason, restartDiagnosis)
src/monitor/ops-recovery.ts:270:        : this.msg.fixesNoDiagnosis(context.projectName, restartFailureReason);
src/monitor/ops-recovery.ts:271:      const fixesGate = await this.gateStep(context, 'apply_fixes', fixesDesc);
src/monitor/ops-recovery.ts:273:        restartFixNotes = await this.applyFixes(context, restartLogs);
src/monitor/ops-recovery.ts:274:        if (restartFixNotes.length > 0) {
src/monitor/ops-recovery.ts:278:            `Step fix: ${restartFixNotes.join(' | ')}`,
src/monitor/ops-recovery.ts:282:              actions_taken: restartFixNotes.join('\n'),
src/monitor/ops-recovery.ts:288:      const rollbackDesc = this.msg.rollback(context.projectName, restartFailureReason);
src/monitor/ops-recovery.ts:289:      const rollbackGate = await this.gateStep(context, 'rollback', rollbackDesc);
src/monitor/ops-recovery.ts:290:      if (rollbackGate !== 'proceed') {
src/monitor/ops-recovery.ts:293:          `Recovery gated: rollback step ${rollbackGate} by operator`,
src/monitor/ops-recovery.ts:299:        `${restartFailureReason}; ${restartFixNotes.join('; ')}`,
src/monitor/ops-recovery.ts:310:      this.addIncidentEvent(incidentId, 'recovered', 'Container recovered after restart');
src/monitor/ops-recovery.ts:318:    const healthFailureReason = 'Health check failed after restart (3 attempts over 90 seconds)';
src/monitor/ops-recovery.ts:320:    const diagnosisGate = await this.gateStep(
src/monitor/ops-recovery.ts:322:      'diagnosis',
src/monitor/ops-recovery.ts:323:      this.msg.diagnosisPrompt(context.projectName, healthFailureReason),
src/monitor/ops-recovery.ts:325:    if (diagnosisGate !== 'proceed') {
src/monitor/ops-recovery.ts:328:        `Recovery gated: diagnosis step ${diagnosisGate} by operator`,
src/monitor/ops-recovery.ts:335:      `Step diagnosis: ${healthFailureReason}`,
src/monitor/ops-recovery.ts:342:        diagnosis: healthDiagnosis,
src/monitor/ops-recovery.ts:351:    const fixesGate = await this.gateStep(context, 'apply_fixes', healthFixesDesc);
src/monitor/ops-recovery.ts:368:    const healthRollbackDesc = this.msg.rollback(context.projectName, healthFailureReason);
src/monitor/ops-recovery.ts:369:    const rollbackGate = await this.gateStep(context, 'rollback', healthRollbackDesc);
src/monitor/ops-recovery.ts:370:    if (rollbackGate !== 'proceed') {
src/monitor/ops-recovery.ts:373:        `Recovery gated: rollback step ${rollbackGate} by operator`,
src/monitor/ops-recovery.ts:380:  private async restartContainer(
src/monitor/ops-recovery.ts:385:      await this.ctx.docker.getClient().getContainer(containerId).restart();
src/monitor/ops-recovery.ts:386:      log.info({ projectId, containerId }, 'Container restart step completed');
src/monitor/ops-recovery.ts:390:      log.error({ projectId, containerId, error }, 'Container restart step failed');
src/monitor/ops-recovery.ts:441:        log.warn({ projectId: context.projectId }, 'No LLM model available for recovery diagnosis');
src/monitor/ops-recovery.ts:459:      const diagnosis = response.text.trim();
src/monitor/ops-recovery.ts:463:        'Step diagnosis: LLM diagnosis generated',
src/monitor/ops-recovery.ts:465:      return diagnosis.length > 0 ? diagnosis : null;
src/monitor/ops-recovery.ts:467:      log.warn({ error, projectId: context.projectId }, 'LLM diagnosis failed during recovery');
src/monitor/ops-recovery.ts:492:      notes.push('No deterministic fix matched — proceeding to rollback');
src/monitor/ops-recovery.ts:532:      return await this.escalate(context, `${reason}; no previous image available for rollback`);
src/monitor/ops-recovery.ts:536:      return await this.escalate(context, `${reason}; deploy lock held during rollback`);
src/monitor/ops-recovery.ts:542:      `Step rollback: attempting rollback to ${project.previous_image_tag}`,
src/monitor/ops-recovery.ts:546:      const result = await this.ctx.pipeline.rollback(context.projectId);
src/monitor/ops-recovery.ts:551:          `${reason}; rollback failed: ${result.error ?? 'unknown'}`,
src/monitor/ops-recovery.ts:558:        this.addIncidentEvent(context.incidentId, 'recovered', 'Recovered via rollback');
src/monitor/ops-recovery.ts:570:        `${reason}; rollback completed but service remained unhealthy`,
src/monitor/ops-recovery.ts:576:      return await this.escalate(context, `${reason}; rollback failed: ${message}`);
src/monitor/ops-recovery.ts:660:      log.warn({ error, containerId }, 'Failed to fetch container logs for diagnosis');
src/pipeline/build-recovery.ts:150:      /Container is in restart loop/i,
src/pipeline/deploy-plan/types.ts:103:  restart?: string;
src/pipeline/recovery-dispatch.ts:79:const RUNTIME_CRASH_PATTERNS = [/crashed/i, /exited with code/i, /restart loop/i];
src/pipeline/recovery-dispatch.ts:276:      en: 'Docker build failed and requires diagnosis before retrying.',
src/pipeline/recovery-dispatch.ts:283:What you can do: Call debug_build_error to get AI diagnosis of the build failure. If it's a missing env var, use ask_user_question + set_env_vars. If it's a Dockerfile issue, the pipeline will auto-fix on retry. Call create_deploy_plan and execute_deploy_plan to retry after fixing.
src/pipeline/recovery-dispatch.ts:335:      en: 'The container crashed or entered a restart loop after deployment.',
src/pipeline/recovery-dispatch.ts:341:What happened: The app crashed after container start or keeps restarting.
src/pipeline/recovery-dispatch.ts:365:What you can do: Collect recent logs via get_logs, ask focused follow-up questions if needed, and retry with create_deploy_plan and execute_deploy_plan only after diagnosis.
src/monitor/activity-logger.ts:27:  'deploy:rollback',
src/monitor/docker-events.ts:5: * replacing the 30s polling gap that missed crashes recovered by restart policies.
src/pipeline/compose.ts:48:  restart?: string;
src/pipeline/compose.ts:320:      const restartRaw = serviceObj['restart'];
src/pipeline/compose.ts:337:      let restart: string | undefined;
src/pipeline/compose.ts:338:      if (typeof restartRaw === 'string') {
src/pipeline/compose.ts:339:        restart = restartRaw;
src/pipeline/compose.ts:418:        restart,
src/pipeline/compose.ts:754:                  restart: composeService.restart,
src/pipeline/compose.ts:845:        rollbackService: async (service) => {
src/pipeline/compose.ts:1016:              'Failed to stop compose service during rollback',
src/pipeline/compose.ts:1025:            'Failed to remove compose service container during rollback',
src/pipeline/deploy-plan/engine.ts:194:            restart: svc.restart,
src/pipeline/deploy-plan/engine.ts:413:      restart: service.restart,
src/pipeline/deploy-plan/engine.ts:509:            'SQLite dependency detected. Data stored in SQLite will be lost on container restart ' +
src/monitor/activity-event-mapper.ts:23:    | 'ai_diagnosis'
src/monitor/activity-event-mapper.ts:52:    diagnosisSummary?: string;
src/pipeline/service-manager.ts:39:    restartCount: number | null;
src/pipeline/service-manager.ts:892:              restartCount: inspection.restartCount,
src/pipeline/service-manager.ts:924:    restartCount: number | null;
src/pipeline/service-manager.ts:933:        restartCount: null,
src/pipeline/service-manager.ts:943:      const restartCountRaw: unknown = info.RestartCount;
src/pipeline/service-manager.ts:950:        restartCount: typeof restartCountRaw === 'number' ? restartCountRaw : null,
src/pipeline/service-manager.ts:962:        restartCount: null,
src/monitor/rollback-watcher.ts:6:const log = createModuleLogger('rollback-watcher');
src/monitor/rollback-watcher.ts:103:        // If this is a plan-originated deploy and we have pipeline, auto-execute rollback
src/monitor/rollback-watcher.ts:107:          // Otherwise, emit suggestion for manual rollback
src/monitor/rollback-watcher.ts:108:          void this.events.emit('rollback:suggested', {
src/monitor/rollback-watcher.ts:124:      log.info({ projectId, planId }, 'Auto-executing rollback for plan deploy');
src/monitor/rollback-watcher.ts:125:      const result = await this.pipeline.rollback(projectId);
src/monitor/rollback-watcher.ts:128:        log.info({ projectId, planId }, 'Auto-rollback succeeded');
src/monitor/rollback-watcher.ts:132:        log.error({ projectId, planId, error: result.error }, 'Auto-rollback failed');
src/monitor/rollback-watcher.ts:135:      log.error({ projectId, planId, err }, 'Error during auto-rollback execution');
src/monitor/alerts.ts:15:    | 'restart-loop'
src/monitor/alerts.ts:113:    // (e.g. after server restart, or incidents created by OpsAgent)
src/monitor/alerts.ts:167:      case 'restart-loop': {
src/monitor/alerts.ts:285:      const key = `restart-loop:${project.container_id}`;
src/monitor/alerts.ts:290:        const restartCount: number = (info.RestartCount as number | undefined) ?? 0;
src/monitor/alerts.ts:292:        // Check if container was restarted recently (within 24h)
src/monitor/alerts.ts:297:        if (restartCount < RESTART_COUNT_THRESHOLD || !isRecent) {
src/monitor/alerts.ts:298:          // No restart loop, resolve any existing alert
src/monitor/alerts.ts:299:          this.resolveAlert(key, 'restart-loop');
src/monitor/alerts.ts:303:        const message = `Container for "${project.name}" has restarted ${String(restartCount)} times in the last 24 hours`;
src/monitor/alerts.ts:307:          type: 'restart-loop',
src/monitor/alerts.ts:314:            restartCount,
src/monitor/alerts.ts:322:          'Failed to inspect container for restart check',
src/monitor/alerts.ts:557:        const restartCount: number = (info.RestartCount as number | undefined) ?? 0;
src/monitor/alerts.ts:559:        // Container is actively restarting after crash
src/monitor/alerts.ts:560:        if (state.Restarting && restartCount > 0) {
src/monitor/alerts.ts:561:          const message = `Container crashed: ${project.name} (restarting, count: ${String(restartCount)}, exit code ${String(state.ExitCode)})`;
src/monitor/alerts.ts:573:              restartCount,
src/monitor/alerts.ts:574:              restarting: true,
src/monitor/alerts.ts:607:        const suggestion = 'Run restart_project to redeploy.';
src/monitor/ops-drift.ts:129:        'Service drift — alert sent, restart deferred to recovery pipeline',
src/monitor/ops-agent.ts:203:          description: 'Incident interrupted by server restart',
src/monitor/ops-agent.ts:219:        this.ctx.db.updateActionRunStatus(run.id, 'failed', 'Server restart interrupted approval');
src/monitor/ops-agent.ts:297:      const automationPolicy = resolveAutomationPolicy(this.config, projectOverride ?? undefined);

exec
/bin/bash -lc "nl -ba src/tools/defs/platform-actions.ts | sed -n '1,240p'" in /home/lee/OpenLander
 succeeded in 0ms:
     1	import { getRouteName } from '../../pipeline/deploy/helpers.js';
     2	import {
     3	  collectKnownContainerNames,
     4	  containerName as projectContainerName,
     5	} from '../../pipeline/helpers.js';
     6	import {
     7	  platformCleanupOrphansSchema,
     8	  platformForceRemoveSchema,
     9	  platformReconcileSchema,
    10	  platformRecoverSchema,
    11	} from './schemas.js';
    12	import { isDockerNotFoundError } from '../../errors.js';
    13	import type { ToolDef } from './types.js';
    14
    15	function ensureConfirmed(confirm: boolean, toolName: string): void {
    16	  if (!confirm) {
    17	    throw new Error(`CONFIRMATION_REQUIRED: ${toolName} requires confirm=true`);
    18	  }
    19	}
    20
    21	function stripDockerName(name: string | undefined): string {
    22	  if (!name) {
    23	    return 'unknown';
    24	  }
    25	  return name.replace(/^\//, '');
    26	}
    27
    28	export const platformActionToolDefs: ToolDef[] = [
    29	  {
    30	    name: 'platform_cleanup_orphans',
    31	    riskLevel: 'high',
    32	    description:
    33	      'Find and remove OpenLander-managed orphan containers that are no longer referenced in DB records. Requires explicit confirmation.',
    34	    mcpDescription:
    35	      'Corrective action: detect and remove orphan OpenLander-managed containers with dry-run support.',
    36	    inputSchema: platformCleanupOrphansSchema,
    37	    execute: async (args, context) => {
    38	      const confirm = args['confirm'] as boolean;
    39	      const dryRun = (args['dry_run'] as boolean | undefined) ?? true;
    40	      ensureConfirmed(confirm, 'platform_cleanup_orphans');
    41
    42	      const managedContainers = await context.appCtx.docker.listManagedContainers();
    43	      const { knownIds, knownNames } = collectKnownContainerNames(
    44	        context.appCtx.db.listProjects(),
    45	        (projectId) => context.appCtx.db.getEnvironmentsByProject(projectId),
    46	        (projectName, env) => projectContainerName(getRouteName(projectName, env.type)),
    47	        context.appCtx.db.listServices(),
    48	      );
    49
    50	      const removed: Array<{ id: string; name: string }> = [];
    51	      const skipped: Array<{ id: string; name: string; reason: string }> = [];
    52	      const errors: Array<{ id: string; name: string; error: string }> = [];
    53
    54	      const orphanCandidates = managedContainers.filter((container) => {
    55	        if (knownIds.has(container.id)) return false;
    56	        if (knownNames.has(container.name)) return false;
    57	        return true;
    58	      });
    59
    60	      for (const container of orphanCandidates) {
    61	        if (container.labels?.['openlander.role']) {
    62	          skipped.push({ id: container.id, name: container.name, reason: 'infrastructure' });
    63	          continue;
    64	        }
    65
    66	        if (dryRun) {
    67	          skipped.push({ id: container.id, name: container.name, reason: 'dry_run' });
    68	          continue;
    69	        }
    70
    71	        try {
    72	          await context.appCtx.docker.stopContainer(container.id);
    73	          await context.appCtx.docker.removeContainer(container.id);
    74	          removed.push({ id: container.id, name: container.name });
    75	        } catch (error) {
    76	          const message = error instanceof Error ? error.message : String(error);
    77	          errors.push({ id: container.id, name: container.name, error: message });
    78	        }
    79	      }
    80
    81	      return {
    82	        mode: dryRun ? 'dry_run' : 'executed',
    83	        orphans_found: orphanCandidates.length,
    84	        removed,
    85	        skipped,
    86	        errors,
    87	      };
    88	    },
    89	    targets: ['mcp'],
    90	  },
    91	  {
    92	    name: 'platform_reconcile',
    93	    riskLevel: 'high',
    94	    description:
    95	      'Reconcile DB state with Docker reality by marking ghost project records as error and removing orphan managed containers. Requires explicit confirmation.',
    96	    mcpDescription:
    97	      'Corrective action: reconcile DB records against managed Docker containers (dry-run supported).',
    98	    inputSchema: platformReconcileSchema,
    99	    execute: async (args, context) => {
   100	      const confirm = args['confirm'] as boolean;
   101	      const dryRun = (args['dry_run'] as boolean | undefined) ?? true;
   102	      ensureConfirmed(confirm, 'platform_reconcile');
   103
   104	      const managedContainers = await context.appCtx.docker.listManagedContainers();
   105	      const { knownIds, knownNames } = collectKnownContainerNames(
   106	        context.appCtx.db.listProjects(),
   107	        (projectId) => context.appCtx.db.getEnvironmentsByProject(projectId),
   108	        (projectName, env) => projectContainerName(getRouteName(projectName, env.type)),
   109	        context.appCtx.db.listServices(),
   110	      );
   111	      const dockerClient = context.appCtx.docker.getClient();
   112
   113	      const actions: Array<{ type: 'mark_error' | 'stop_orphan'; target: string; detail: string }> =
   114	        [];
   115
   116	      for (const project of context.appCtx.db.listProjects()) {
   117	        if (project.container_id === null) {
   118	          continue;
   119	        }
   120
   121	        try {
   122	          await dockerClient.getContainer(project.container_id).inspect();
   123	          continue;
   124	        } catch (error) {
   125	          if (!isDockerNotFoundError(error)) {
   126	            throw error;
   127	          }
   128	        }
   129
   130	        if (!dryRun) {
   131	          context.appCtx.db.updateProject(project.id, { status: 'error' });
   132	        }
   133
   134	        actions.push({
   135	          type: 'mark_error',
   136	          target: project.name,
   137	          detail: dryRun
   138	            ? `container missing: ${project.container_id}`
   139	            : `status updated to error (missing container: ${project.container_id})`,
   140	        });
   141	      }
   142
   143	      for (const container of managedContainers) {
   144	        const isKnown = knownIds.has(container.id) || knownNames.has(container.name);
   145	        if (isKnown) {
   146	          continue;
   147	        }
   148
   149	        if (container.labels?.['openlander.role']) {
   150	          continue;
   151	        }
   152
   153	        if (dryRun) {
   154	          actions.push({
   155	            type: 'stop_orphan',
   156	            target: container.name,
   157	            detail: `would stop+remove orphan container ${container.id}`,
   158	          });
   159	          continue;
   160	        }
   161
   162	        try {
   163	          await context.appCtx.docker.stopContainer(container.id);
   164	          await context.appCtx.docker.removeContainer(container.id);
   165	          actions.push({
   166	            type: 'stop_orphan',
   167	            target: container.name,
   168	            detail: `stopped+removed orphan container ${container.id}`,
   169	          });
   170	        } catch (error) {
   171	          const message = error instanceof Error ? error.message : String(error);
   172	          actions.push({
   173	            type: 'stop_orphan',
   174	            target: container.name,
   175	            detail: `failed to remove orphan ${container.id}: ${message}`,
   176	          });
   177	        }
   178	      }
   179
   180	      return {
   181	        mode: dryRun ? 'dry_run' : 'executed',
   182	        actions,
   183	      };
   184	    },
   185	    targets: ['mcp'],
   186	  },
   187	  {
   188	    name: 'platform_force_remove',
   189	    riskLevel: 'high',
   190	    description:
   191	      'Force remove a specific Docker container by ID after protected-infrastructure checks. Requires explicit confirmation.',
   192	    mcpDescription: 'Corrective action: force-remove a specific non-infrastructure container.',
   193	    inputSchema: platformForceRemoveSchema,
   194	    execute: async (args, context) => {
   195	      const containerId = args['container_id'] as string;
   196	      const confirm = args['confirm'] as boolean;
   197	      ensureConfirmed(confirm, 'platform_force_remove');
   198
   199	      const container = context.appCtx.docker.getClient().getContainer(containerId);
   200
   201	      let inspected: { Name?: string; Config?: { Labels?: Record<string, string> } };
   202	      try {
   203	        inspected = (await container.inspect()) as {
   204	          Name?: string;
   205	          Config?: { Labels?: Record<string, string> };
   206	        };
   207	      } catch (error) {
   208	        if (isDockerNotFoundError(error)) {
   209	          return { status: 'not_found', container_id: containerId };
   210	        }
   211	        throw error;
   212	      }
   213
   214	      if (inspected.Config?.Labels?.['openlander.role']) {
   215	        throw new Error('PROTECTED_CONTAINER: Cannot remove infrastructure container');
   216	      }
   217
   218	      try {
   219	        await context.appCtx.docker.stopContainer(containerId);
   220	        await context.appCtx.docker.removeContainer(containerId);
   221	      } catch (error) {
   222	        if (isDockerNotFoundError(error)) {
   223	          return { status: 'not_found', container_id: containerId };
   224	        }
   225	        throw error;
   226	      }
   227
   228	      return {
   229	        status: 'removed',
   230	        container_id: containerId,
   231	        name: stripDockerName(inspected.Name),
   232	      };
   233	    },
   234	    targets: ['mcp'],
   235	  },
   236	  {
   237	    name: 'recover_platform',
   238	    riskLevel: 'medium',
   239	    description:
   240	      'Recover all containers after Docker migration. Recreates missing containers from existing images and preserves service volumes with data. Safe — never overwrites existing volumes. Use dry_run=true to preview what would happen.',

exec
/bin/bash -lc "nl -ba src/tools/defs/service.ts | sed -n '180,460p'" in /home/lee/OpenLander
 succeeded in 0ms:
   180	      const services = await appCtx.serviceManager.list();
   181	      const service = services.find((item) => item.name === serviceName);
   182	      if (!service) {
   183	        throw new Error(`Service not found: ${serviceName}`);
   184	      }
   185
   186	      try {
   187	        const databases = await appCtx.serviceManager.listDatabases(service.id);
   188	        return {
   189	          service: service.name,
   190	          count: databases.length,
   191	          databases: databases.map((database) => ({
   192	            name: database.name,
   193	            sizeBytes: database.sizeBytes,
   194	          })),
   195	        };
   196	      } catch (error) {
   197	        const message = error instanceof Error ? error.message : String(error);
   198	        throw new Error(message);
   199	      }
   200	    },
   201	    targets: ['agent'],
   202	  },
   203	  {
   204	    name: 'create_database',
   205	    riskLevel: 'high',
   206	    description:
   207	      'Create a database in a named PostgreSQL or MySQL service. Use when provisioning app-specific database credentials. Returns { status, service, database, user, password, connectionString }. Errors: SERVICE_NOT_FOUND or unsupported service type.',
   208	    mcpDescription: 'Create a database inside an existing PostgreSQL or MySQL service.',
   209	    inputSchema: createDatabaseSchema,
   210	    execute: async (args, { appCtx }) => {
   211	      const serviceName = args['service_name'] as string;
   212	      const databaseName = args['database_name'] as string;
   213	      const services = await appCtx.serviceManager.list();
   214	      const service = services.find((item) => item.name === serviceName);
   215	      if (!service) {
   216	        throw new Error(`Service not found: ${serviceName}`);
   217	      }
   218
   219	      try {
   220	        const result = await appCtx.serviceManager.createDatabase(service.id, databaseName);
   221	        return {
   222	          status: 'created',
   223	          service: service.name,
   224	          database: result.database,
   225	          user: result.user,
   226	          password: result.password,
   227	          connectionString: result.connectionString,
   228	        };
   229	      } catch (error) {
   230	        const message = error instanceof Error ? error.message : String(error);
   231	        throw new Error(message);
   232	      }
   233	    },
   234	    targets: ['agent'],
   235	  },
   236	  {
   237	    name: 'list_buckets',
   238	    riskLevel: 'low',
   239	    description:
   240	      'List S3 buckets in a MinIO service. Use to see what storage buckets exist. Returns { service, count, buckets[] } where each bucket has name and createdAt. Errors: SERVICE_NOT_FOUND, not a MinIO service.',
   241	    mcpDescription: 'List S3 buckets in a MinIO object storage service.',
   242	    inputSchema: listBucketsSchema,
   243	    execute: async (args, { appCtx }) => {
   244	      const serviceName = args['service_name'] as string;
   245	      const service = await getServiceByName(appCtx, serviceName);
   246	      const buckets = await appCtx.serviceManager.listBuckets(service.id);
   247	      return {
   248	        service: service.name,
   249	        count: buckets.length,
   250	        buckets,
   251	      };
   252	    },
   253	    targets: ['mcp'],
   254	  },
   255	  {
   256	    name: 'create_bucket',
   257	    riskLevel: 'medium',
   258	    description:
   259	      'Create an S3 bucket in a MinIO service. Use when setting up storage for a project. Bucket names must be 3-63 chars, lowercase, following S3 naming rules. Returns { status, service, bucket }. Errors: SERVICE_NOT_FOUND, bucket already exists, not a MinIO service.',
   260	    mcpDescription: 'Create an S3 bucket in a MinIO object storage service.',
   261	    inputSchema: createBucketSchema,
   262	    execute: async (args, { appCtx }) => {
   263	      const serviceName = args['service_name'] as string;
   264	      const bucketName = args['bucket_name'] as string;
   265	      const service = await getServiceByName(appCtx, serviceName);
   266	      await appCtx.serviceManager.createBucket(service.id, bucketName);
   267	      return {
   268	        status: 'created',
   269	        service: service.name,
   270	        bucket: bucketName,
   271	      };
   272	    },
   273	    targets: ['mcp'],
   274	  },
   275	  {
   276	    name: 'delete_bucket',
   277	    riskLevel: 'medium',
   278	    description:
   279	      'Delete an empty S3 bucket from a MinIO service. The bucket must be empty before deletion. Returns { status, service, bucket, warning }. Errors: SERVICE_NOT_FOUND, bucket not empty, not a MinIO service.',
   280	    mcpDescription: 'Delete an empty S3 bucket from a MinIO object storage service.',
   281	    inputSchema: deleteBucketSchema,
   282	    execute: async (args, { appCtx }) => {
   283	      const serviceName = args['service_name'] as string;
   284	      const bucketName = args['bucket_name'] as string;
   285	      const service = await getServiceByName(appCtx, serviceName);
   286	      await appCtx.serviceManager.deleteBucket(service.id, bucketName);
   287	      return {
   288	        status: 'deleted',
   289	        service: service.name,
   290	        bucket: bucketName,
   291	        warning: 'Bucket and all its contents have been permanently deleted.',
   292	      };
   293	    },
   294	    targets: ['mcp'],
   295	  },
   296	  {
   297	    name: 'get_service_status',
   298	    riskLevel: 'low',
   299	    description:
   300	      'Get the current status of a specific service. Returns { id, name, status, health, type, port, ... } where status is running/stopped and health reflects container health (healthy/unhealthy/unknown/degraded). healthDetail may be included when crash-like log patterns are detected. Errors: SERVICE_NOT_FOUND if the service name is invalid.',
   301	    mcpDescription: 'Get service status, health, container state, and metadata.',
   302	    inputSchema: serviceNameSchema,
   303	    execute: async (args, { appCtx }) => {
   304	      const service = await getServiceByName(appCtx, args['service_name'] as string);
   305	      let health: 'healthy' | 'unhealthy' | 'unknown' | 'degraded' = 'unknown';
   306	      let healthDetail: string | undefined;
   307
   308	      const containerId = service.container_id ?? service.container_name;
   309	      if (containerId) {
   310	        try {
   311	          const info = (await appCtx.docker.getClient().getContainer(containerId).inspect()) as {
   312	            State?: { Health?: { Status?: string } };
   313	          };
   314	          const dockerHealth = info.State?.Health?.Status;
   315
   316	          if (dockerHealth === 'healthy') {
   317	            health = 'healthy';
   318	          } else if (dockerHealth === 'unhealthy') {
   319	            health = 'unhealthy';
   320	          } else if (dockerHealth) {
   321	            health = 'unknown';
   322	          } else {
   323	            const logs = await appCtx.docker.getLogs(containerId, 20);
   324	            const matchedLine = logs
   325	              .split(/\r?\n/)
   326	              .find((line) => SERVICE_CRASH_LOG_PATTERN.test(line));
   327
   328	            if (matchedLine) {
   329	              health = 'degraded';
   330	              healthDetail = matchedLine.trim();
   331	            } else {
   332	              health = 'healthy';
   333	            }
   334	          }
   335	        } catch (error) {
   336	          log.warn(
   337	            { err: error, serviceId: service.id, containerId },
   338	            'Failed to derive container health for service status',
   339	          );
   340	          health = 'unknown';
   341	        }
   342	      }
   343
   344	      return {
   345	        id: service.id,
   346	        name: service.name,
   347	        type: service.type,
   348	        status: service.status,
   349	        health,
   350	        ...(healthDetail ? { healthDetail } : {}),
   351	        port: service.port,
   352	        network: SHARED_NETWORK_NAME,
   353	        image: service.image,
   354	        containerName: service.container_name,
   355	        containerId: service.container_id,
   356	        createdAt: service.created_at,
   357	        updatedAt: service.updated_at,
   358	        externalAccess: getServiceExternalAccess(service.port),
   359	        _agent_guidance: {
   360	          networking: [
   361	            `All containers are on the shared Docker network ("${SHARED_NETWORK_NAME}"). Do NOT create Docker networks manually.`,
   362	            'For inter-container communication, use http://ol-{project-name}:{port} (DNS auto-resolved).',
   363	            'Networks are auto-managed by OpenLander. Manual docker network commands will cause conflicts.',
   364	          ],
   365	        },
   366	      };
   367	    },
   368	    targets: ['mcp'],
   369	  },
   370	  {
   371	    name: 'start_service',
   372	    riskLevel: 'medium',
   373	    description:
   374	      'Start a stopped service. Use when a service is stopped and needs to be running. Returns { status, service }. Errors: SERVICE_NOT_FOUND.',
   375	    mcpDescription: 'Start a stopped service container.',
   376	    inputSchema: serviceNameSchema,
   377	    execute: async (args, { appCtx }) => {
   378	      const serviceName = args['service_name'] as string;
   379	      const service = await getServiceByName(appCtx, serviceName);
   380	      await appCtx.serviceManager.start(service.id);
   381	      return { status: 'started', service: serviceName };
   382	    },
   383	    targets: ['mcp'],
   384	  },
   385	  {
   386	    name: 'stop_service',
   387	    riskLevel: 'medium',
   388	    description:
   389	      'Stop a running service gracefully. Use when a service needs to be paused without deletion. Returns { status, service }. Errors: SERVICE_NOT_FOUND.',
   390	    mcpDescription: 'Stop a running service container gracefully.',
   391	    inputSchema: serviceNameSchema,
   392	    execute: async (args, { appCtx }) => {
   393	      const serviceName = args['service_name'] as string;
   394	      const service = await getServiceByName(appCtx, serviceName);
   395	      await appCtx.serviceManager.stop(service.id);
   396	      return { status: 'stopped', service: serviceName };
   397	    },
   398	    targets: ['mcp'],
   399	  },
   400	  {
   401	    name: 'remove_service',
   402	    riskLevel: 'high',
   403	    description:
   404	      'Permanently remove a service — deletes the container, volume, and ALL persistent data. DESTRUCTIVE — cannot be undone. WARNING: This deletes database files, cache data, and everything stored in the service volume. ALWAYS call backup_service BEFORE removing a service with important data. If projects reference this service, removal is blocked unless force=true. Returns { status, service, warning, connected_projects }. Errors: SERVICE_NOT_FOUND, SERVICE_IN_USE.',
   405	    mcpDescription: 'Remove a service container and volume. Data is permanently deleted.',
   406	    inputSchema: removeServiceSchema,
   407	    execute: async (args, { appCtx }) => {
   408	      const serviceName = args['service_name'] as string;
   409	      const force = (args['force'] as boolean | undefined) ?? false;
   410	      const service = await getServiceByName(appCtx, serviceName);
   411	      const serviceType = service.type;
   412	      const result = await appCtx.serviceManager.remove(service.id, { force });
   413	      return {
   414	        status: 'removed',
   415	        service: serviceName,
   416	        warning: `All persistent data for ${serviceType} service "${serviceName}" has been permanently deleted. This cannot be undone. If you needed the data, it is now lost. Use backup_service before remove_service in the future.`,
   417	        ...(result.connected_projects && { connected_projects: result.connected_projects }),
   418	      };
   419	    },
   420	    targets: ['mcp'],
   421	  },
   422	  {
   423	    name: 'backup_service',
   424	    riskLevel: 'medium',
   425	    description:
   426	      "Create a backup snapshot of a service's persistent data (database files, etc.). Returns { status, backupId, path, sizeBytes }. Use BEFORE remove_service to prevent data loss.",
   427	    mcpDescription: 'Create a backup snapshot of service data before destructive actions.',
   428	    inputSchema: backupServiceSchema,
   429	    execute: async (args, { appCtx }) => {
   430	      const service = await getServiceByName(appCtx, args['service_name'] as string);
   431	      const result = await appCtx.serviceManager.backup(service.id);
   432	      return {
   433	        status: 'backed_up',
   434	        service: service.name,
   435	        backupId: result.backupId,
   436	        path: result.path,
   437	        sizeBytes: result.size,
   438	      };
   439	    },
   440	    targets: ['mcp'],
   441	  },
   442	  {
   443	    name: 'restore_service',
   444	    riskLevel: 'medium',
   445	    description:
   446	      'Restore a service volume from a backup snapshot. Stops the service container, restores the selected backup into the service volume, then starts the service again. Returns { status, service, backupId }.',
   447	    mcpDescription: 'Restore service data from a selected backup snapshot.',
   448	    inputSchema: restoreServiceSchema,
   449	    execute: async (args, { appCtx }) => {
   450	      const service = await getServiceByName(appCtx, args['service_name'] as string);
   451	      const backupId = args['backup_id'] as string;
   452	      await appCtx.serviceManager.restore(service.id, backupId);
   453	      return {
   454	        status: 'restored',
   455	        service: service.name,
   456	        backupId,
   457	      };
   458	    },
   459	    targets: ['mcp'],
   460	  },

exec
/bin/bash -lc "nl -ba src/tools/defs/volume.ts | sed -n '220,320p'" in /home/lee/OpenLander
 succeeded in 0ms:
   220	        volumes,
   221	      };
   222	    },
   223	    targets: ['mcp'],
   224	  },
   225	  {
   226	    name: 'remove_volume',
   227	    riskLevel: 'medium',
   228	    description:
   229	      'Remove a managed project volume and permanently delete all data inside it. Use only when data is no longer needed. Returns { status, volume, warning }. If the volume is in use, stop containers first, then retry.',
   230	    mcpDescription: 'Remove a managed volume. Data deletion is permanent.',
   231	    inputSchema: removeVolumeSchema,
   232	    execute: async (args, { appCtx }) => {
   233	      const projectName = args['project_name'] as string;
   234	      const volumeName = args['volume_name'] as string;
   235	      const dockerVolumeName = getDockerVolumeName(projectName, volumeName);
   236
   237	      const client = appCtx.docker.getClient();
   238	      const volume = client.getVolume(dockerVolumeName);
   239
   240	      let inspected: unknown;
   241	      try {
   242	        inspected = await volume.inspect();
   243	      } catch (error) {
   244	        if (isDockerNotFoundError(error)) {
   245	          throw new Error(
   246	            `Volume "${dockerVolumeName}" not found. Check project_name and volume_name.`,
   247	          );
   248	        }
   249	        const message = getErrorMessage(error);
   250	        throw new Error(`Failed to inspect volume "${dockerVolumeName}": ${message}`);
   251	      }
   252
   253	      const labels = getLabels(inspected);
   254	      if (labels[DOCKER_LABELS.MANAGED] !== 'true' || labels[DOCKER_LABELS.ROLE] !== 'volume') {
   255	        throw new Error(
   256	          `Volume "${dockerVolumeName}" exists but is not an OpenLander-managed volume. Refusing to delete.`,
   257	        );
   258	      }
   259
   260	      try {
   261	        await volume.remove();
   262	      } catch (error) {
   263	        const message = getErrorMessage(error);
   264	        if (message.toLowerCase().includes('in use')) {
   265	          throw new Error(
   266	            `Volume "${dockerVolumeName}" is currently in use by a container. Stop the container first, then retry remove_volume.`,
   267	          );
   268	        }
   269	        throw new Error(`Failed to remove volume "${dockerVolumeName}": ${message}`);
   270	      }
   271
   272	      return {
   273	        status: 'removed',
   274	        volume: dockerVolumeName,
   275	        warning: 'All data in this volume has been permanently deleted.',
   276	      };
   277	    },
   278	    targets: ['mcp'],
   279	  },
   280	  {
   281	    name: 'get_disk_usage',
   282	    riskLevel: 'low',
   283	    description:
   284	      'Get Docker system disk usage breakdown for images, containers, and volumes. Includes a separate list of OpenLander-managed volumes with per-volume size when available. Returns counts and total sizes in bytes.',
   285	    mcpDescription: 'Get Docker disk usage totals and managed volume sizes.',
   286	    inputSchema: getDiskUsageSchema,
   287	    execute: async (_args, { appCtx }) => {
   288	      const diskUsageData: unknown = await appCtx.docker.getClient().df();
   289	      if (!isRecord(diskUsageData)) {
   290	        return {
   291	          images: { count: 0, totalSizeBytes: 0 },
   292	          containers: { count: 0, totalSizeBytes: 0 },
   293	          volumes: { count: 0, totalSizeBytes: 0, managed: [] },
   294	        };
   295	      }
   296
   297	      const imagesRaw: unknown[] = Array.isArray(diskUsageData['Images'])
   298	        ? (diskUsageData['Images'] as unknown[])
   299	        : [];
   300	      const containersRaw: unknown[] = Array.isArray(diskUsageData['Containers'])
   301	        ? (diskUsageData['Containers'] as unknown[])
   302	        : [];
   303	      const volumesRaw: unknown[] = Array.isArray(diskUsageData['Volumes'])
   304	        ? (diskUsageData['Volumes'] as unknown[])
   305	        : [];
   306
   307	      const imageTotalSizeBytes = imagesRaw.reduce<number>((sum, image) => {
   308	        if (!isRecord(image)) {
   309	          return sum;
   310	        }
   311	        return sum + (getNumber(image['Size']) ?? 0);
   312	      }, 0);
   313
   314	      const containerTotalSizeBytes = containersRaw.reduce<number>((sum, container) => {
   315	        if (!isRecord(container)) {
   316	          return sum;
   317	        }
   318	        return sum + (getNumber(container['SizeRw']) ?? 0);
   319	      }, 0);
   320

exec
/bin/bash -lc 'rg -n "recovery:approval-auto-skipped" src test' in /home/lee/OpenLander
 succeeded in 0ms:
src/pipeline/auto-recovery.ts:475:                  await eventBus.emit('recovery:approval-auto-skipped', {
test/pipeline/auto-recovery.test.ts:558:    harness.eventBus.on('recovery:approval-auto-skipped', autoSkippedHandler);
test/pipeline/auto-recovery.test.ts:747:    harness.eventBus.on('recovery:approval-auto-skipped', autoSkippedHandler);
src/monitor/activity-logger.ts:50:  'recovery:approval-auto-skipped',
src/monitor/activity-event-mapper.ts:128:    eventType === 'recovery:approval-auto-skipped' ||
src/monitor/activity-event-mapper.ts:162:  if (eventType === 'recovery:approval-auto-skipped') return 'resolved';
src/monitor/activity-event-mapper.ts:379:  if (eventType === 'recovery:approval-auto-skipped') {
src/monitor/activity-event-mapper.ts:380:    const skippedPayload = payload as EventPayload['recovery:approval-auto-skipped'];
src/events/index.ts:93:  | 'recovery:approval-auto-skipped'
src/events/index.ts:355:  'recovery:approval-auto-skipped': {

exec
/bin/bash -lc "nl -ba src/events/index.ts | sed -n '70,120p'" in /home/lee/OpenLander
 succeeded in 0ms:
    70	  // v0.4: Channels
    71	  | 'channel:message'
    72	  | 'channel:connect'
    73	  // v0.5: Alerts
    74	  | 'alert:new'
    75	  | 'alert:resolved'
    76	  | 'alert:dismissed'
    77	  // v0.7: Agent questions
    78	  | 'question:pending'
    79	  | 'question:answered'
    80	  // v0.2.0: Agent events (deploy UX fix)
    81	  | 'agent:event'
    82	  | 'ai:invoked'
    83	  | 'ai:completed'
    84	  | 'health:degraded'
    85	  | 'recovery:blocked'
    86	  | 'recovery:stopped'
    87	  | 'recovery:started'
    88	  | 'recovery:start'
    89	  | 'recovery:success'
    90	  | 'recovery:failed'
    91	  | 'recovery:exhausted'
    92	  | 'recovery:approval-needed'
    93	  | 'recovery:approval-auto-skipped'
    94	  | 'recovery:approval-resolved'
    95	  | 'env:new-keys-detected'
    96	  | 'rollback:suggested'
    97	  | 'secret:detected'
    98	  | 'deploy:diff-analyzed';
    99
   100	export interface EventPayload {
   101	  'deploy:start': {
   102	    projectId: string;
   103	    repoUrl: string;
   104	    parentProjectId?: string;
   105	    phase?: string;
   106	    scope?: string;
   107	    status?: 'pending' | 'in_progress' | 'success' | 'failed';
   108	    message?: string;
   109	  };
   110	  'deploy:clone': {
   111	    projectId: string;
   112	    path: string;
   113	    commitSha: string;
   114	    parentProjectId?: string;
   115	    phase?: string;
   116	    scope?: string;
   117	    status?: 'pending' | 'in_progress' | 'success' | 'failed';
   118	    message?: string;
   119	  };
   120	  'deploy:build': {

exec
/bin/bash -lc "nl -ba src/events/index.ts | sed -n '330,370p'" in /home/lee/OpenLander
 succeeded in 0ms:
   330	  'recovery:failed': {
   331	    projectId: string;
   332	    error: string;
   333	    attempt: number;
   334	    source?: string;
   335	    identity?: RequestIdentity;
   336	    correlationId?: string;
   337	  };
   338	  'recovery:exhausted': {
   339	    projectId: string;
   340	    totalAttempts: number;
   341	    lastError: string;
   342	    source?: string;
   343	    identity?: RequestIdentity;
   344	    correlationId?: string;
   345	  };
   346	  'recovery:approval-needed': {
   347	    projectId: string;
   348	    actionRunId: string;
   349	    toolName: string;
   350	    attempt: number;
   351	    source?: string;
   352	    identity?: RequestIdentity;
   353	    correlationId?: string;
   354	  };
   355	  'recovery:approval-auto-skipped': {
   356	    projectId: string;
   357	    actionRunId: string;
   358	    toolName: string;
   359	    recoveryStep: string;
   360	    correlationId?: string;
   361	  };
   362	  'recovery:approval-resolved': {
   363	    actionRunId: string;
   364	    approved: boolean;
   365	    projectId?: string;
   366	    correlationId?: string;
   367	  };
   368	  'env:new-keys-detected': {
   369	    projectId: string;
   370	    projectName: string;

exec
/bin/bash -lc "nl -ba test/monitor/ops-agent.test.ts | sed -n '228,290p'" in /home/lee/OpenLander
 succeeded in 0ms:
   228	    });
   229
   230	    it('reloads config at runtime preserving unset fields', () => {
   231	      const agent = new OpsAgent(mockCtx);
   232	      agent.reloadConfig({ auto_cleanup: false });
   233	      expect(agent.getConfig().auto_cleanup).toBe(false);
   234	      expect(agent.getConfig().enabled).toBe(true);
   235	    });
   236
   237	    it('migrates legacy auto_restart=true in reloadConfig', () => {
   238	      const agent = new OpsAgent(mockCtx);
   239	      agent.reloadConfig({ auto_restart: true } as any);
   240	      expect(agent.getConfig().recovery.enabled).toBe(true);
   241	    });
   242
   243	    it('migrates legacy auto_restart=false in reloadConfig', () => {
   244	      const agent = new OpsAgent(mockCtx);
   245	      agent.reloadConfig({ auto_restart: false } as any);
   246	      expect(agent.getConfig().recovery.enabled).toBe(false);
   247	    });
   248
   249	    it('accepts new recovery config format in reloadConfig', () => {
   250	      const agent = new OpsAgent(mockCtx);
   251	      agent.reloadConfig({
   252	        recovery: {
   253	          enabled: false,
   254	          automation: DEFAULT_RECOVERY_AUTOMATION,
   255	        },
   256	      });
   257	      expect(agent.getConfig().recovery.enabled).toBe(false);
   258	    });
   259
   260	    it('reloadConfig deep merges recovery field', () => {
   261	      const agent = new OpsAgent(mockCtx);
   262	      const initialConfig = agent.getConfig();
   263	      expect(initialConfig.recovery.enabled).toBe(true);
   264	      expect(initialConfig.recovery.automation).toBeDefined();
   265
   266	      agent.reloadConfig({
   267	        recovery: { enabled: false } as any,
   268	      });
   269	      const updatedConfig = agent.getConfig();
   270	      expect(updatedConfig.recovery.enabled).toBe(false);
   271	      expect(updatedConfig.recovery.automation).toEqual(DEFAULT_RECOVERY_AUTOMATION);
   272
   273	      agent.reloadConfig({
   274	        recovery: {
   275	          automation: {
   276	            restart: 'confirm',
   277	            diagnosis: 'auto',
   278	            apply_fixes: 'auto',
   279	            rollback: 'auto',
   280	          },
   281	        } as any,
   282	      });
   283	      const finalConfig = agent.getConfig();
   284	      expect(finalConfig.recovery.enabled).toBe(false);
   285	      expect(finalConfig.recovery.automation.restart).toBe('confirm');
   286	    });
   287	  });
   288
   289	  describe('recovery wiring', () => {
   290	    it('applies project-level recovery automation override', async () => {

exec
/bin/bash -lc "nl -ba test/monitor/ops-agent.test.ts | sed -n '289,340p'" in /home/lee/OpenLander
 succeeded in 0ms:
   289	  describe('recovery wiring', () => {
   290	    it('applies project-level recovery automation override', async () => {
   291	      mockCtx.db.getProjectOpsOverride.mockReturnValue({
   292	        automation: { restart: 'confirm' },
   293	      });
   294
   295	      const agent = new OpsAgent(mockCtx);
   296	      const recoveryExecute = vi.fn(async () => 'skipped');
   297
   298	      (agent as any).cascade = {
   299	        recordFailure: vi.fn(),
   300	        detectCascade: vi.fn(async () => null),
   301	        buildCascadeAlert: vi.fn(),
   302	      };
   303	      (agent as any).incidents = {
   304	        openIncident: vi.fn(() => ({ id: 'inc-1' })),
   305	        resolveIncident: vi.fn(),
   306	        escalateIncident: vi.fn(),
   307	      };
   308	      (agent as any).alerting = {
   309	        buildContextualAlert: vi.fn(() => ({ type: 'alert' })),
   310	        sendAlert: vi.fn(async () => undefined),
   311	      };
   312	      (agent as any).recovery = {
   313	        execute: recoveryExecute,
   314	      };
   315
   316	      await (agent as any).handleCrashEvent({
   317	        type: 'container:die',
   318	        payload: {
   319	          projectId: 'proj-1',
   320	          projectName: 'Project 1',
   321	          containerId: 'ctr-1',
   322	        },
   323	        timestamp: Date.now(),
   324	      });
   325
   326	      expect(recoveryExecute).toHaveBeenCalledWith(
   327	        expect.objectContaining({
   328	          automationPolicy: expect.objectContaining({
   329	            restart: 'confirm',
   330	            diagnosis: DEFAULT_RECOVERY_AUTOMATION.diagnosis,
   331	            apply_fixes: DEFAULT_RECOVERY_AUTOMATION.apply_fixes,
   332	            rollback: DEFAULT_RECOVERY_AUTOMATION.rollback,
   333	          }),
   334	        }),
   335	      );
   336	    });
   337
   338	    it('fails pending approvals during boot reconciliation after restart', async () => {
   339	      mockCtx.db.getActionRunsByApprovalStatus.mockReturnValue([{ id: 'run-pending-1' }]);
   340

codex
**CRITICAL**

No critical findings.

**MAJOR**

1. [src/app.ts:404](/home/lee/OpenLander/src/app.ts#L404) wires `getAutomationPolicy` to the bootstrap `config.ops`, not the live OpsAgent config. `/api/ops/config` updates `ctx.opsAgent` via `reloadConfig()` and persists to disk with `updateConfig()`, but it does not mutate `ctx.config` in memory ([src/web/api/ops-routes.ts:198](/home/lee/OpenLander/src/web/api/ops-routes.ts#L198), [src/config/index.ts:452](/home/lee/OpenLander/src/config/index.ts#L452)). The result is that recovery sessions will keep using stale global automation policy until process restart, while project overrides update immediately from DB. That breaks the “applied immediately” behavior this commit is trying to add for approval policy.

2. [src/pipeline/auto-recovery.ts:36](/home/lee/OpenLander/src/pipeline/auto-recovery.ts#L36) now lets `rollback=auto` bypass approval for `remove_volume`, but the tool itself is still declared `riskLevel: 'medium'` and is explicitly permanent data deletion ([src/tools/defs/volume.ts:226](/home/lee/OpenLander/src/tools/defs/volume.ts#L226)). This commit also hardens that assumption in the exhaustive mapping test ([test/pipeline/auto-recovery.test.ts:779](/home/lee/OpenLander/test/pipeline/auto-recovery.test.ts#L779)). If `ToolDef.riskLevel` is the intended source of truth, this change widens auto-approved destructive behavior in recovery and cements a policy mismatch instead of fixing it.

**MINOR**

1. [test/web/api/ops-routes.test.ts:36](/home/lee/OpenLander/test/web/api/ops-routes.test.ts#L36) only round-trips project override endpoints against a stubbed `opsAgent.getConfig()` that always returns defaults. It does not cover the introduced live-config path (`PUT /api/ops/config` -> recovery policy readback), so the stale global-policy bug above would not be caught.

2. [test/pipeline/auto-recovery.test.ts:779](/home/lee/OpenLander/test/pipeline/auto-recovery.test.ts#L779) hardcodes the “high risk” tool list instead of deriving it from the approval classifier. That means a future change to `DecisionEngine` can silently drift from `TOOL_TO_RECOVERY_STEP` again while this test still passes.

Assumption: I’m treating runtime ops config changes as intended to take effect without restart, based on the new reload/deep-merge work and the UI copy added in this commit.
tokens used
83,919

```

## Concise summary

Provider completed successfully. Review the raw output for details.

## Action items

- Review the response and extract decisions you want to apply.
- Capture follow-up implementation tasks if needed.
