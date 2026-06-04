# OpenLander 0.2 Roadmap

## Goal

0.2 should turn the stabilized 0.1 release into a clearer multi-service,
multi-environment deployment platform without opening broad new automation
surfaces too early.

The main product direction is:

- treat the v0.1.14 Day-2 recovery loop as the automation foundation: agents get
  one high-confidence diagnosis, one safe next action, and an explicit
  verification result,
- keep project groups, deployable services, managed services, and environments
  easy to distinguish,
- make environment-specific configuration predictable,
- make every important mutation usable from both the web UI and MCP,
- keep built-in AI/Ops automation dormant until its product surface and tests
  are restored together.

## Baseline From v0.1.14

OpenLander 0.1.14 establishes the external-agent recovery contract that 0.2
should preserve:

- `diagnose_service` keeps raw evidence while adding high-confidence
  deterministic diagnosis codes only when the pattern is precise.
- Safe hot paths avoid full redeploy when possible: route re-pointing through
  `apply_route_config` and runtime env apply through same-image recreate.
- Hot-path action results expose verification details through existing response
  fields such as `route_verification`, `runtime_apply`, and `diagnostic_call`.
- Route verification waits for the managed Traefik HTTP-provider poll window
  before accepting a 2xx so stale routes are not treated as successful cutovers.
- Full redeploy remains the fallback for build-time env changes, missing runtime
  images, or failed hot paths that diagnostics cannot resolve.

This is intentionally not built-in autonomous remediation. The supported model
is still MCP-first: external agents inspect, decide, call actions explicitly,
and read verification results.

## First Milestone: Variables And Environment Scope

The first 0.2 milestone is the environment-variable scope refactor described in
`docs/release/ENVIRONMENT_VARIABLES_0_2_PLAN.md`.

This comes first because staging, preview deployments, managed-service binding,
agent workflows, Swarm, and Kubernetes all need the same answers:

- which logical environment is targeted,
- which deployable service receives the change,
- which value is effective at runtime,
- whether saving a change requires redeploying a running service.

## Milestones

### 1. Environment Variables Contract

- Define canonical variable scopes across project, environment, service, and
  deploy-time overrides.
- Stop collapsing environment-scoped writes into project-scoped rows.
- Add effective-variable resolution with source metadata.
- Add interpolation validation for project/environment/service references.
- Expose the same model through REST, MCP, and the web UI.

### 2. Project, Service, And Environment Identity Cleanup

- Keep "project" as the user-facing group/workspace.
- Keep "service" as the deployable app/worker or managed infrastructure unit.
- Use public `environment_key` values for logical environments instead of
  leaking service-runtime row ids into user-facing workflows.
- Treat `environment_key` as the deployment **target** key (omitted =
  production). `Environment` stays reserved as a future project-level product
  noun, not a 0.2 grouping object; the 0.2 model is flat `Project -> Resource`.
- Preserve compatibility for existing v0.1 project/service routes while adding
  clearer 0.2 paths where needed.

### 3. Deployment Targets (production / development, staging-ready)

- Ship `production` and `development` as the default deployment targets.
- Keep the target-key model forward-compatible so `staging` becomes an additive
  target later, not a rewrite: the schema and `environment_key` already accept a
  `staging` key, but staging is **not** shipped as a default 0.2 target or UI
  tab.
- Add branch-to-target mapping that works for webhooks and manual deploys.
- Make production-impacting changes visibly protected in UI and MCP guidance.
- Keep custom arbitrary environment names, and staging as a default product
  surface, out of 0.2 until the fixed-key model is stable.

### 4. Managed Service Binding Across Environments

- Make generated connection variables environment-aware.
- Show generated/managed values as a separate source in effective env views.
- Prevent managed runtime values from being silently overridden by user writes.
- Keep standalone managed-service creation and deploy-plan auto-wiring aligned.

### 5. Agent And UI Contract Stabilization

- Keep MCP env writes save-only by default, with `needs_redeploy` guidance.
- Ensure REST and MCP writes hit the same storage and validation path.
- Add UI source badges, masked effective previews, import/export, and redeploy
  warnings.
- Add release-gate tests for REST/MCP/UI consistency where practical.

### 6. Recovery Loop Coverage Expansion

- Add more high-confidence diagnosis codes only when they can be supported with
  deterministic evidence and a safe next action.
- Keep ambiguous cases raw-evidence-only instead of returning confident but weak
  guesses.
- Prefer reversible or rollback-verified hot paths over full redeploy.
- Add dogfood/live release gates for every newly supported recovery loop before
  considering internal automation.

## Later Than 0.2

These remain important, but should build on the 0.2 contract rather than
reshaping it:

- preview deployments as a separate product surface,
- custom arbitrary environment names,
- full secret vault with per-variable ACLs and history,
- built-in AI Ops remediation that automatically executes fixes,
- Docker Swarm runtime,
- Kubernetes runtime,
- destructive dry-run previews for broader platform operations.

## Acceptance Criteria

0.2 is not ready until the following are true:

- a user can tell whether a value belongs to the project, environment, service,
  or generated runtime layer,
- an MCP agent can set and inspect env vars without relying on ambiguous target
  inference,
- a running service reports clearly when an env change requires redeploy,
- staging/development do not reuse production values accidentally,
- production-impacting changes are visible and intentionally applied,
- hot-path recovery actions report whether they were verified, skipped, failed,
  or rolled back,
- docs and tests describe the same precedence and scope model implemented in
  code.
