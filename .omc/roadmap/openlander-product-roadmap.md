# OpenLander Product Roadmap

Date: 2026-06-02
Status: internal planning
Baseline: public v0.1.9 stabilization work, before v0.1.9 tag

## Product North Star

OpenLander should become the self-hosted deployment control plane that humans
and MCP-capable agents can both operate safely.

The product is not trying to be a full Kubernetes platform first. It should win
by making the common self-hosted path clear:

1. Install on a VPS.
2. Connect Git or image input.
3. Deploy app and managed services.
4. Inspect status, logs, topology, and incidents.
5. Let an external agent operate through explicit, policy-gated MCP calls.
6. Add stronger automation only after production safety primitives exist.

## Current State

### What v0.1 Proves

- Git and image deploy paths work.
- Managed services exist.
- MCP composite tools expose the main operational surface.
- Deploy diagnostics, logs, status, topology, and rollback exist.
- The Project/Service data model has mostly moved to the intended shape:
  - `projects` is the group boundary;
  - `services` owns deployable and managed runtime rows;
  - `service_connections` links consumer/provider services.
- Docker has a facade/runtime boundary in important paths, but Docker remains
  the only supported runtime.
- Built-in autonomous AI/Ops is intentionally dormant in the 0.1 runtime.

### What Is Still Missing

- Production/staging/development are not first-class project policy concepts.
- Agent-triggered production operations need a durable approval story.
- Private artifact inputs are incomplete.
- Notifications and approval delivery are not productized.
- Self-update is not safe enough to expose as a button.
- Runtime abstraction is not yet strong enough for Swarm or Kubernetes.
- Internal AI Ops cannot safely re-enable until environment policy exists.

## Roadmap Principles

1. Safety before autonomy.
   - Environment policy and approval gates come before built-in AI actions.

2. Trust before breadth.
   - Release gates, migration dry-runs, and cold-agent smoke tests matter more
     than adding another runtime or integration.

3. Preserve the public contract.
   - MCP/REST changes must be backward compatible unless a deprecation window is
     explicitly planned.

4. Keep Docker first until the runtime contract is tested.
   - Swarm/Kubernetes should not leak half-designed runtime concepts into the
     product surface.

5. Do not confuse control-plane lifecycle with app lifecycle.
   - Updating OpenLander itself is a separate risk class from deploying user
     apps.

## Version Roadmap

### v0.1.x - Stabilize The Core Loop

Primary outcome: the public 0.1 product is reliable enough for dogfood and
early self-hosted users.

#### v0.1.9 - Release Confidence Patch

Scope:

- Agent-path failure-mode DX regressions.
- E2E quality-gate truth restoration.
- deploy lock/session stability.
- RC validation scripts and release hygiene.
- No new product surface.

Exit criteria:

- public release gate is green;
- live Docker E2E or documented RC smoke passes;
- fresh-VPS cold-agent dry-run passes;
- no 0.1 dormant AI/Ops guardrail is reopened.

Patch policy after v0.1.9:

- ship only regression, security, installer, or release-blocking fixes;
- do not add major product features to 0.1.x.

### v0.2.x - Safe Production Operations

Primary outcome: OpenLander can distinguish production from non-production and
protect risky operations across web, REST, MCP, and pipeline paths.

#### v0.2.0 - First-Class Environments And Deploy Policy

Scope:

- project environments: `production`, `staging`, `development`;
- environment-scoped env vars and deploy history;
- environment-aware deploy plans, status, logs, topology, rollback;
- protected production policy and durable approval flow;
- MCP environment identity and approval-aware responses;
- UI environment switcher and pending approval state;
- migration from existing service-scoped environments.

Non-goals:

- no Kubernetes/Swarm;
- no built-in autonomous AI Ops;
- no one-click self-update;
- no broad notification center.

Detailed spec:

- `.omc/plans/v0.2-safe-production-operations-spec.md`

#### v0.2.1 - Private Runtime Inputs

Primary outcome: teams can deploy private artifacts without manual host hacks.

Scope:

- generic OCI registry credentials;
- GHCR support;
- ECR/GAR follow-up adapters if credential story is clean;
- per-environment registry credential selection;
- deploy-plan validation that distinguishes repo auth from image auth.

Dependencies:

- v0.2.0 environment policy, so credentials can be scoped safely.

#### v0.2.2 - Notifications And Approval Delivery

Primary outcome: production changes and incidents reach the operator outside
the browser.

Scope:

- Slack and Discord webhooks;
- deploy, approval, failure, health, and rollback notifications;
- links back to relevant project/service/environment/action;
- notification templates with project, service, environment, actor, and status.

Dependencies:

- v0.2.0 durable approval records.

#### v0.2.3 - Update Awareness

Primary outcome: operators know a newer OpenLander version exists.

Scope:

- server-side latest-version check against GitHub Releases;
- UI banner/badge when `latest > VERSION`;
- release notes link;
- exact recommended update command;
- opt-out setting for outbound update checks.

Non-goal:

- no UI-triggered update execution.

Why this is not v0.2.0:

- update awareness is useful but not more urgent than production deploy safety.
- executing the update is a control-plane mutation and belongs in v0.3.

### v0.3.x - Control-Plane Operations And Guided Automation

Primary outcome: the operator can safely maintain OpenLander itself and receive
guided remediation without reopening uncontrolled AI behavior.

#### v0.3.0 - Guided Self-Update

Scope:

- detect install mode and supported update path;
- preflight Docker/Compose state, permissions, disk, current version, and DB
  backup capability;
- UI "Update now" for supported Docker Compose installs;
- update job logs and progress;
- rollback guidance for image update failure before irreversible migrations;
- approval/policy requirement for control-plane updates.

Non-goals:

- no blind shell execution on unknown install shapes;
- no auto-update by default;
- no migration rollback promise after irreversible DB changes unless backup
  restore is implemented and tested.

#### v0.3.1 - Backup, Restore, And Migration Safety

Scope:

- explicit backup creation before risky platform operations;
- restore documentation and tested happy path;
- migration dry-run command;
- UI/CLI visibility into last backup and last migration.

Dependencies:

- v0.3.0 update preflight or shared backup primitives.

#### v0.3.2 - Ops Center And Incident Workflow

Scope:

- clearer incident timeline;
- action runs and approvals surfaced as operational history;
- incident assignment/notes only if they do not require a team model rewrite;
- better filters by project, service, environment, severity, and actor.

Dependencies:

- v0.2 environment identity in activity/deploy/action records.

#### v0.3.x - Internal AI Ops Re-enable, Staged

Primary outcome: OpenLander can recommend remediation and optionally perform
approved actions inside policy.

Stages:

1. recommendation only;
2. approval-required low-risk actions;
3. approval-required rollback/redeploy actions;
4. limited automation only for explicitly opted-in non-production targets.

Hard requirements:

- production policy cannot be bypassed;
- durable action records exist;
- AI decisions are auditable;
- dormant 0.1 guardrails have replacement regression tests before re-enable.

### v0.4.x - Runtime Backend Expansion

Primary outcome: OpenLander can support more than single-host Docker without
breaking the product vocabulary.

#### v0.4.0 - Runtime Contract Hardening

Scope:

- define runtime capability model:
  build, workload, network, ingress, secret, volume, logs, stats, rollback;
- fake runtime backend tests;
- Docker backend conformance tests;
- remove remaining product-layer Docker assumptions where practical.

#### v0.4.1 - Docker Swarm Spike

Scope:

- single-host-to-small-cluster continuity;
- service placement basics;
- ingress and rolling deploy behavior;
- capability gaps documented before public support.

Decision gate:

- ship only if Swarm can preserve the v0.2 environment/policy model without
  special-case UX.

#### v0.4.x - Kubernetes Or k3s Spike

Scope:

- workload mapping;
- namespace/environment mapping;
- ingress controller assumptions;
- secret/volume/log behavior;
- rollback semantics.

Decision gate:

- do not promise Kubernetes until runtime capability tests make Docker and
  Kubernetes behavior comparable at the product level.

### v0.5.x - Team And Access Model

Primary outcome: multi-user operations become possible without weakening local
self-hosted simplicity.

Scope candidates:

- operator/viewer roles;
- action approval permissions;
- API token scopes;
- audit log retention policy;
- optional external auth provider.

Dependencies:

- protected environment/action model from v0.2.
- incident/action history from v0.3.

### v0.6.x - Artifact And Template Ecosystem

Primary outcome: common app/service patterns become faster to deploy without
turning the product into a marketplace too early.

Scope candidates:

- service templates;
- common framework presets;
- managed service recipes;
- environment-aware template variables;
- import/export of deploy templates.

Dependencies:

- stable environment and private input model.

### v1.0 - Stable Self-Hosted Operations

Primary outcome: OpenLander is stable enough to recommend as a serious
self-hosted deployment platform, not only an early adopter tool.

Expected bar:

- install and update path is documented and tested;
- production/staging/development model is stable;
- protected operations and approvals are reliable;
- private inputs are productized;
- notification and incident surfaces are usable;
- at least one runtime backend is deeply reliable;
- MCP contract has a documented compatibility policy;
- public docs match the product;
- release gate includes fresh-host and agent-driven smoke tests.

v1.0 does not require:

- Kubernetes support;
- broad enterprise SSO;
- fully autonomous AI Ops;
- multi-cloud abstraction.

## Cross-Cutting Workstreams

### MCP And Agent Experience

Near-term:

- keep composite tool responses small and action-oriented;
- preserve current call-helper contract;
- improve validation guidance;
- make environment identity explicit.

Later:

- deprecate confusing legacy project/service naming with aliases;
- add stronger action-run polling and approval flow;
- expose richer incident context without flooding status responses.

### Data Model

Near-term:

- stop re-litigating Project/Service split;
- add project-level environment policy;
- keep migration compatibility high.

Later:

- retire legacy environment `type` assumptions;
- consider environment-level locks;
- consider per-environment managed service instances;
- revisit custom environments.

### Runtime

Near-term:

- Docker remains the supported backend;
- remove stale Docker assumptions only when touched by planned work;
- add contract tests before new runtimes.

Later:

- Swarm first if the product needs a cluster path;
- Kubernetes/k3s only after capability boundaries are proven.

### Control Plane Lifecycle

Near-term:

- version awareness;
- release notes;
- exact manual update guidance.

Later:

- guided self-update;
- backup/restore;
- migration dry-run;
- rollback-safe update job model.

### Internal AI Ops

Near-term:

- keep dormant.
- route users toward external MCP agents.

Later:

- recommendation mode;
- approval-gated actions;
- non-production automation;
- production automation only if explicitly opted in and regression-proven.

## Sequencing Dependencies

```text
0.1.9 release confidence
  -> 0.2.0 environments + policy + approvals
    -> 0.2.1 private runtime inputs
    -> 0.2.2 notification delivery
    -> 0.2.3 update awareness
      -> 0.3.0 guided self-update
      -> 0.3.x AI Ops re-enable
    -> 0.4.x runtime backend expansion
      -> v1.0 stable self-hosted operations
```

Important ordering:

- AI Ops waits for protected environments.
- self-update waits for policy, backup, and update preflight.
- Swarm/Kubernetes waits for runtime contract tests.
- team/access model waits for durable action and approval records.

## Roadmap Risks

1. Environment model becomes too large.
   - Mitigation: fixed three environments in v0.2.0; custom later.

2. Production approval breaks existing deploy flows.
   - Mitigation: protect new projects by default; preserve migrated project
     behavior with a visible warning.

3. Self-update damages trust if it fails.
   - Mitigation: awareness first, guided update later, backup before execution.

4. Runtime abstraction becomes speculative.
   - Mitigation: no new runtime until Docker contract tests exist.

5. AI Ops re-enable reopens 0.1 dormant guardrail regressions.
   - Mitigation: recommendation mode first and explicit approval tests.

6. Roadmap drifts into enterprise breadth too early.
   - Mitigation: keep v0.2/v0.3 centered on solo/small-team self-hosted
     production operations.

## Decision Checkpoints

Before v0.2.0 implementation:

- confirm migrated production approval default;
- confirm staging public URL default;
- confirm fixed environments only;
- confirm shared managed services across environments;
- confirm project-level deploy lock remains.

Before v0.2.3:

- confirm outbound GitHub release check default and opt-out copy.

Before v0.3.0:

- define supported install shapes for self-update;
- define backup requirement;
- define what rollback means before and after migrations.

Before v0.4.0:

- define runtime capability contract;
- identify Docker-specific leaks in product APIs;
- decide whether Swarm is still strategically useful.

## Public Communication Shape

Public README/docs should stay simpler than this internal roadmap.

Recommended public framing after v0.1.9:

- Now: self-hosted deploys with MCP-native operations.
- Next: safer production workflows with environments and approvals.
- Later: private registries, notifications, update guidance, and stronger
  runtime/automation support.

Do not publicly promise:

- Kubernetes dates;
- autonomous AI Ops dates;
- one-click self-update before install/update safety is proven.
