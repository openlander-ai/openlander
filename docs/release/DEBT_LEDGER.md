# Release Debt Ledger

Small compatibility or vocabulary decisions that were intentionally accepted for
a release should be recorded here so follow-up work is explicit.

## v0.1.13

- **`create_deploy_plan(target_project_id=...)` during data-model freeze:**
  `target_project_id` is added to the existing `openlander_deploy.create_deploy_plan`
  action and is forwarded into durable plan execution.
- **Why accepted:** the canonical DB-first MCP flow needs both the one-call
  `deploy_app` front door and the explicit
  `create_deploy_plan -> execute_deploy_plan` path to attach the first
  Application to an existing Project that already contains Database/Cache
  resources. The parameter reuses the existing `target_project_id` vocabulary
  from `deploy_app`; no action, route, response field, or data model rename is
  introduced.
- **Vocab review:** `Project` remains the namespace. The attached runtime is an
  Application/worker represented by the compatibility `service_id` field.
  Database/Cache/Storage resources stay under `openlander_managed_service`.
- **Endpoint collision check:** no new REST route or MCP action is added. The
  existing `create_deploy_plan` action accepts one additional optional
  parameter already used by `deploy_app`.
- **Follow-up:** before stable `v0.1.13`, keep the DB-first MCP flow in the
  release suite and run AWS clean-agent QA against a fixed RC tag instead of
  `latest`.

## v0.1.12

- **Managed resource force-delete confirmation during data-model freeze:**
  `DELETE /api/services/:id` accepts `force=true` only when paired with
  `confirm=true`.
- **Why accepted:** release QA teardown needs the same connected-resource escape
  hatch that MCP already exposes through `remove_service force=true`, otherwise
  project-scoped Database/Cache/Storage resources can block purge cleanup after
  smoke runs. The route keeps the default safe behavior unchanged and requires
  explicit confirmation before bypassing the connected-project guard and
  permanently deleting the resource volume.
- **Vocab review:** the route remains the legacy compatibility API for
  Database/Cache/Storage resources; no public noun or wire-field rename is
  introduced.
- **Endpoint collision check:** no new route is added. The existing
  `DELETE /api/services/:id` handler only recognizes the additional
  `force=true&confirm=true` query combination.
- **Follow-up:** move quality-gate teardown to a dedicated test-admin cleanup
  endpoint or harness once release QA no longer relies on product HTTP routes
  for destructive fixture cleanup.

## v0.1.9

- **MCP deploy-plan action additions during data-model freeze:**
  `openlander_deploy.get_deploy_plan` and `openlander_deploy.cancel_deploy`
  are added without changing the deployable data model.
- **Why accepted:** `get_deploy_plan` is read-only recovery/continuation
  surface for agents that only retain a `plan_id`, and `cancel_deploy` exposes
  the existing active build-stream cancellation mechanism without adding
  container, deploy-log, or service-state mutations.
- **Follow-up:** when the 0.2 deployable/service/environment model is unfrozen,
  review both actions against the final project/service/runtime ID vocabulary,
  especially monorepo child-service cancellation and plan lookup fields.

- **MCP project-first action during data-model freeze:**
  `openlander_project.create_project` is added as an empty project-group
  creation action without changing the deployable data model.
- **Why accepted:** the action exposes the existing `createProjectGroup`
  repository path and existing `display_name` / `description` / `tags`
  columns to MCP agents so they can provision project-scoped managed services
  before the first deployable app boots. It creates no runtime container,
  repository source, deploy log, or service row.
- **Vocab review:** "project" continues to mean a group/workspace that
  organizes deployable services and managed infrastructure; runtime lifecycle
  stays on `openlander_service` and managed infrastructure lifecycle stays on
  `openlander_managed_service`.
- **Endpoint collision check:** no REST endpoint is added for this MCP action;
  the existing `POST /api/projects` project-group API remains the web/API
  creation route.
- **Follow-up:** when the 0.2 project/service/environment model is unfrozen,
  review whether project creation should also accept explicit environment
  seeds or generated managed-service binding metadata, rather than extending
  the v0.1 MCP action ad hoc.

- **0.2 env-scope storage first, producers later:** PR #341 makes
  environment-scoped storage and deploy-time resolution real, but the existing
  REST/MCP/UI write surfaces still save through the v0.1 service-shared path
  unless a caller already has an internal `environment_id`. The new
  `runtimeEnvVars` resolver layer is also a protected-value consumer hook; no
  production call path populates it yet.
- **Why accepted:** this first 0.2 step fixes the storage/index/resolution
  foundation without opening a half-finished public scope API. Explicit
  `environment_key` producers, generated managed-service bindings, and
  effective preview UI need to land together in follow-up work.
- **Follow-up:** wire REST and MCP env writes to explicit
  project/service/environment scopes, populate protected generated runtime vars
  from managed binding/runtime paths, and include an RC dry-run case proving
  project-shared vars are newly inherited by service deploys while service vars
  still override colliding project keys.

- **Quality-gate compose lane:** compose E2E coverage remains supported but is
  no longer part of the default fast Playwright gate. Run it explicitly with
  `OPENLANDER_E2E_SLOW=1`.
- **Why accepted:** the public compose fixture still performs a real Docker
  build from a freshly cloned repo, so it is materially slower than the
  deploy/lifecycle/MCP smoke path. Keeping it as a named slow lane avoids
  hiding release risk behind stale `test.fixme` markers while preserving a fast
  default gate.
- **Follow-up:** move the compose fixture to a prebuilt image or dedicated slow
  CI job before requiring it in every release candidate run.

- **Environment-variable scope model:** the 0.1.x env surfaces remain
  service-first and compatibility-oriented. Environment-specific project/service
  variable behavior is intentionally deferred instead of patched through the
  current UI alone.
- **Why accepted:** 0.2 staging/preview/agent workflows need a single scope
  contract across REST, MCP, UI, and deploy resolution. A UI-only patch would
  keep project, service, and runtime-environment ownership ambiguous.
- **Follow-up:** implement the explicit 0.2 variable scope model described in
  `docs/release/ENVIRONMENT_VARIABLES_0_2_PLAN.md` as the first milestone in
  `docs/release/V0_2_ROADMAP.md` before opening larger 0.2 environment,
  preview, AI Ops, Swarm, or Kubernetes product surfaces.

## v0.1.7

- **Deployable archived-list MCP action:** `openlander_service.list_archived_services`
  is added as a read-only lifecycle inspection action.
- **Why accepted:** archive is reversible cleanup, not permanent delete. Since
  archived deployable services are hidden from default active lists, agents
  need an explicit read path to avoid mistaking "not listed" for "deleted."
- **Vocab review:** "archived service" means a deployable app/worker whose
  runtime has been stopped/removed while service-owned configuration and
  history are preserved. It excludes managed databases, caches, buckets,
  volumes, and host cleanup.
- **Endpoint collision check:** no REST endpoint is added for this MCP action;
  the web API keeps using `GET /api/projects/:id/services?include_archived=true`.
- **Follow-up:** L6.4 should add the canonical Project Settings > Danger
  archived-services cleanup surface, then decide whether the Services-tab
  "show archived" escape hatch remains needed.

- **`deploy_app(target_project_id=...)` limitations:** existing-group attach is
  re-enabled for single app/worker deploys, with membership moved into durable
  deploy-plan execution. `expose=true`, compose, and ambiguous monorepo deploys
  remain blocked for this path.
- **Why accepted:** tunnel creation and multi-service attach need separate
  durable sequencing. Agents receive `target_project_id`, `runtime_project_id`,
  and `service_id` so follow-up calls can target the attached service without
  relying on request-local post-deploy cleanup.
- **Follow-up:** move post-attach expose into the durable plan path before
  allowing `target_project_id + expose=true`.
- **Residual cleanup debt:** if the deploy itself succeeds but
  `attachServiceToProject` fails, OpenLander now marks the deploy plan failed
  with an explicit target-attach error, but the runtime temp project/service can
  remain deployed. Add an explicit cleanup/archive policy for that failure mode
  once target-attach rollback semantics are defined.

## v0.1.4

- **Managed service delete conflict REST contract:** `DELETE /api/services/:id`
  returns HTTP 409 with `{ error, code, message, connected_projects }` when a
  managed service is still referenced by projects.
- **Why accepted:** the web UI needs a direct project list to block destructive
  deletes and tell the operator what must be disconnected first. MCP keeps the
  `remove_service force=true` escape hatch; web REST does not expose force
  delete in v0.1.4.
- **Vocab review:** `connected_projects` means project groups that currently
  reference the managed service; the field intentionally stays top-level rather
  than nested in `details` for simple UI consumption.
- **Envelope review:** route-local `NOT_FOUND` and `INTERNAL_ERROR` delete
  failures also include `code` so sibling responses match the typed-error
  `{ error, code, message }` envelope.
- **Follow-up:** if REST errors are normalized in v0.2, decide whether to keep
  both `error` and `code` or migrate public clients to a single machine-readable
  field.

## v0.1.3

- **Conditional blue-green deploy green-identity proof:** v0.1.3 treats
  `redeploy_app(strategy="blue-green")` as an explicit, eligibility-gated,
  best-effort zero-downtime path. It health-checks the green container directly,
  flips the OpenLander/Traefik route target, waits for the HTTP-provider polling
  window, probes the public route, then removes blue.
- **Why accepted:** without an application version marker or Traefik API
  resolved-target check, the public route probe can prove ingress reachability
  but cannot prove the response came from green. This is acceptable for an
  opt-in v0.1.3 strategy because failures keep or restore blue and the default
  redeploy strategy remains `force`.
- **Follow-up:** before making blue-green automatic/default, add green-identity
  verification via Traefik resolved server URL inspection or an application
  version marker contract.

## v0.1.2

- **Domain route MCP contract:** `openlander_deploy.map_domain` and
  `openlander_deploy.list_domains` are removed without aliases and replaced by
  `openlander_service.add_domain_route` and
  `openlander_service.list_domain_routes`.
- **Why accepted:** v0.1 has no external users yet, and the old names implied
  DNS/Cloudflare/tunnel ownership that OpenLander does not provide in v0.1.
- **Vocab review:** use "domain route" for an internal Traefik Host/path route
  whose DNS/tunnel/TLS prerequisites are operator-owned.
- **Endpoint collision check:** no `/domain-routes` REST endpoint is introduced;
  the existing service-scoped `/domains` API path remains the web/API route.
- **Duplicate guard:** `domain_mappings_domain_path_unique` enforces unique
  `(domain, path_prefix)` registrations at the database layer.
- **Follow-up:** if external users depend on the removed MCP actions before
  v0.2, add a release-note migration snippet rather than reintroducing aliases.
