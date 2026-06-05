# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.14-rc.8] - 2026-06-05

### Fixed

- Surface recent post-deploy restart loops in completed `get_deploy_status`
  responses, so a successful deploy log does not hide a current unhealthy
  container.

## [0.1.14-rc.7] - 2026-06-05

> `v0.1.14-rc.6` is superseded for release QA. This candidate adds the
> local operator path needed to rotate OpenLander MCP tokens safely during
> repeated QA host preparation without exposing setup-password flows over the
> public HTTP surface.

### Added

- Add local `openlander mcp token ensure` and guarded
  `openlander mcp token rotate --yes` commands for server-side MCP org token
  creation and rotation, with JSON output for QA/operator scripts.

## [0.1.14-rc.6] - 2026-06-05

> `v0.1.14-rc.5` is superseded for release QA. Live Day-2 and
> honest-failure QA found that runtime diagnostics could hide route/port
> failures behind host-port fallback probes and could report recent crash loops
> as successful deploys.

### Fixed

- Keep `diagnose_service` from letting host-port fallback mask a broken
  service/container-port route, so route or port mismatches surface as
  actionable `PORT_MISMATCH`/route diagnostics instead of all-green output.
- Avoid dependency-cause synthesis when the service container is unavailable,
  preventing dead containers from being misreported as
  `DEPENDENCY_UNREACHABLE`.
- Report recent repeated container restarts as unhealthy/restart-loop signals
  in both `diagnose_service` and `deploy_app` readiness instead of returning
  successful/running status.

## [0.1.14-rc.5] - 2026-06-04

> `v0.1.14-rc.4` is superseded for release QA. Source changes for existing
> Applications/Compose workloads now have a dedicated save-only MCP action
> instead of being mixed into `deploy_app` or `redeploy_app`.

### Added

- Add `openlander_service.update_application_source` as the dedicated save-only
  MCP action for changing an existing Application/Compose Git repo, branch,
  image source, image command, or saved container port before calling
  `redeploy_app`.

### Fixed

- Route existing-service `deploy_app` source override attempts to
  `update_application_source`, while keeping Dockerfile/build config changes on
  `update_service_config`.
- Return `status: "unchanged"` and `needs_redeploy: false` for same-value source
  update requests so agents do not trigger unnecessary redeploys.

## [0.1.14-rc.4] - 2026-06-04

> `v0.1.14-rc.3` is superseded for release QA. Live MCP QA found that
> existing-service `deploy_app` requests could accept source/build override
> inputs that the redeploy path does not apply, and that app self URLs could be
> reported as high-confidence external dependency failures.

### Fixed

- Reject unsupported source/build override inputs when `deploy_app` resolves to
  an existing Application/Compose service, so agents do not assume `branch`,
  `repo_url`, or Dockerfile overrides were applied to a redeploy.
- Keep `diagnose_service` from treating OpenLander-managed public routes and
  self URL environment variables as external dependency failures, so route and
  port failures are not hidden behind misleading `DEPENDENCY_UNREACHABLE`
  diagnoses.

## [0.1.14-rc.3] - 2026-06-04

> `v0.1.14-rc.2` is superseded for release QA. Exact-image GitHub release gate
> passed, but dogfood Day-2 live QA found that route verification could accept a
> stale 2xx from the previous Traefik HTTP-provider snapshot immediately after a
> bad route target flip.

### Fixed

- Wait past the managed Traefik HTTP-provider poll window before accepting a
  public route 2xx as verified after route target flips, preventing
  `apply_route_config`, same-image runtime recreate, and blue-green swaps from
  treating stale routes as successful cutovers.

## [0.1.14-rc.2] - 2026-06-04

> `v0.1.14-rc.1` is superseded for release QA. Live Day-2 route recovery QA found
> that new apps could drop their configured health path before route
> verification.

### Fixed

- Preserve `health_check_path` from `deploy_app` and
  `create_deploy_plan -> execute_deploy_plan` through the deploy plan and first
  service-row creation paths so Day-2 route verify/rollback does not skip with
  `missing_health_check_path`.

## [0.1.14-rc.1] - 2026-06-04

> `v0.1.13-rc.3` is superseded for release QA. It fixed DB-first deploy and
> URL projection issues, but Mac mini QA found that service env vars saved on an
> existing Application could be skipped by the legacy Project-centered
> `redeploy(projectId)` path.

### Changed

- Added `pipeline.redeployService(service_id)` as the service-first redeploy
  contract for existing Applications and Compose workloads.
- Kept `pipeline.redeploy(project_id)` as a compatibility wrapper that resolves
  exactly one Application/Compose service before dispatching to the service-first
  path.

### Fixed

- Fixed MCP and web service redeploy actions so they redeploy the selected
  Application/Compose service id rather than the runtime Project id.
- Fixed immediate redeploy after `set_env_vars` so saved service-scoped env vars
  are applied to the next container runtime.
- Fixed service env reads so `service_id` is the canonical identity even when
  the env row's `project_id` is an ownership/group metadata value.
- Added release-gated coverage and an audit guard for service-first redeploy
  routing, attached workload config reconstruction, and cross-project
  service-env reads.

## [0.1.13-rc.3] - 2026-06-04

> `v0.1.13-rc.2` is superseded for release QA. It fixed the DB-first
> service-row/FK path, but AWS QA found that attached Applications could still
> advertise the Project namespace URL instead of the actual Application route.

### Fixed

- Hardened DB-first failure handling so pre-service deploy crashes preserve the
  original failure and do not write secondary deploy-log records against a
  missing Application service row.
- Replaced the synthetic `__svc` write-path audit with AST-backed checks so the
  release gate enforces real call sites without false positives from comments.
- Fixed agent-facing URL projection for attached Applications and Compose
  stacks so Project-level responses advertise the actual service route rather
  than the Project namespace route.
- Added release-gated coverage for the reported Project `p2probe` plus
  Application `urlnest` route mismatch.

## [0.1.13-rc.2] - 2026-06-04

### Fixed

- Fixed DB-first Project/Application identity handling so an empty Project gets
  its first Application service row before service-scoped environment and deploy
  log writes.
- Added release-gated MCP contracts for the canonical DB-first flows:
  `create_project -> create_service(project_id) -> deploy_app(target_project_id)`
  and
  `create_project -> create_service(project_id) -> create_deploy_plan/execute_deploy_plan`.
- Hardened service-scoped write repositories so `environments`, `deploy_logs`,
  `deploy_configs`, `runtime_incidents`, and `service_connections` resolve an
  existing service row before inserting FK-bearing records.
- Added a release-suite audit guard to keep synthetic `__svc` id derivation out
  of first-Application deploy ordering and managed-resource connection writes.

## [0.1.13-rc.1] - 2026-06-04

> **YANKED / DO NOT USE:** release QA reproduced the DB-first plan path failure
> this RC was meant to fix. Use `v0.1.13-rc.2` or later for AWS validation.

### Fixed

- Fixed Project-first Database/Cache deploys so Applications started with
  `target_project_id` run on the target Project network while keeping their
  Application route/container identity.
- Made Deployment Target creation idempotent for pre-created Projects by
  returning the existing environment row for the canonical service/type target.
- Allowed a first Application to use the same name as its target Project while
  preserving collision protection against other Projects.
- Returned actionable MCP guidance for Database/Cache/Storage resource Docker
  name conflicts, including an orphan-inspection follow-up call.
- Hardened managed cleanup and incident reporting paths used by release QA so
  Project-owned resources and managed incidents are handled consistently.

## [0.1.12] - 2026-06-03

### Added

- Added release-gated public vocabulary audits for launch docs, MCP/runtime/LLM
  copy, web copy, and web API runtime string literals.
- Added execute-plan characterization coverage for approval atomicity,
  pre-commit failure paths, and deploy response behavior.

### Changed

- Aligned public product vocabulary and Project detail IA around Projects,
  Applications, Compose stacks, and Database/Cache/Storage resources while
  preserving existing MCP and REST compatibility names.
- Split deploy-plan execution phases and centralized deploy-plan response
  builders without changing wire response helper fields.
- Aligned Compose read surfaces so a Compose stack is represented as one
  Project-level resource with internal runtime nodes.

### Fixed

- Fixed Database/Cache/Storage resource linking for empty Projects and attached
  Applications by resolving real consumer workloads instead of relying on
  synthetic `__svc` identifiers.
- Hardened DB-first and existing-Project deployment flows so approved resources,
  env injection, and connection records stay consistent.
- Made archive approval policy context-aware so non-production archive actions
  can proceed automatically while running production resources still require
  approval.

## [0.1.11] - 2026-06-03

### Added

- Added a project-first MCP flow with `openlander_project.create_project` so
  agents can create an empty project group, provision managed services, and
  attach the first deployable app without using placeholder connection strings.

### Changed

- **Breaking (REST):** `POST /api/services` now requires `project_id`,
  `target_project_id`, or `project_name`; standalone managed-service creation
  is rejected with `PROJECT_TARGET_REQUIRED`.

### Fixed

- Blocked project hard-delete and purge while project-scoped managed services
  still exist, so managed services cannot be left behind by project deletion.

## [0.1.10] - 2026-06-02

### Fixed

- Avoided synthetic service host URLs in public topology responses so clients
  only receive concrete service connection URLs.

## [0.1.9] - 2026-06-02

### Changed

- Recovered the 0.1 quality-gate E2E suite by removing stale `fixme` markers
  for supported deploy, lifecycle, MCP, and webhook scenarios while keeping
  dormant Recovery/OpsAgent coverage explicitly deferred.
- Moved compose quality-gate coverage into an explicit slow lane via
  `OPENLANDER_E2E_SLOW=1` so the default release gate stays fast and honest.
- Hardened the release gate with a fresh-runner RC cold-agent smoke path that
  can validate either the current checkout or an exact published RC image.

### Fixed

- Propagated deploy-plan lock sessions into monorepo deploy execution and added
  parent deploy-lock protection for top-level monorepo deploys.
- Centralized Docker container-start port-cache invalidation so immediate
  follow-up managed-service allocations see newly bound host ports.
- Tightened MCP validation retry guidance so direct platform-tool calls do not
  echo an empty nested `params` object back as the suggested retry.
- Replaced the hardcoded GitHub API `User-Agent` version with the shared
  application `VERSION` and removed a duplicate dead return.
- Prevented false-success deploy results for containers without a Docker
  `HEALTHCHECK` that exit or enter restart loops immediately after startup.

## [0.1.8] - 2026-06-01

### Added

- Added MCP project topology visibility and managed-service project filters so
  agents can see project-scoped app and infrastructure relationships.
- Added approval-gated deployable service archive/restore actions with matching
  web UI affordances for partial project archives.
- Added retry-shaped MCP validation guidance for invalid tool calls so agents
  get a concrete next call instead of only a schema error.

### Changed

- Completed the service-first `ServiceView` migration across web, MCP,
  monitoring, recovery, deploy-plan, and lifecycle decision paths.
- Unified project detail service lists around application and infrastructure
  services while keeping archived services tucked behind a low-emphasis toggle.
- Improved project cards and summaries so active deployable counts, total
  service counts, aggregate status, and partial archive badges stay consistent.
- Refreshed git-dependency build-cache handling so dependency installs are
  invalidated only when relevant dependency specs are detected.

### Fixed

- Preserved deploy-plan `project_id` target context through plan storage and
  execution so existing-project managed provisioning locks and deploys against
  the intended project group instead of falling back to name-only lookup.
- Routed `expose_public` port selection through the service-first read model so
  canonical deployable service ports win over stale project-group columns.
- Fixed project detail pages for archived projects and active topology views so
  archived services do not inflate active service counts.
- Fixed project topology rendering for managed dependencies, including visible
  app-to-infrastructure edges and stable service kind classification.
- Fixed MCP platform cleanup dry-run previews, larger runtime/build log
  retrieval, and captured runtime log surfacing in deploy diagnostics.
- Fixed service list and project-card count mismatches caused by archived or
  attached infrastructure services.

## [0.1.7] - 2026-05-29

### Added

- Added the `ServiceView` read model as the service-first source of truth for
  deployable-service read surfaces while preserving existing project API
  response shapes.
- Added MCP drift gates that verify composite actions, ToolDef registration,
  docs references, schema-required params, and shorthand examples stay aligned.

### Changed

- Migrated runtime stats, expose-tunnel, legacy topology-node, and project API
  projection helpers to consume `ServiceView`.
- Split dormant AI Ops classes into the 0.2 cold-storage boundary so the 0.1
  runtime surface remains deterministic and MCP-driven.
- Deduplicated route and Docker-stats helper logic across topology, stats,
  preview, and expose endpoints.
- Polished public launch docs with a visible current-status section, clearer MCP
  adapter positioning, demo-app links, and host-exposure security guidance.

### Fixed

- Fixed project detail/topology reads so project-scoped managed services are
  included consistently.
- Reduced infrastructure analyzer filesystem scanning by collecting dependency
  files in a single walk.

## [0.1.6] - 2026-05-27

### Added

- Added login and first-boot password setup rate limiting
  (`10` attempts per `60s`) with `429 RATE_LIMITED` responses and
  `Retry-After` headers.
- Added Amazon Linux, GCP, Azure, and DigitalOcean public IP detection to the
  installer so fresh cloud installs can advertise reachable app URLs more
  reliably.
- Added release-gate documentation for fresh-agent MCP onboarding, including
  the Your Agent token location, origin-relative `/mcp` endpoints, Claude Code
  setup, and the two demo paths used by launch dry-runs.
- Added MCP prompt guidance for recovering failed deploys and synchronizing the
  deployment-guide flow with approval handling.

### Changed

- Centralized managed-service connect/disconnect behavior through
  `ManagedServiceLinker` across MCP, REST, and deploy-plan provisioning so
  service connections, project dependencies, and topology read models stay in
  sync.
- Clarified the MCP token lifecycle in public docs: org tokens are shown once,
  regeneration revokes the previous token, and agent configs must be updated
  with the new value.
- Clarified human-only cleanup actions in MCP docs/tool guidance so agents do
  not attempt destructive cleanup flows that require the web UI.
- Unified MCP restricted-action policy into one source and added registry tests
  to keep destructive actions aligned with the safety matrix.
- Moved live approval-list reads to the action-run ledger and documented the
  dormant in-memory `ApprovalGate` as v0.2 cold storage.
- Installer output now explicitly tells operators to open inbound TCP `80` and
  the dashboard/MCP port, and warns when localhost/private host fallback may not
  be externally reachable.

### Fixed

- Fixed managed service project connections created through MCP so project
  dashboards and topology views show attached Postgres/Redis/etc. services.
- Fixed topology read models so managed dependencies appear as nodes and
  app-to-managed dependency edges instead of being dropped.
- Fixed deploy-plan managed-service provisioning to use the same linker path as
  direct connect flows.
- Fixed secret-scan false positives in approval-route tests by replacing
  token-like fixture values with explicit test identifiers.

## [0.1.5] - 2026-05-25

### Fixed

- Fixed health monitoring so Docker containers in restart loops
  (`Restarting=true`) are treated as unhealthy and the canonical service status
  is updated to `error` instead of staying `running`.
- Fixed project health status propagation so repeated failed probes move the
  service status to `error`, and a later healthy probe restores it to
  `running`.

### Changed

- Updated the README quickstart to point first-time users at the minimal
  `openlander-demo-app` sample and to call out default MCP secret masking.
- Hardened `redeploy_app(strategy="blue-green")` as an explicit, conditional
  strategy for eligible git/image services behind managed OpenLander/Traefik
  routes. The default strategy remains `force`; compose stacks and services
  without health checks are rejected with `BLUE_GREEN_UNSUPPORTED`.

## [0.1.2] - 2026-05-21

### Changed

- **Breaking (MCP):** `openlander_managed_service.create_service` now requires
  `project_id`/`project_name`. Global managed-service creation is no longer
  exposed over MCP because project network isolation has no cross-project grant
  model in v0.1.2.
- **Breaking (MCP):** replaced `openlander_deploy.map_domain` and
  `openlander_deploy.list_domains` with
  `openlander_service.add_domain_route` and
  `openlander_service.list_domain_routes`. The old `deploy_app(domain=...)`
  shortcut is removed; agents must deploy the app first, then register a domain
  route for a Host/path that already reaches OpenLander.
- **Breaking (Runtime):** Project-scoped app and managed-service containers now
  run on per-project Docker networks, with Traefik joined to those project
  networks for routing. Apps that used unassigned/global managed services as
  runtime databases/caches must recreate those services in the target project and
  update env vars before redeploying. After upgrading, redeploy project apps
  promptly so app containers and managed services land on the same project
  network.

### Fixed

- Made MCP deploy status polling ignore stale completed in-memory jobs when a
  newer redeploy lock exists, and return deploy-log revision details for
  completed project status checks while preserving deploy URLs and reading
  health from the deployable service row.
- Fixed managed-service `create_service` responses so `suggested_env` contains
  awaited connection-string recommendations instead of an empty object, and
  legacy template names like `postgresql`/`mongodb` are stored with canonical
  managed-service kinds so env recommendations are not skipped. Existing rows
  in `ol-svc-*` managed-service containers with valid managed-service
  connection strings but generic `image` kind are repaired on startup so they
  reappear in managed-service lists.
- Adjusted managed-service `suggested_env` so project services prefer
  app-standard keys like `DATABASE_URL`/`REDIS_URL` unless the target project
  already has that key.
- Limited deploy-plan managed-service reuse to the target project only. Detected
  database/cache dependencies now require explicit env input when no same-project
  managed service exists, preventing cross-project connection strings from being
  auto-wired into isolated project networks.
- Fixed MCP env updates so changing env vars on deployed services with statuses
  like `healthy`/`unhealthy` correctly reports that a redeploy is required.

## [0.1.1] - 2026-05-15

### Added

- Added service-level custom domain management with database-backed mappings,
  path prefixes, target-port overrides, and dynamic Traefik config generation.
- Added a Domains tab to service detail pages for add/delete domain flows.
- Added multi-vendor MCP client setup snippets, instance identity, and clearer
  "Your Agent" onboarding for multi-server MCP use.
- Added machine-readable MCP composite action contracts in `help` and
  `INVALID_PARAMS` responses so agents can self-correct invalid parameters.
- Added `openlander_monitor.diagnose_service`, a read-only MCP diagnostic action
  for deployable services with masked env inventory, sanitized logs, container
  status, HTTP probes, dependency probes, and next-action guidance.
- Added `openlander_monitor.diagnose_host_resources`, a read-only host resource
  diagnostic for Docker reachability, host CPU/memory/disk pressure, and top
  container resource usage.
- Added `openlander config reset-apps [--force]` to remove application-managed
  containers while preserving OpenLander itself and volumes.

### Changed

- Made `deploy_app` the MCP app-deploy front door: it creates new apps when
  `repo_url`/`image` is provided and routes existing app targets to redeploy
  when a concrete service or single-service project target is provided.
- **Breaking (MCP):** renamed `openlander_deploy.deploy` to
  `openlander_deploy.deploy_app` and `openlander_service.deploy_service` to
  `openlander_service.redeploy_app`. `create_service` remains the managed
  infrastructure action for databases, caches, and storage.
- Removed `archive_service` and `unarchive_service` from the default MCP
  composite surface; archive/restore remains available through the web/API
  lifecycle.
- Hardened the installer update path so `update` preserves the existing Compose
  project name, pulls only the OpenLander runtime image, and recreates only the
  app container instead of disturbing the Postgres sidecar.
- Added `OPENLANDER_PUBLIC_HOST` support and `preferred_url` in project/deploy
  responses so users and agents get a canonical app URL instead of Docker
  bridge-only addresses.
- Release publishing now supports RC tags without moving `latest`; final
  releases update `latest` and the `<major>.<minor>` image tag.
- Tightened GitHub Actions concurrency and trigger scopes to reduce duplicate
  workflow runs.
- Moved language selection out of setup and into login/account chrome so first
  boot focuses on account creation and MCP setup.
- Completed the Korean/English i18n pass for Monitoring, ServiceDetail,
  ManagedServiceDetail, ProjectView not-found states, and agent-guide copy.
- Refreshed README screenshots for the dashboard and MCP setup surfaces.
- Clarified MCP rollback guidance so deployable-service rollback/redeploy and
  managed-service backup/restore are not presented as interchangeable actions.

### Fixed

- Made `deploy_app` report `readiness` and return `status: "unhealthy"` when a
  running container's Docker healthcheck is failing instead of treating it as a
  successful deploy.
- Stopped GitHub repo discovery MCP responses from returning credentialed clone
  URLs; private repo credentials are now kept internal to clone time.
- Reduced infrastructure analyzer false positives by no longer treating generic
  ORM packages as PostgreSQL, and by reading Prisma datasource providers and
  `DATABASE_URL` schemes instead.
- Removed `postgresql://localhost` deploy-plan placeholders; planned or reused
  managed services now satisfy required env vars and inject real connection
  strings at execution time.
- Normalized MCP targeting for logs, stats, diagnostics, deploy history, build
  logs, host probes, action status, and managed-service status/credentials.
- Allowed deployable-service MCP actions to resolve `service_name` as the
  project group name when that group has exactly one deployable service.
- Added `deploy_id`/`job_id` lookup to `get_deploy_status` so completed deploys
  and unknown ids are distinguishable.
- Improved `diagnose_service` HTTP probes for apps mounted under a base path and
  for internal Docker DNS/network namespace checks.
- Fixed managed-service backups in Docker installs by writing backup archives
  through the shared OpenLander data volume instead of a container-local path.
- Kept deployable app/worker services out of managed-service MCP responses and
  return explicit guidance when a managed-service action receives one.
- Cleaned up stale Docker network endpoints for compose services before
  redeploying, after failed starts, and during rollback/stop so failed compose
  deploys cannot wedge future deploys with `endpoint already exists in network`.
- Avoided reconnecting compose services to the shared `openlander` Docker
  network after they have already been attached with their DNS alias.
- Preserved Docker Compose service-name DNS aliases such as `postgres` and
  `redis` when OpenLander runs compose services through Dockerode.
- Rejected Docker Compose host port mappings before deployment; use
  `expose:`/container ports and OpenLander's Traefik routing instead.
- Showed compose child services in project topology, service detail lists, and
  monitoring pages instead of showing only the compose parent metadata service.
- Classified MCP/tool-initiated deploys and redeploys as MCP activity instead
  of `human` in the Activity feed.
- Fixed managed service creation on fresh Postgres installs by ensuring the
  synthetic managed-service group exists before inserting service rows.
- Rolled back managed service containers and volumes if service persistence
  fails after Docker resources have already been created.
- Added a Linux `/proc/net/tcp{,6}` fallback for port scanning when `ss` is not
  installed.
- Hardened diagnostic sanitization for additional secret-like tokens in logs and
  probe errors.
- Fixed setup/login handoff, setup wizard step clamping, and remaining
  Korean/English onboarding copy inconsistencies.

### Performance

- Batched periodic monitor sweeps so health, reconciler, and infrastructure
  alert checks reuse project/service maps instead of repeatedly querying
  deployable service rows per project.
- Batched monitoring metric reads and added lightweight runtime metric refresh
  samples so topology and service rows show recent CPU/memory without
  per-request Docker stats fanout.

## [0.1.1-rc.7] - 2026-05-15

### Changed

- Hardened the installer update path so `update` preserves the existing Compose
  project name, pulls only the OpenLander runtime image, and recreates only the
  app container instead of disturbing the Postgres sidecar.
- Added `OPENLANDER_PUBLIC_HOST` support for advertised app URLs, avoiding
  container-private bridge IPs in Docker installs.
- Added `preferred_url` to project/deploy responses so agents can use the
  canonical app URL without interpreting the full `urls` array.
- Made `deploy_app` the MCP app-deploy front door: it creates new apps when
  `repo_url`/`image` is provided, and routes existing app targets to redeploy
  when `service_id`, `service_name`, or a single-service project `name` is
  provided.
- Removed `archive_service` and `unarchive_service` from the default MCP
  composite surface; archive/restore remains available through the web/API
  lifecycle.
- Added `openlander config reset-apps [--force]` CLI subcommand. Lists every
  application-managed container (label `openlander.managed=true` + a non-empty
  `openlander.role`) and, with `--force`, stops + removes them. The OpenLander
  backend itself is intentionally excluded; use `docker compose down` for that.
  Volumes are preserved.

### Fixed

- Made `deploy_app` report `readiness` and return `status: "unhealthy"` when a
  running container's Docker healthcheck is failing instead of treating it as a
  successful deploy.
- Stopped GitHub repo discovery MCP responses from returning credentialed clone
  URLs; private repo credentials are now kept internal to clone time.
- Reduced infrastructure analyzer false positives by no longer treating generic
  ORM packages as PostgreSQL, and by reading Prisma datasource providers and
  `DATABASE_URL` schemes instead.
- Removed `postgresql://localhost` deploy-plan placeholders; planned or reused
  managed services now satisfy required env vars and inject real connection
  strings at execution time.
- Normalized MCP targeting for logs, stats, diagnostics, deploy history, build
  logs, host probes, action status, and managed-service status/credentials.
- Allowed deployable-service MCP actions to resolve `service_name` as the
  project group name when that group has exactly one deployable service.
- Extended the same single-deployable project-name fallback to deployable env
  variable actions.
- Added `deploy_id`/`job_id` lookup to `get_deploy_status` so completed deploys
  and unknown ids are distinguishable.
- Improved `diagnose_service` HTTP probes for apps mounted under a base path
  such as `NEXT_PUBLIC_BASE_PATH=/admin`.
- Accepted `health_check_path` as an alias for `diagnose_service.path`.
- Added machine-readable MCP composite action contracts in `help` and
  `INVALID_PARAMS` responses, and made new app naming use the explicit `name`
  parameter instead of silently accepting `project_name`.
- Fixed managed-service backups in Docker installs by writing backup archives
  through the shared OpenLander data volume instead of a container-local path.
- Kept deployable app/worker services out of managed-service MCP responses and
  return explicit guidance when a managed-service action receives one.
- Increased Docker disk-usage timeout to avoid false cleanup preflight failures
  on slower hosts.
- `openlander_monitor.diagnose_service` now accepts `internal: true` and routes
  the HTTP probe through `docker exec` against the service container's own
  network namespace (using `container_port`). Previously the flag was silently
  dropped at the schema layer and the probe always hit the backend container's
  loopback, making the result useless for "is the app actually listening?"
  diagnostics.
- Clarified `openlander_monitor.probe_host` description so agents know
  `ol-svc-*` / `ol-{project}` internal Docker DNS names require `internal: true`
  to resolve — the backend cannot reach those from its own network namespace.
- Clean up stale Docker network endpoints for compose services before
  redeploying, after failed starts, and during rollback/stop so a failed compose
  deploy cannot wedge future deploys with `endpoint already exists in network`.
- Avoid reconnecting compose services to the shared `openlander` Docker network
  after they have already been attached with their DNS alias, fixing fresh
  compose deploys that failed with the same endpoint-conflict error.
- Show compose child services in project topology and service detail lists
  instead of showing only the compose parent metadata service.
- Classified MCP/tool-initiated deploys and redeploys as MCP activity instead
  of `human` in the Activity feed.
- Preserve Docker Compose service-name DNS aliases (for example `postgres` and
  `redis`) when OpenLander runs compose services through Dockerode.

## [0.1.1-rc.6] — 2026-05-13

### Fixed

- Preserved explicit MCP-provided database/cache env vars during deploy planning
  so external `DATABASE_URL`/`REDIS_URL`-style values do not trigger managed
  service provisioning or credential overwrite.
- Accepted MCP env var inputs as either objects or JSON-stringified objects for
  deploy planning and `set_env_vars`.
- Fixed managed service creation on fresh Postgres installs by ensuring the
  synthetic managed-service group exists before inserting service rows.
- Rolled back managed service containers and volumes if service persistence
  fails after Docker resources have already been created.
- Added a Linux `/proc/net/tcp{,6}` fallback for port scanning when `ss` is not
  installed.
- Surfaced deployable service identifiers in MCP `list_projects` output so
  agents can chain directly into `openlander_service` actions.
- Stored freshly created managed services with canonical `source='image'`.

## [0.1.1-rc.5] — 2026-05-13

Release candidate with onboarding and MCP token setup polish, plus the
post-rc.4 UI and CI follow-ups that were missed in the previous cut.

### Changed

- Moved language selection out of the setup wizard and into the login/account
  chrome so first boot focuses on account and MCP setup.
- Made MCP token issuance explicit during setup so users understand when a
  token is created and where to copy it.
- Tightened GitHub Actions concurrency and trigger scopes to reduce duplicate
  workflow runs.

### Fixed

- Straightened the `/login` to `/setup` handoff and clamped setup wizard steps
  to the live setup status.
- Added a development-loud SetupGuard fail-open path for easier local QA when
  setup state and route state drift.
- Aligned the Service Detail Domains tab with shared form and card primitives.

## [0.1.1-rc.4] — 2026-05-13

Release candidate with MCP diagnostic sanitization hardening and follow-up UI
polish for confirmation/setup surfaces.

### Fixed

- Hardened `openlander_monitor.diagnose_service` sanitization for additional
  secret-like tokens, including cloud-provider credentials in log tails and
  diagnostic errors.
- Aligned `ConfirmDialog` styling with the OpenLander dashboard visual system.
- Fixed the invisible Connect GitHub label in setup infrastructure chrome.

## [0.1.1-rc.3] — 2026-05-12

Release candidate with MCP deploy action vocabulary cleanup and token
confirmation-dialog polish.

### Changed

- **Breaking (MCP):** renamed `openlander_deploy.deploy` to
  `openlander_deploy.deploy_app` and `openlander_service.deploy_service` to
  `openlander_service.redeploy_app`. `create_service` remains the managed
  infrastructure action for databases, caches, and storage.

### Fixed

- Replaced the browser-native token regeneration confirmation with the
  OpenLander `ConfirmDialog` so the token flow stays inside the dashboard UI.

## [0.1.1-rc.2] — 2026-05-12

Release candidate with MCP diagnostics and post-rc.1 UI copy hardening.

### Added

- `openlander_monitor.diagnose_service`, a read-only MCP diagnostic action for
  deployable services. It returns masked env key inventory, build-time env
  warnings, sanitized recent deploy/build log tails, sanitized runtime logs,
  container status, HTTP probe results, dependency probes, and suggested next
  actions.
- `deploy_service` now returns a concrete `diagnostic_call` pointing to
  `openlander_monitor.diagnose_service` for agents to use when an async redeploy
  fails or times out.

### Changed

- `openlander_deploy.deploy` guidance now more clearly distinguishes new app
  creation from existing service redeploys and points agents to
  `openlander_service.deploy_service` with a concrete service id when possible.
- Korean/English UI copy sweeps were completed across remaining navigation,
  timeline/logs, Git provider/OAuth, resources, add-service, service-delete, and
  project chrome surfaces.

### Fixed

- MCP service diagnostics scrub credentialed URLs and common secret-like
  assignments from diagnostic log tails and probe errors.
- The add-service template `Soon` label is localized in Korean.

## [0.1.1-rc.1] — 2026-05-12

Release candidate for the first 0.1 patch line. This RC focuses on custom
domain routing, MCP/onboarding polish, release automation hardening, and public
repository safety checks.

### Added

- Service-level custom domain management with database-backed mappings, path
  prefixes, optional upstream prefixes, target-port overrides, and dynamic
  Traefik config generation.
- Domains tab UI for service detail pages, including add/delete flows and
  advanced path/port controls.
- Multi-vendor MCP client setup tabs and a clearer Your Agent surface.
- Account popover language switching for Korean/English.
- Public release secret scanning with gitleaks and documented branch-naming
  policy.

### Changed

- Release publishing now supports release candidates without moving `latest`;
  prerelease tags publish immutable version images plus the moving prerelease
  channel tag.
- CI workflows were throttled to reduce duplicate release-gate and scan runs.
- Korean and English UI copy was swept across setup, navigation, project,
  service, Web Server, MCP, and account surfaces.
- Raw `npm run release` is guarded; maintainers must explicitly choose
  `npm run release:rc` or `npm run release:final`.

### Fixed

- Custom domain routing now resolves by service id rather than project id, which
  keeps multi-service project routing correct.
- v0.1 baseline migration guards now fail fast on incompatible pre-public
  dogfood databases and are covered by integration tests.
- Setup password minimum was lowered to eight characters.

## [0.1.0] — 2026-05-09

First public release.

OpenLander is a self-hosted deployment platform: paste a Git URL, get a deploy. The 0.1 release is MCP-first: Claude Code, Cursor, Codex, OpenCode, and other external agents can inspect logs/status and call deploy/service/config actions through the MCP server.

This is an early release — expect breaking changes between 0.x versions. Production use is supported but configurations and APIs may evolve based on user feedback.

### Architecture

- **Platform metadata: PostgreSQL via Docker Compose.** OpenLander now ships with a managed `postgres:16-alpine` container alongside the application; the previous embedded SQLite (`better-sqlite3`) datastore has been removed. The recommended self-hosted runtime is `docker compose up`; the npm CLI path is supported for development with a user-provided `OPENLANDER_DATABASE_URL`. Aligns with industry pattern (Coolify, Dokploy).
- **Project = group, Service = deployable.** Repository, image, build, and runtime actions are now owned by services. Projects are workspace groups only.

### Removed

- **Breaking:** removed project-level runtime MCP actions: `stop_project`, `start_project`, `restart_project`, `redeploy_project`, `rollback_project`, `archive_project`, `unarchive_project`, and `update_project_config`. Use `stop_service`, `start_service`, `restart_service`, `deploy_service`, `rollback_service`, `archive_service`, `unarchive_service`, and `update_service_config` instead.
- **Breaking:** project-level runtime HTTP routes now return `410 PROJECT_RUNTIME_ACTION_REMOVED`: `POST /api/projects/:id/start`, `/stop`, `/redeploy`, `/rollback`, and `/blue-green`. Use the canonical service runtime routes under `/api/projects/:projectId/services/:serviceId/*`.

### Highlights

**Deployment**

- Git → Docker → URL pipeline. Auto-detects ports, proxies, containers before deploying.
- Auto-Dockerfile for 28+ frameworks (Next.js, Express, NestJS, Vite, Nuxt, SvelteKit, Astro, FastAPI, Django, Flask, Rails, Spring Boot, Laravel, ASP.NET, Go, Rust, etc.) when no Dockerfile is present.
- Docker Compose support — multi-service projects via `docker-compose.yml`.
- Docker Compose host port mappings (`ports:`) are rejected before deployment;
  use `expose:`/container ports and OpenLander's Traefik routing instead.
- Monorepo support — scan multiple Dockerfiles, parallel builds, parent-child project model.
- Real-time build log streaming with ANSI color rendering.
- Blue-green redeploy with health check + one-click rollback.
- Per-project deploy locks prevent concurrent mutations.

**Web Dashboard**

- Project overview, deployments list, activity feed.
- Service detail with the v0.1 6-tab IA (Overview / Logs / Deployments / Monitoring / Environment / Domains).
- xterm.js web terminal for `docker exec` from the browser.
- MCP Server status page surfacing connected agents.
- Korean / English UI (toggle during onboarding).

**Built-in AI Ops**

- Built-in LLM provider setup, web-agent chat, token usage tracking, and automatic AI remediation are disabled in 0.1.
- Disabled AI endpoints return `410 FEATURE_DISABLED` instead of partially running.
- External MCP agents remain the supported automation path: read logs/status, decide what to change, and call explicit MCP actions.
- The internal AI Ops/recovery modules remain cold-storage code for a future product decision and are not started by the 0.1 runtime.

**MCP Integration**

- 64 unique default operations exposed through 5 composite MCP tools (`openlander_deploy`, `openlander_project`, `openlander_service`, `openlander_managed_service`, `openlander_monitor`) with an `action` parameter for sub-operations.
- 13 platform debugging tools available behind a config flag.
- Three transports: stdio (local), Streamable HTTP (`POST /mcp`), and SSE (`GET /mcp/sse`) for clients on the older standard.
- Bearer token auth on remote transports.

**Infrastructure**

- Postgres-backed OpenLander runtime with Docker Compose deployment and a
  dedicated persistent database volume.
- Traefik reverse proxy with auto-routing per project.
- Cloudflare Tunnel (production) and TryCloudflare (quick share) for public exposure.
- Managed services: PostgreSQL, MySQL, Redis, MongoDB, MinIO containers on demand.
- SSH key auth for private Git repos (GitHub, GitLab, Bitbucket, Gitea).
- Environment variables: project-scoped and global encrypted secrets.

**Authentication & Security**

- Password login with session cookies.
- Bearer token auth for remote MCP.
- SSRF hardening on git clone and outbound URL test surfaces.
- CSP, X-Frame-Options, Referrer-Policy, X-Content-Type-Options on every response.
- Pino logger redacts credential field names (`*.password`, `*.token`, `*.api_key`, etc.) at the stream layer.

### Known limitations

- Single-tenant only. Multi-user and role-based access control are not in scope.
- No built-in AI auto-recovery or web-agent chat in 0.1. Recovery decisions are explicit MCP/user actions, not background LLM automation.
- Korean localization for relative-time strings (`6d ago`) is incomplete; affects the activity feed.
- The `0.1.0` database schema is the first public Postgres baseline. Pre-public dogfood
  databases with older OpenLander migration histories are not upgraded in place; start from a
  fresh Postgres volume or manually export/import data.
- No log rotation, rate limiting, or LLM token spend cap. Recommended for single-developer / small-team use.
- Windows is not supported. WSL2 on Windows works.

### What's next

User feedback in the first 30 days drives 0.2.x priorities. Likely candidates: tighter MCP observability (per-tool counters), runtime metrics snapshot table, Operations Center / built-in AI Ops revival if there is demand, log rotation, rate limits.

---

Earlier internal pre-release history is intentionally not enumerated here. This is OpenLander's first public release.
