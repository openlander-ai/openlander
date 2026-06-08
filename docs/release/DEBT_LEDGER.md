# Release Debt Ledger

Small compatibility or vocabulary decisions that were intentionally accepted for
a release should be recorded here so follow-up work is explicit.

## v0.1.16

- **No automatic force fallback for app updates:** existing
  `update_app` / `redeploy_app` no-strategy calls now block when blue-green is
  not eligible instead of silently selecting `strategy="force"`.
- **Why accepted:** OpenLander's update policy is zero-downtime by default.
  Force replacement can cause downtime and must represent an explicit user
  decision, not an agent fallback. Weak-model QA showed that force wording can
  turn a safe preserved blue-green failure into a downtime-prone retry path.
- **Vocab review:** no new MCP action, REST route, input parameter, database
  field, or target vocabulary is introduced. Existing `strategy="force"` remains
  the compatibility opt-in for users who explicitly accept downtime.
- **Endpoint collision check:** no endpoint or composite slot is added. The
  change only alters the no-strategy branch and removes force fallback call
  guidance from existing responses.
- **Follow-up:** after blue-green route cutover is stable across fresh and
  upgraded hosts, consider adding a clearer operator UI affordance for accepting
  downtime before force replacement.

- **Managed Traefik adoption guard:** legacy OpenLander Traefik containers are
  no longer adopted unless their command includes the HTTP provider endpoint and
  the expected Docker network.
- **Why accepted:** ordinary Docker-label deployments can keep working with a
  legacy Docker-provider-only Traefik container, but blue-green cutover and
  route-config updates depend on the DB-driven HTTP provider. Adopting a legacy
  container without that provider lets route probes see the old blue container
  and then drop to 404 when blue is removed.
- **Vocab review:** no user-facing vocabulary changes. This is startup/runtime
  compatibility hardening for the managed Traefik container.
- **Endpoint collision check:** no MCP action, REST route, or schema field is
  added.
- **Follow-up:** add an operator-visible diagnostic if managed Traefik is
  running without the HTTP provider after manual container changes.

## v0.1.14

- **Force-strategy guidance tightening during data-model freeze:** existing
  `update_app` / `redeploy_app` / `deploy_app` delegation / `restart_service`
  responses now warn when the force replacement path is used and no longer return
  a top-level `fallback_call` that directly suggests `strategy="force"` after an
  explicit blue-green eligibility rejection.
- **Why accepted:** weak-model D3 QA showed that even when OpenLander's default
  no-strategy path selected blue-green correctly, a model could follow force
  wording and replace a serving version after a safe failed blue-green attempt.
  The change keeps operator override available but makes the agent-facing
  contract say "diagnose/fix first, ask before accepting downtime."
- **Vocab review:** no new MCP action, REST route, input parameter, database
  field, or target vocabulary is introduced. Existing call-link fields remain
  `status_call`, `diagnostic_call`, `suggested_call`, and `poll_call`.
- **Endpoint collision check:** no endpoint or composite slot is added. The MCP
  response removes the non-contract `fallback_call` from blue-green eligibility
  rejections and uses warnings / `_agent_guidance` instead.
- **Follow-up:** if agents still force a just-failed blue-green candidate, add a
  stronger policy gate around explicit `strategy="force"` after recent preserved
  blue-green failures rather than adding more update verbs.

- **`openlander_service.update_app` during data-model freeze:** a new
  deployable-touching MCP action is added as the clear intent for updating an
  existing Application/worker to its latest stored source/image/config revision.
- **Why accepted:** weak-model D3 QA showed that the word `redeploy_app` is too
  broad for the simple "ship latest code" intent: it can read as restart,
  rebuild, rollback recovery, or force replacement. `update_app` gives agents a
  narrower front-door while reusing the existing `redeploy_app` deploy primitive,
  safety policy, deploy lock, blue-green resolver, and status/diagnostic links.
- **Vocab review:** the action lives under `openlander_service`, targets existing
  Application/worker resources with the frozen `service_id` / `service_name` /
  single-workload `project_name` vocabulary, and keeps `strategy`,
  `health_check_path`, `no_cache`, `cmd`, and `env_vars` semantics identical to
  `redeploy_app`. `redeploy_app` remains available as a compatibility/advanced
  action.
- **Endpoint collision check:** running `rg "\bupdate_app\b"` over `src`, `test`,
  and `docs` before the change showed no existing MCP action, composite slot,
  REST route, or database field collision. No REST route or schema field is
  added; the new surface is one `openlander_service` composite slot backed by
  existing pipeline behavior.
- **Follow-up:** do not add lower-level "pull/build/run" primitives for this
  release. If future benchmarks show agents still confuse app update intent,
  improve guidance and response summaries first.

- **Representative traffic deploy-log evidence during data-model freeze:**
  `deploy_logs` stores nullable `representative_traffic_json` so completed
  deploy polling can surface a post-deploy public traffic mismatch without
  reclassifying the historical deploy row as failed.
- **Why accepted:** `deploy_app(wait=true)` already probes representative public
  traffic, but agent workflows usually poll `get_deploy_status`. Without
  persisting the probe result, `/health=200` plus `/=500` can still look like a
  successful deploy in the polling path.
- **Vocab review:** no new MCP action, REST route, or target vocabulary is
  introduced. Existing `get_deploy_status` responses reuse
  `representative_traffic`, `diagnostic_call`, and `_agent_guidance`.
- **Endpoint collision check:** no endpoint or composite slot is added. The
  schema change is limited to deploy-log evidence storage; public deploy status
  remains derived from the existing `deploy_id` / `service_id` lookup.
- **Follow-up:** if deploy outcome storage grows beyond traffic evidence, replace
  this JSON text column with a typed deploy-verification table or a structured
  JSONB column once the data model is unfrozen.

- **`openlander_service.update_application_source` during data-model freeze:** a
  new deployable-touching MCP action is added to save existing
  Application/Compose source settings (`repo_url`, `branch`, `image`, `cmd`,
  `container_port`) without starting a redeploy.
- **Why accepted:** existing-service `deploy_app` must remain a redeploy
  shortcut, not a source-update API. Without a dedicated save-only action,
  agents either repeat unsupported `deploy_app(branch=...)` calls or rely on
  Web/API settings outside the MCP workflow.
- **Vocab review:** the action lives under `openlander_service`, uses the frozen
  `service_id` / `service_name` / single-workload `project_name` target
  vocabulary, and describes the user-facing target as Application/Compose.
  `service_id` remains the compatibility wire field.
- **Endpoint collision check:** running `rg "update_application_source"` over
  `src`, `test`, and `docs` before the change showed no existing MCP action,
  composite slot, REST route, or database field. No REST route or schema field
  is added; the implementation writes existing service columns.
- **Follow-up:** keep this action save-only. Git/image source-type switches are
  intentionally allowed in this release, but webhook registrations and
  branch/preview-scoped environment metadata are not cleaned up by this MCP
  action. Audit that cleanup when source providers grow beyond this save-only
  path. If provider-specific source settings are added later, extend this action
  or add a narrowly scoped sibling rather than overloading `deploy_app` or
  `redeploy_app`.

- **Service-first deploy follow-up parameters during data-model freeze:**
  existing deploy/debug MCP actions (`get_deploy_status`, `get_deploy_history`,
  `get_build_log`, and `cancel_deploy`) accept `service_id` / `service_name`
  target parameters in addition to the existing project/deploy identifiers.
- **Why accepted:** `redeploy_app` is now service-first, so the returned
  `status_call` and follow-up log/history/debug calls need a stable
  Application/Compose handle. Keeping follow-up actions project-only pushed
  agents back through runtime Project aliases and reintroduced attached-workload
  ambiguity.
- **Vocab review:** `service_id` remains the frozen MCP wire field for a selected
  Application/Compose resource. User-facing copy describes the resource as
  Application/Compose; Project targets remain compatibility shortcuts only for
  single-workload Projects.
- **Endpoint collision check:** this follow-up-parameter slice adds no MCP
  action, composite slot, REST route, or database field. It extends existing
  action schemas and updates response guidance to prefer existing `service_id`
  values.
- **Follow-up:** when the deployable model is unfrozen, review whether project
  compatibility targets should be deprecated from deploy status/history/log
  actions or remain as single-workload convenience aliases.

- **`openlander_service.apply_route_config` during data-model freeze:** a new
  deployable-touching MCP action is added to re-point a running
  Application/Compose route to a corrected `container_port` without rebuilding
  or recreating the container.
- **Why accepted:** high-confidence `PORT_MISMATCH` diagnostics need a single,
  reversible hot-path action. Without it, agents must translate a route-only
  failure into a full `redeploy_app`, which is slower and more failure-prone for
  Day-2 recovery.
- **Vocab review:** the action lives under `openlander_service`, uses the
  existing service target vocabulary (`service_id`, `service_name`, optional
  `project_name`), and mutates the existing `container_port` runtime field. It
  introduces no Project-vs-service noun alias and no REST surface.
- **Endpoint collision check:** running `rg "apply_route_config|route_config"`
  over `src`, `test`, and `docs` showed no existing MCP action or REST endpoint
  collision before the new `openlander_service` composite slot was added. The
  action is intentionally not exposed as a REST route.
- **Follow-up:** when route configuration is expanded beyond port re-pointing,
  keep live route mutations behind the same service-target vocabulary and add
  deterministic tests that assert which Traefik provider serves the route.

- **`create_deploy_plan(health_check_path=...)` during data-model freeze:**
  the existing `openlander_deploy.create_deploy_plan` action accepts the
  optional `health_check_path` parameter already supported by `deploy_app`.
- **Why accepted:** the explicit
  `create_deploy_plan -> execute_deploy_plan` flow must preserve the same route
  verification input as the one-call `deploy_app` front door. Without it, apps
  deployed through the explicit plan path skip Day-2 route verification and
  rollback with `missing_health_check_path`.
- **Vocab review:** this reuses the existing `health_check_path` parameter name
  already used by `deploy_app`, `redeploy_app`, and `diagnose_service`.
- **Endpoint collision check:** no new MCP action, composite slot, REST route,
  response field, or database field is added; the existing
  `create_deploy_plan` action schema accepts one additional optional parameter.

- **Deploy-plan execute oracle for build/provision overlap:** approved safe
  managed-resource provisioning for single-app Dockerfile plans may now run as a
  deferred runtime-env phase after deploy dispatch, instead of completing before
  dispatch.
- **Why accepted:** OpenLander keeps the composite `execute_deploy_plan`
  contract while letting app builds overlap Database/Cache creation. The build
  uses base env only; the generated managed-resource env is joined and persisted
  before any container run or live swap.
- **Vocab review:** no MCP action, REST route, schema field, or public wire name
  is added. The behavior is limited to already-approved safe proposed resources
  on an existing target Project; unapproved, non-safe, image, compose, monorepo,
  reuse, or ambiguous targets keep the sequential path.
- **Safety invariant:** `executePlan` may return `building` before provisioning
  has finished, but the deploy pipeline must not call `runContainer` until the
  deferred runtime env settles successfully. Characterization tests pin the
  updated P1/P1b/C2 oracle and the join-before-run invariant.
- **Follow-up:** consider explicit cleanup or operator surfacing for partially
  provisioned managed resources if one approved resource succeeds and a later one
  fails; this remains equivalent to the previous sequential behavior.

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

- **Conditional blue-green deploy green-identity proof:** `redeploy_app` uses
  blue-green automatically for eligible services and still accepts explicit
  `strategy="blue-green"`. It health-checks the green container directly, flips
  the OpenLander/Traefik route target, waits for the HTTP-provider polling
  window, probes the public route, observes green during the post-switch
  stability window, then removes blue.
- **Why accepted:** without an application version marker or Traefik API
  resolved-target check, the public route probe can prove ingress reachability
  but cannot prove the response came from green. This is acceptable because
  failures keep or restore blue, automatic blue-green remains eligibility-gated,
  and callers can still pass `strategy="force"` when downtime is acceptable.
- **Follow-up:** add green-identity verification via Traefik resolved server URL
  inspection or an application version marker contract.

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
