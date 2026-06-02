# OpenLander 0.2 Roadmap

## Goal

0.2 should turn the stabilized 0.1 release into a clearer multi-service,
multi-environment deployment platform without opening broad new automation
surfaces too early.

The main product direction is:

- keep project groups, deployable services, managed services, and environments
  easy to distinguish,
- make environment-specific configuration predictable,
- make every important mutation usable from both the web UI and MCP,
- keep built-in AI/Ops automation dormant until its product surface and tests
  are restored together.

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
- Preserve compatibility for existing v0.1 project/service routes while adding
  clearer 0.2 paths where needed.

### 3. Staging Workflow

- Support `production`, `staging`, and `development` as first-class logical
  environment keys.
- Add branch-to-environment mapping that works for webhooks and manual deploys.
- Make production-impacting changes visibly protected in UI and MCP guidance.
- Keep custom arbitrary environment names out of 0.2 unless the fixed-key model
  is already stable.

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

## Later Than 0.2

These remain important, but should build on the 0.2 contract rather than
reshaping it:

- preview deployments as a separate product surface,
- custom arbitrary environment names,
- full secret vault with per-variable ACLs and history,
- built-in AI Ops remediation,
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
- docs and tests describe the same precedence and scope model implemented in
  code.
