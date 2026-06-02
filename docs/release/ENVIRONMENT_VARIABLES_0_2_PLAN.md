# Environment Variables 0.2 Plan

## Goal

OpenLander 0.2 should make environment variable configuration predictable across
the web UI, REST API, MCP tools, and deploy pipeline.

The target model follows the same practical shape used by platforms such as
Dokploy: variables can be defined once at a shared project level, overridden for
a deployment environment, and finally overridden by a specific deployable
service. OpenLander also needs an explicit agent-facing contract so MCP clients
can set, inspect, and apply variables without guessing which service or
environment receives the change.

## Why This Comes First

This work should land before larger 0.2 product features such as staging
workflows, preview environments, built-in AI Ops, Docker Swarm, or Kubernetes.
Those features all depend on a clear answer to the same questions:

- Which logical environment is being deployed?
- Which service receives a variable?
- Which variable value is effective at runtime?
- Does a saved variable change require a redeploy?

The current code has useful pieces, but the contract is not yet consistent
enough to build on safely. In particular, `environment_id` exists in the
database schema, while several env-var repository and pipeline paths still treat
environment-scoped writes as project-scoped writes. The UI also exposes service
environment variables without a clear inherited/effective view.

## Target Variable Scopes

0.2 should support these scopes as the canonical model:

| Scope                   | Owner                                | Purpose                                                                        |
| ----------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| Global secret           | Instance                             | Legacy/admin-wide defaults. Lowest user-configurable precedence.               |
| Project shared          | Project group                        | Values reused by every service in the project.                                 |
| Project environment     | Project group + environment key      | Values shared by all services in `production`, `staging`, or `development`.    |
| Service shared          | Deployable service                   | Values specific to one app/worker, regardless of environment.                  |
| Service environment     | Deployable service + environment key | Final per-service override for a specific environment.                         |
| Inline deploy override  | Deploy request or plan               | One-shot values supplied by a deploy plan or API call.                         |
| System/runtime reserved | OpenLander                           | Protected runtime values such as platform-managed connection/runtime metadata. |

Effective runtime precedence should be:

```text
global secret
  < project shared
  < project environment
  < service shared
  < service environment
  < inline deploy override
  < protected system/runtime values
```

Protected system/runtime variables should either be rejected on write or clearly
reported as reserved, so users and agents do not believe they changed a value
that OpenLander must control.

## Environment Identity

Use `environment_key` as the public contract for variable scope:

- `production`
- `staging`
- `development`

The existing `environments` table is service-runtime oriented in the current
schema. 0.2 should avoid using a single service runtime `environment_id` as the
public identifier for project-level shared environment variables. The
implementation can map `environment_key` to existing runtime rows, or add a
dedicated logical project-environment table later, but UI/API/MCP callers should
not need to know service-runtime row ids just to edit shared environment
variables.

This keeps the model compatible with multi-service project groups and leaves a
clean path for custom environment names after 0.2.

## Reference Syntax

OpenLander should support explicit interpolation in service variables:

```text
DATABASE_URL=${{project.DATABASE_URL}}
DATABASE_PASSWORD=${{environment.DATABASE_PASSWORD}}
APP_URL=https://${{service.PUBLIC_HOST}}
```

Rules:

- `${{project.KEY}}` reads project shared variables.
- `${{environment.KEY}}` reads the selected project environment variables.
- `${{service.KEY}}` reads service shared or service environment variables.
- `${{KEY}}` is allowed as a service-local shorthand only.
- Missing references fail validation before deploy.
- Cycles fail validation before deploy.
- Shell-style expansion is not supported.
- Resolved previews must mask secret-looking values by default.

## Web UX

Project pages should expose a `Variables` surface with environment selection:

- Shared
- Production
- Staging
- Development

Service pages should expose a `Variables` surface that shows:

- inherited project values,
- inherited environment values,
- service overrides,
- generated/managed values,
- the final effective runtime value for the selected environment.

Expected controls:

- raw `.env` paste/edit mode,
- key/value table mode,
- import/export `.env`,
- mask/unmask per row,
- source badges such as `Project`, `Environment`, `Service`, `Generated`,
- changed-state detection,
- a redeploy-needed banner when a saved change affects a running service.

The UI should not make users choose internal service-runtime environment ids.

## REST And MCP Contract

REST endpoints and MCP tools should accept explicit scope data instead of
inferring scope from ambiguous project/service ids.

Recommended shape:

```json
{
  "scope": "project" | "project_environment" | "service" | "service_environment",
  "project_id": "project-id",
  "service_id": "service-id",
  "environment_key": "production",
  "variables": {
    "DATABASE_URL": "${{environment.DATABASE_URL}}"
  }
}
```

MCP responses should continue using the existing response envelope. Do not add
new one-off helper fields. Use `suggested_call`, `status_call`,
`diagnostic_call`, and `_agent_guidance` for follow-up actions.

MCP env writes should stay save-only by default. If a running service is
affected, return `needs_redeploy: true` and guide the agent to call the existing
redeploy action unless immediate apply was explicitly requested.

## Implementation Sequence

1. Add env-domain tests that capture the target scope and precedence model.
2. Refactor the env-var repository around explicit scope methods.
3. Add or migrate storage so environment-scoped project/service variables do not
   collapse into project-scoped rows.
4. Add a deploy resolver with deterministic precedence across saved, inline, and
   protected runtime-generated values.
5. Add a resolver that returns both raw layers and the effective masked view.
6. Add interpolation validation and resolved preview behavior.
7. Update REST routes to accept explicit scope and environment keys.
8. Update MCP env tools to expose the same scope model.
9. Replace the service-only web env editor with project/service variable views.
10. Update docs and release-gate tests after the behavior is implemented.

The first storage/resolution PR intentionally covers steps 1-4 only. Steps 5-10
are the producer/API/UI follow-up and must remove the remaining v0.1
service-shared-only write path before 0.2 is considered complete.

## Out Of Scope For 0.2

- Full secret vault with per-secret ACLs.
- Per-variable history and rollback.
- Custom arbitrary environment names beyond the supported keys above.
- Preview deployments as a separate product surface.
- Built-in AI Ops remediation.
- Docker Swarm or Kubernetes runtime support.

Those features should consume the 0.2 variable contract rather than redefining
it.

## Verification

The release gate for this work should prove:

- project shared variables are visible to every service in the project,
- project environment variables override project shared variables,
- service variables override project/environment variables,
- service environment variables override service shared variables,
- inline deploy values override saved user values,
- protected system/runtime variables cannot be silently overridden,
- interpolation resolves correctly and fails on missing references or cycles,
- REST and MCP writes hit the same storage path,
- the web UI shows inherited/effective values consistently,
- a running service reports `needs_redeploy` after an env change.
