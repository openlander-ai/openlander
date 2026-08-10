# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.3.3-rc.8] - 2026-08-10

### Fixed

- Preserve protected-share action names in the Activity timeline so enabling,
  stopping, rotating the access code, and failed authentication remain
  distinguishable from generic configuration changes.

## [0.3.3-rc.7] - 2026-08-10

### Fixed

- Keep the documented EventBus event count synchronized with the protected
  share audit events added in the previous release candidate.
- Allowlist only the fixed, non-secret protected-share code alphabet so secret
  scanning continues to reject real credentials.

## [0.3.3-rc.6] - 2026-08-10

### Added

- Add a compact protected-share management list to Web Server settings with
  URL copy, access-code rotation, and stop-sharing actions for every public
  Application.
- Record protected-share lifecycle and failed authentication events in the
  Activity log without storing access codes or client IP addresses.

### Changed

- Show the active protected-share authentication policy in settings, including
  the attempt window, session lifetime, and code-rotation behavior.

### Security

- Deduplicate rate-limit Activity events so repeated blocked attempts cannot
  flood the audit log, while preserving individual invalid-code records.

## [0.3.3-rc.5] - 2026-08-07

### Fixed

- Let embedded browsers submit protected-share codes when they send an opaque
  form origin with same-origin Fetch Metadata, and redirect direct visits to
  the internal verification endpoint back to the share gate.

## [0.3.3-rc.4] - 2026-08-07

### Changed

- Align the protected-share access gate with OpenLander's light product design,
  clarify the shared Application and action, and connect validation errors to
  the access-code field for assistive technology.

## [0.3.3-rc.3] - 2026-08-07

### Fixed

- Let protected shares run behind an existing Caddy, Nginx, or other TLS
  terminator without competing for host port 443, restrict on-demand
  certificate issuance to active share hostnames, and preserve the mode across
  one-click updates.

## [0.3.3-rc.2] - 2026-08-07

### Fixed

- Defer protected-share HTTPS activation until the first Application is shared,
  report host port 443 conflicts clearly, and restore the HTTP-only proxy when
  activation fails.

## [0.3.3-rc.1] - 2026-08-07

### Added

- Add protected HTTPS sharing for individual Application services without a
  purchased domain, using an access-code gateway and service-scoped publish
  controls while keeping Cloudflare Connected Publish as an optional path.
- Add global and per-operation security controls for Project or service
  deletion, database access, environment secret access, and Docker cleanup so
  operators can start permissive and restrict sensitive actions when needed.

### Changed

- Apply the configured global operation policy to MCP Docker cleanup actions
  instead of requiring a separate approval-only workflow.

### Fixed

- Collect and persist the certificate contact email during the first protected
  share instead of requiring operators to preconfigure it in Web Server
  settings.

## [0.3.2] - 2026-08-05

### Fixed

- Load the Cloudflare OAuth callback logic from a same-origin external script,
  so the callback can complete authorization without weakening OpenLander's
  Content Security Policy.

## [0.3.1] - 2026-08-05

### Fixed

- Complete Cloudflare OAuth inside the fixed callback page before notifying the
  opener, so authorization still finishes when the original OpenLander tab is
  unavailable or no longer listening for the callback.
- Reconnect an existing Connected Publish configuration during OAuth completion
  and show an explicit result with a return action when the popup cannot hand
  control back automatically.

## [0.3.0] - 2026-08-05

### Added

- Add Cloudflare OAuth with PKCE, account/Zone selection, one remotely managed
  Named Tunnel per OpenLander instance, and a hardened pinned `cloudflared`
  connector container.
- Add Connected Publish for one representative HTTP Application per Project,
  with a stable HTTPS hostname, DNS conflict protection, durable status, and
  restart reconciliation.
- Add compact dashboard controls to connect Cloudflare, publish a Project,
  open or copy its URL, and stop publication while retaining the hostname for
  republish.
- Add REST and MCP status contracts for publishing, polling, and unpublishing,
  including scoped-token enforcement for mixed target selectors.
- Add a Docker-host `openlanderctl admin reset-password` recovery command with
  hidden terminal input and automatic invalidation of existing web sessions.

### Changed

- Make publication an explicit post-deploy action. Deploy and redeploy no
  longer create a temporary Quick Tunnel from `expose=true` or legacy
  quick-share visibility.
- Route Connected Publish through managed Traefik so a Project can expose an
  Nginx static site, SPA, or full-stack HTTP framework without framework-specific
  deployment behavior.
- Preserve the Connected Publish token volume and selected Zone across official
  one-click updates so the Named Tunnel and reserved Project URLs survive an
  OpenLander container replacement.

### Fixed

- Recreate a stopped OpenLander-owned `cloudflared` connector, persist
  connection failures, and show an inline Repair or Reconnect action instead of
  presenting a degraded connection as healthy.
- Clear Cloudflare's tracked connector connections before deleting an
  OpenLander-owned Named Tunnel, so a confirmed disconnect completes without
  waiting several minutes for stale connections to expire.
- Include Docker Compose in source-built runtime images as well as release
  runtime images, keeping the next one-click update available after a local
  source build.

### Removed

- Remove TryCloudflare Quick Tunnel runtime code, access-code sharing, and the
  promise of automatic publication during deployment.

## [0.2.15-rc.4] - 2026-07-31

### Fixed

- Complete finite MCP HTTP tool calls with JSON responses so reverse proxies do
  not leave clients waiting on an open SSE response, while preserving the SSE
  GET channel for server notifications.

## [0.2.15-rc.3] - 2026-07-31

### Fixed

- Block one-click updates when either the container root filesystem or the
  OpenLander data filesystem is below the free-space threshold, and show the
  measured capacity in the update dialog.
- Resolve completed multi-service deploy readiness from the exact
  representative service without falling back to a stale canonical container.
- Offer the latest release after completed, failed, or rolled-back update
  operations instead of resubmitting an obsolete target version.

## [0.2.15-rc.2] - 2026-07-31

### Changed

- Keep the sidebar update affordance hidden when OpenLander is current, and
  present available updates on a white surface with signature-color emphasis
  and a neutral target-version label.

## [0.2.15-rc.1] - 2026-07-31

### Added

- Add a configurable, collision-checked Project network pool with explicit
  `/24` allocation, deployment preflight, and capacity reporting through
  `list_docker_networks`.

### Changed

- Refresh release metadata every 30 minutes, retry stale checks sooner, and
  keep a manual update check visible with the last successful check time.
- Preserve existing Docker networks while allocating only new
  OpenLander-managed networks from `docker.projectNetworkPoolCidr`.

### Fixed

- Count Docker network endpoints from all running and stopped container
  attachments when Docker omits endpoint details from its network list.
- Avoid suggesting active networks as cleanup candidates, and reject exhausted
  Project network pools before an image build or pull begins.
- Restore the missing English and Korean Compose environment preflight labels.

## [0.2.14] - 2026-07-31

### Added

- Add approval-gated Stateful Compose updates and removals with immutable
  source fingerprints, consistent Docker volume backups, rollback, archive,
  and unarchive support.
- Add MCP-managed Application memory profiles and clearer failed initial
  deployment records in the web interface.
- Add an administrator-confirmed update button and bilingual progress dialog
  for newer Stable or RC releases, with manual guidance for unsupported
  installation methods.
- Add official release-manifest validation, Compose installation preflight,
  PostgreSQL and configuration backups, exact GHCR digest pulls, post-restart
  health and Traefik verification, and automatic image/configuration rollback.

### Changed

- Isolate Compose environment variables per service, expand YAML merge keys,
  and validate PostgreSQL 17 and 18 data-volume contracts before creating
  managed resources.
- Support Compose workloads and multiple Dockerfile Applications in existing
  Projects, including explicit Dockerfile selection and conflict detection.
- Preserve full Dockerfile, Compose, and migration build output while exposing
  live build steps and runtime-based dependency diagnostics.
- Include Docker Compose in the runtime image, publish a verified
  `openlander-update.json` asset with every multi-architecture release, and
  exercise authenticated RC-to-RC updates in the release gate.

### Fixed

- Keep stable internal DNS aliases attached across blue-green replacements and
  preserve build context and Application environment variables when attaching
  workloads to an existing Project.
- Handle monorepo root build contexts and relative web API URLs without unsafe
  URL or build-path inference.
- Avoid false port and dependency diagnoses from process IDs or stale stored
  environment values, and serialize backup creation timestamps correctly.
- Archive terminal Compose workloads even when stale `building` markers remain,
  while durable deploy locks and active jobs continue to block unsafe cleanup.
- Preserve Stateful Compose containers, volumes, selected service subsets, and
  independent child archive markers across update, archive, and restore flows.
- Finalize tracked Compose child jobs on early failures so stale `queued`
  records cannot block later lifecycle operations.
- Preserve official Compose credentials, ports, hosts, volumes, exact images,
  file ownership, and permissions across one-click updates and rollback.
- Retry GitHub Deploy Key clones and verification over SSH port 443 after
  transient failures on networks where port 22 is unavailable.
- Decode BuildKit v2 progress for Dockerfile and Compose builds, retain complete
  child and parent build output, and keep recent steps visible through startup.

## [0.2.13-rc.7] - 2026-07-30

### Fixed

- Recreate the exact legacy OpenLander-managed Traefik container with the
  current instance label while preserving isolation from foreign instances.
- Fail deployment when managed Traefik cannot join the Project network or its
  public route remains on a 5xx response after the workload becomes healthy.

## [0.2.13-rc.6] - 2026-07-29

### Added

- Add a ready-to-paste Codex MCP configuration to onboarding and the shared
  Agent setup surface, with the active instance name, endpoint, and token.

## [0.2.13-rc.5] - 2026-07-29

### Fixed

- Describe MCP inputs with defaults as optional in scoped help while preserving
  strict rejection of unknown parameters.

## [0.2.13-rc.4] - 2026-07-29

### Added

- Add durable Project Updates for meeting notes, decisions, questions,
  dependencies, risks, progress, and source references before a Delivery is
  planned.
- Expose compact Project context and update detail operations to external
  Agents, and let Deliveries preserve the exact Project items used for
  planning.

### Changed

- Add form-free Project context and Delivery source-context views, and include
  durable Project Updates in internal weekly reports without exposing internal
  paths or details to customer reports.

### Fixed

- Restrict release QA Docker cleanup to containers carrying the exact connected
  OpenLander instance label so sibling and legacy instances remain untouched.

## [0.2.13-rc.3] - 2026-07-29

### Changed

- Keep default MCP composite help compact, while allowing Agents to request one
  action contract or all verbose schemas only when needed.
- Present one current customer-review package separately from its included file
  count, internal evidence, and earlier customer files in the Delivery workspace.

### Fixed

- Return an executable review-package publish recommendation with its stable
  idempotency key and issue upload capabilities for the active MCP transport
  origin.
- Report declared and detected PNG, JPEG, or WebP MIME types when an upload is
  rejected so Agents can correct and resume the failed file directly.
- Mark published package files as awaiting review instead of draft, and keep
  legacy customer files in history while a package-bound Review Gate is current.

## [0.2.13-rc.2] - 2026-07-29

### Added

- Add resumable customer-review packages that stage one required PDF and
  optional HTML or representative image files, publish them atomically, and
  bind the exact package manifest SHA-256 to human approval.
- Expose review-package prepare, status, resume, and publish workflows through
  the shared Application Operation Registry, REST API, and
  `openlander_project` MCP composite.

### Changed

- Make high-level package operations the default FDE review path so Agents no
  longer need to assign low-level Artifact keys, receipt ordering, revisions,
  or companion relationships.
- Surface the MCP evidence-upload ticket flow earlier in Agent guidance and
  show one customer-review package card in the formless Delivery workspace.

### Fixed

- Keep partial uploads out of Delivery artifacts and Review Gates, allow failed
  items to resume with fresh short-lived capabilities, and preserve published
  review evidence until the replacement package is published.
- Narrow customer-review package loading explicitly so clean Web TypeScript
  builds reject no valid nullable state.

## [0.2.13-rc.1] - 2026-07-28

### Added

- Add an exact customer-review checkpoint that binds approval or revision
  requests to one immutable Artifact revision and SHA-256 through the shared
  Application Operation, REST, and MCP interfaces.
- Allow an Agent to register an existing Project repository without starting a
  deployment, so Delivery planning can begin from the repository already in
  use.

### Changed

- Keep Review Gates that have no automated checks pending until their required
  human evidence is recorded, and direct the Delivery workspace to the one
  review action that currently needs attention.
- Show current customer shareables before internal QA evidence, collapse prior
  and duplicate Artifact records by default, and keep the full immutable history
  available for audit.

### Fixed

- Keep weekly Engagement reports aligned with unresolved Project updates and
  route customer-review attention to the exact Review Gate instead of a generic
  Artifact action.

## [0.2.12] - 2026-07-27

### Added

- Add the repository-owned FDE Delivery manifest and release contract that
  exercises Agent planning, quality checks, handoff, immutable Release
  Promotion, weekly reporting, and Completion Evidence.
- Add Agent-facing Docker network inventory and approval-gated removal of an
  exact unused OpenLander network through the shared operation interfaces.

### Changed

- Show only the latest Promotion result for each Environment in customer weekly
  reports, while preserving the full attempt history in internal evidence.

### Fixed

- Retry transient Promotion Smoke failures within the configured deadline,
  limit each individual probe, fail permanent HTTP errors immediately, and
  retain useful connection diagnostics.
- Hold candidate port reservations until Promotion commit or cleanup so
  concurrent Promotions cannot reuse a port before runtime state is persisted.
- Keep Docker address-pool recovery scoped to an exact unused OpenLander
  network and reject active, shared, external, system, and other-instance
  networks.

## [0.2.12-rc.2] - 2026-07-27

### Fixed

- Retry transient Release Promotion Smoke failures within the configured
  timeout, cap each request so one hung connection cannot consume the full
  window, fail permanent HTTP errors immediately, and preserve the underlying
  connection error in diagnostics.
- Keep candidate port reservations until Promotion commit or failure cleanup so
  concurrent Promotions cannot select the same port before runtime state is
  persisted.

## [0.2.12-rc.1] - 2026-07-27

### Added

- Add a repository-owned Delivery manifest for OpenLander dogfood with explicit
  unit, localization, type, release, and Agent golden-path quality checks.
- Add Agent-facing Docker network inventory and approval-gated removal of an
  exact zero-endpoint network through the shared Application Operation Registry,
  REST, and the `openlander_monitor` MCP composite.

### Changed

- Extend the release suite to enforce the complete external Agent FDE path,
  including a failed check and retry, handoff and resume, build-once promotion,
  weekly reporting, and immutable completion evidence.

### Fixed

- Allow operators to recover exhausted Docker address pools without exposing
  general network deletion: system, shared, external, active, non-local, and
  other-instance networks remain blocked, while legacy `ol-*` networks require
  an explicit opt-in and human approval.

## [0.2.11] - 2026-07-27

### Added

- Add an internal FDE Engagement Portfolio above Projects with one-Engagement-
  per-Project membership, batched runtime and Delivery blocker rollups,
  archive-safe links, and organization-scoped MCP reads.
- Add the Delivery Workspace for review artifacts, customer feedback, decisions,
  approvals, external QA and Data Gates, Production evidence, and immutable
  Receipt PDFs.
- Add content-addressed artifact storage with streaming validation, 100 MiB
  limits, isolated HTML downloads, approved companion-PDF merging, Korean font
  support, Project Receipt themes, and a 250-page finalization gate.
- Add external Agent operations for Engagement and Delivery lifecycle while
  keeping binary uploads on authenticated Web/CI APIs and required human
  approval evidence explicit.
- Bind final Receipt confirmation to the exact evidence version that produced
  the latest preview, with durable Gate idempotency records that preserve newer
  results across CI retries.
- Add a versioned Application Operation Registry shared by MCP and REST,
  including actor scope, idempotency, asynchronous status, and machine-readable
  error contracts.
- Add manifest-driven Agent Delivery runs with resumable handoffs, quality
  checks, evidence uploads, automatic Gate evaluation, and immutable completion
  evidence.
- Add build-once Releases with digest-preserving promotion across Project
  environments, health and smoke evaluation, recall, and rollback.
- Add Project manifest snapshots and drift inspection, Engagement lifecycle and
  Project-link operations, and internal/customer weekly reports generated from
  the same evidence snapshot.
- Add Engagement and Delivery observation surfaces with runtime, blocker,
  progress, evidence, and optional Engagement context across Project views.
- Add an ephemeral RC quality gate that verifies the full external Agent FDE
  path through failure, fix, handoff, promotion, reporting, and immutable
  completion evidence.

### Changed

- Shift the primary Web workflow toward formless observation of manifests,
  Agent progress, checks, evidence, promotions, and reports while keeping
  approvals and operational exception actions available.
- Refine Korean product language for developer and FDE audiences while
  preserving familiar technical terms where translation would reduce clarity.
- Keep existing deploy and Delivery operations available through compatibility
  wrappers while routing new Agent workflows through shared application
  operations.
- Polish Korean Agent execution phases and weekly report evidence while keeping
  familiar developer and FDE terminology where translation improves clarity.

### Fixed

- Isolate Docker containers and networks by OpenLander instance, keep automatic
  cleanup audit-only for unowned resources, and return typed address-pool
  failures without leaving partial state.
- Remove all persisted service-environment containers and same-instance routing
  endpoints during explicit hard delete, and allow finalized Receipt records to
  cascade only with that explicit Project deletion.
- Serialize weekly report PDF rendering and provide coverage runners enough
  headroom for Korean font subsetting.
- Keep source-only environment variables advisory for Compose deploy plans so
  optional features, tests, and build tooling do not block an explicit runtime
  contract with unrelated input requests.
- Preserve a saved or explicitly supplied image command when starting a
  blue-green candidate container, so image services do not fall back to the
  image's default command during an update.
- Copy manifest quality workspaces into disposable runners through the Docker
  API so host filesystem paths are never assumed inside the runtime container.
- Normalize generated image tags and probe promoted service health from the
  target container runtime, preserving digest-based promotion across
  environments.
- Keep implicit compatibility Delivery and Release records out of customer
  reports, and avoid repeating equivalent Agent status and phase labels.

## [0.2.10] - 2026-07-24

### Fixed

- Treat successful one-shot Compose jobs as completed in passive health
  monitoring and resolve historical `service_down` false positives for jobs.
- Keep deployment-time representative traffic failures available as history
  without allowing them to override healthy live diagnostics.

## [0.2.9] - 2026-07-20

### Fixed

- Exclude generated and custom OpenLander routes from external dependency
  diagnosis and resolve stale pending input for those managed endpoints.
- Confirm transient HTTP and HTTPS dependency network failures with repeated
  service-network probes before creating a high-confidence diagnosis or pending
  user input, while preserving HTTP status evidence and single-attempt TCP checks.

## [0.2.8] - 2026-07-20

### Changed

- Extend the existing service configuration action with saved Compose file,
  profile, service, traffic-target, and environment selection.
- Rebuild Compose applications when the checked-out source revision changes or
  a no-cache redeploy is requested, while preserving stateful resources.
- Probe application containers with curl, wget, or the Node.js HTTP client so
  diagnostics do not depend on a single command being installed.

### Fixed

- Route Compose child redeploys through the parent-owned runtime while keeping
  the selected replacement target, representative traffic child, and terminal
  deployment status consistent across Web, REST, and MCP.
- Preserve existing Compose child runtime state when cloning or building fails,
  retain detailed Docker build errors, and retry only transient image-build
  network failures.
- Remove children excluded by the active Compose selection and resolve the
  latest compatible revision across environment-scoped and legacy deploy logs.
- Retry transient GitHub API, HTTPS, and Deploy Key SSH transport failures while
  keeping deterministic authentication and repository errors fail-fast and
  credentials redacted.
- Close detached stdio MCP sessions on EOF or process termination so monitors,
  database pools, and other runtime resources are released exactly once.
- Diagnose a Compose parent through its persisted representative traffic child
  and aggregate runtime status, avoiding false container and route failures for
  the intentionally containerless parent.
- Run HTTP and HTTPS dependency probes from the diagnosed service network so
  Compose DNS names resolve correctly, while keeping HTTP response failures
  distinct from network-unreachable errors.

## [0.2.7] - 2026-07-19

### Fixed

- Derive Compose Project status from active runtime children instead of the
  intentionally portless parent, while treating successful one-shot jobs as
  completed.
- Expand Compose parents into child services in REST and MCP topology views so
  application, job, and resource health matches the actual containers.
- Exclude Compose resources and one-shot jobs from generated and custom HTTP
  routes while preserving application routing and Project UI status.
- Align MCP Project and Compose parent workload status with the active child
  runtime aggregate, including route-health summaries, so healthy stacks no
  longer report a stale stopped warning.
- Fall back to the published host port when an application image lacks HTTP
  probe tools, avoiding false unhealthy diagnostics while preserving real
  connectivity and port-mismatch failures.

## [0.2.6] - 2026-07-19

### Added

- Add persistent Compose runtime roles for applications, one-shot jobs, and
  infrastructure resources, including additive migration and legacy backfill.
- Add explicit Compose traffic-service selection with automatic resolution for
  a single exposed application and guided input when multiple candidates exist.
- Add audited, no-store service credential reveal for authenticated Web users
  while keeping scoped MCP credential reads project-bound.
- Add opt-in Compose child observability to the Project services API, including
  runtime role, lifecycle, health strategy, traffic target, and latest deploy.
- Show Compose applications, jobs, and resources as individual Project rows
  with role-aware status, traffic, recent deploy, log, and diagnostic links.
- Add a shared aggregate status for Compose parents that treats successful
  one-shot jobs as complete instead of degraded.
- Add explicit Compose file, profile, service, traffic-target, and environment
  fields to deploy plans and persist them in versioned deployment snapshots.
- Add normalized per-service fingerprints so selective redeploys can detect
  changed applications without storing environment or secret plaintext.

### Changed

- Diagnose Compose applications with HTTP and routing checks, resources with
  Docker health or TCP checks, and jobs with exit-code and log evidence.
- Run resource and job containers without host ports or Traefik routes, and
  treat a one-shot job exit code of zero as successful completion.
- Use the selected child application for Compose representative URLs and
  readiness probes instead of probing the portless aggregate parent.
- Record deploy logs for individual Compose children so Project and service
  views can connect each runtime to its latest deployment and logs.
- Extend MCP topology and diagnostics with runtime role, lifecycle, health
  strategy, traffic-target, and aggregate-status metadata.
- Make `restart_service` restart the existing long-running Docker container in
  place without cloning, building, removing, or replacing it.
- Keep Compose child detail screens observation-only and hide HTTP/domain
  controls that do not apply to resources or one-shot jobs.
- Split Compose execution into replacement targets, reusable prerequisites,
  and one-shot release hooks instead of recreating the dependency closure.
- Reuse healthy dependency containers, start stopped prerequisites in place,
  and replace only explicitly selected or changed stateless applications.
- Build replacement application images before running successful-completion
  hooks, then replace the application only after its migration job succeeds.

### Fixed

- Scope Platform database inspection to the requested project, reject scoped
  tokens for instance-wide debug access, and remove credentials, environment
  values, secrets, logs, and sensitive deploy configuration from safe DTOs.
- Remove credential and environment plaintext from normal service HTTP and MCP
  responses while preserving explicit, audited credential reveal operations.
- Distinguish retryable DNS, timeout, network, reset, endpoint, and clone-process
  timeout failures from Git authentication errors, with credentials redacted.
- Preserve Compose child container names and internal ports in representative
  traffic and role-aware diagnostic regression coverage.
- Persist Compose child deployment logs against each child's canonical service
  ID so successful multi-service deploys do not fail during log recording.
- Preserve the container ID during runtime restart, reject one-shot job
  restarts, and enforce mutation policy, deploy locking, and state validation.
- Allow logs from stopped one-shot job containers and direct child detail pages
  to child-scoped deployment history instead of aggregate parent history.
- Return Compose children from the opt-in Project services endpoint while
  preserving the parent-only default and excluding managed resources.
- Preserve unchanged database and other stateful resource containers, volumes,
  routes, ports, and domains across selective and full-force redeploys.
- Block automatic stateful service definition changes and removals with typed
  errors instead of deleting or recreating resource containers.
- Keep the existing API container and route active when migration fails, times
  out, or image preparation fails, while retaining failure evidence.
- Reject unhealthy Compose prerequisites before touching requested application
  containers and report `COMPOSE_PREREQUISITE_UNHEALTHY` consistently.
- Support ordered base-to-overlay Compose file sets in deploy plans, snapshots,
  and redeploy execution while preserving the single-file contract.
- Apply Compose `!reset` tags when merging production overlays and infer an
  application's internal port when published ports are removed.
- Parse and sanitize serialized deployment snapshots before returning them from
  `platform_db_inspect`, omitting malformed configuration instead of raw data.
- Synchronize roles, ports, container names, and health strategies for existing
  Compose children excluded from a selective deployment.
- Resolve persisted traffic-target metadata consistently across REST and MCP,
  including when the selected deploy target is a different application.
- Normalize canonical Compose child names before stateful safety comparisons so
  unchanged resources are not mistaken for removed services.
- Support repository-relative Compose file mounts for migration jobs through
  Docker API copy-before-start while rejecting symlinks outside the repository.
- Prevent backend release tests from opening an external `example.com` browser
  tab by mocking the OAuth browser opener.

## [0.2.6-rc.9] - 2026-07-19

### Fixed

- Support repository-relative Compose file mounts for one-shot migration jobs
  by copying files through the Docker API before container startup.
- Reject relative bind symlinks that resolve outside the cloned repository.

## [0.2.6-rc.8] - 2026-07-19

### Fixed

- Preserve the project-level representative traffic service when selectively
  deploying a different Compose application, such as API plus migration hooks.

## [0.2.6-rc.7] - 2026-07-19

### Fixed

- Normalize canonical Compose child service names before stateful safety
  comparisons so an unchanged resource is not mistaken for a removed service.

## [0.2.6-rc.6] - 2026-07-19

### Fixed

- Synchronize Compose child roles, internal ports, container names, and health
  strategies from the active specification even when a selective deploy does
  not restart that child.
- Resolve REST and MCP traffic-target metadata from the persisted Compose
  traffic service when multiple applications expose ports.
- Preserve stateful change and removal guards for legacy Compose resource rows
  whose stored runtime role has not yet been reclassified.

## [0.2.6-rc.5] - 2026-07-19

### Fixed

- Classify timed-out Git clone child processes as retryable
  `GIT_NETWORK_UNREACHABLE` failures instead of incorrectly reporting a Deploy
  Key authorization error.

## [0.2.6-rc.4] - 2026-07-19

### Fixed

- Return Compose child services from the opt-in Project services endpoint while
  preserving the parent-only default response and excluding managed resources.
- Mock the OAuth browser opener in backend tests so release QA no longer opens
  an external `example.com` tab on the developer machine.

## [0.2.6-rc.3] - 2026-07-19

### Fixed

- Parse and sanitize serialized deployment snapshots before returning them from
  `platform_db_inspect`, preventing nested Deploy Key paths, Git credential
  identifiers, environment values, and repository URL userinfo from bypassing
  the platform debug DTO redaction boundary.
- Omit malformed serialized deployment configuration instead of returning its
  raw contents.

## [0.2.6-rc.2] - 2026-07-19

### Fixed

- Support ordered base-to-overlay Compose file sets in deploy plans, snapshots,
  and redeploy execution while preserving the existing single-file contract.
- Apply Compose `!reset` tags when merging production overlays so reset build
  definitions and published ports are not treated as literal configuration.
- Infer an application's internal port from its localhost healthcheck when a
  production overlay removes published ports, without restoring source host
  port bindings.

## [0.2.6-rc.1] - 2026-07-19

### Added

- Add explicit Compose file, profile, service, traffic-target, and environment
  fields to deploy plans and persist them in versioned deployment snapshots.
- Add normalized per-service fingerprints so selective redeploys can detect
  changed applications without storing environment or secret plaintext.

### Changed

- Split Compose execution into replacement targets, reusable prerequisites,
  and one-shot release hooks instead of recreating the dependency closure.
- Reuse healthy dependency containers, start stopped prerequisites in place,
  and replace only explicitly selected or changed stateless applications.
- Build replacement application images before running successful-completion
  hooks, then replace the application only after its migration job succeeds.

### Fixed

- Preserve unchanged database and other stateful resource containers, volumes,
  routes, ports, and domains across selective and full-force redeploys.
- Block automatic stateful service definition changes and removals with typed
  errors instead of deleting or recreating resource containers.
- Keep the existing API container and route active when migration fails, times
  out, or image preparation fails, while retaining the failed job container
  and exit-code evidence for diagnostics.
- Reject unhealthy Compose prerequisites before touching requested application
  containers and report `COMPOSE_PREREQUISITE_UNHEALTHY` consistently.

## [0.2.5-rc.2] - 2026-07-19

### Added

- Add opt-in Compose child observability to the Project services API, including
  runtime role, lifecycle, health strategy, traffic target, and latest deploy.
- Show Compose applications, jobs, and resources as individual Project rows
  with role-aware status, traffic, recent deploy, log, and diagnostic links.
- Add a shared aggregate status for Compose parents that treats successful
  one-shot jobs as complete instead of degraded.

### Changed

- Record deploy logs for individual Compose children so Project and service
  views can connect each runtime to its latest deployment and logs.
- Extend MCP topology and diagnostics with runtime role, lifecycle, health
  strategy, traffic-target, and aggregate-status metadata.
- Make `restart_service` restart the existing long-running Docker container in
  place without cloning, building, removing, or replacing it.
- Keep Compose child detail screens observation-only and hide HTTP/domain
  controls that do not apply to resources or one-shot jobs.

### Fixed

- Persist Compose child deployment logs against each child's canonical service
  ID so successful multi-service deploys do not fail during log recording.
- Preserve the container ID during runtime restart, reject one-shot job
  restarts, and enforce mutation policy, deploy locking, and post-restart state
  validation at the pipeline boundary.
- Allow logs from stopped one-shot job containers and direct child detail pages
  to child-scoped deployment history instead of aggregate parent history.
- Point missing-container recovery guidance to an explicit force update because
  runtime restart cannot recreate a missing container.

## [0.2.4-rc.1] - 2026-07-19

### Added

- Add persistent Compose runtime roles for applications, one-shot jobs, and
  infrastructure resources, including additive migration and legacy backfill.
- Add explicit Compose traffic-service selection with automatic resolution for
  a single exposed application and guided input when multiple candidates exist.
- Add audited, no-store service credential reveal for authenticated Web users
  while keeping scoped MCP credential reads project-bound.

### Changed

- Diagnose Compose applications with HTTP and routing checks, resources with
  Docker health or TCP checks, and jobs with exit-code and log evidence.
- Run resource and job containers without host ports or Traefik routes, and
  treat a one-shot job exit code of zero as successful completion.
- Use the selected child application for Compose representative URLs and
  readiness probes instead of probing the portless aggregate parent.

### Fixed

- Scope Platform database inspection to the requested project, reject scoped
  tokens for instance-wide debug access, and remove credentials, environment
  values, secrets, logs, and sensitive deploy configuration from safe DTOs.
- Remove credential and environment plaintext from normal service HTTP and MCP
  responses while preserving explicit, audited credential reveal operations.
- Distinguish retryable DNS, timeout, network, reset, and endpoint connectivity
  failures from Git authentication errors across Deploy Key, SSH, OAuth, and
  PAT clone paths, with repository credentials and tokens redacted.
- Preserve Compose child container names and internal ports in representative
  traffic and role-aware diagnostic regression coverage.

## [0.2.3] - 2026-07-18

### Added

- Add encrypted, repository-scoped GitHub Deploy Key credentials with strict
  host-key verification, service bindings, sanitized HTTP and MCP management
  actions, and in-use deletion protection.
- Add the Repository Keys settings experience, guided GitHub key setup,
  verification recovery, and source-credential selection for Applications.
- Add production-like Compose stack imports with transitive service selection,
  dependency conditions, interpolation, env files, persistent volumes, bind
  snapshots, resource limits, readiness windows, and multiple published ports.
- Add a reproducible release gate for in-place upgrades that verifies password,
  API token, and database state preservation before the full cold-agent smoke.

### Changed

- Prefer connected GitHub OAuth or PAT credentials for HTTPS repositories,
  while keeping explicit SSH URLs and repository Deploy Keys intentional.
- Search all repositories accessible to the authenticated GitHub user,
  including collaborator and organization repositories, with bounded results.
- Update production AI SDK and Hono dependencies plus the development lint,
  formatting, TypeScript, Vitest, and Node type toolchain.

### Fixed

- Preserve structured GitHub access failures across repository search, deploy
  planning, HTTP, and MCP boundaries, including SSO and rate-limit guidance.
- Fall back to anonymous cloning for public repositories when provider access
  is unavailable, without turning transient GitHub API failures into blockers.
- Keep existing credentials during failed re-authorization, return successful
  GitHub setup to the canonical Git Providers page, and redact credentials from
  clone errors and build logs.
- Disable OpenSSH IP QoS for repository Deploy Key verification and cloning to
  avoid connection timeouts behind Docker and NAT paths.
- Skip managed Database or Cache env injection for dependencies supplied by a
  Compose stack.
- Build Compose service images with BuildKit so modern Dockerfile features such
  as cache mounts work during deployment.
- Persist Compose child container names and internal ports after deployment so
  the HTTP provider can generate working routes for multi-service stacks.
- Skip health probes for aggregate Compose parent records so child monitoring
  cannot incorrectly overwrite the stack deployment status.

## [0.2.2] - 2026-07-05

### Changed

- Clarify Project Data Access read-state copy and Activity affordances so
  agent read access is easier to audit.

### Fixed

- Preserve existing runtime Docker network aliases while adding canonical
  attached-service aliases during service network reconciliation.
- Pass Data Inspector SQL through Docker exec stdin so shell-sensitive query
  text is not mangled.

## [0.2.1] - 2026-07-04

### Added

- Add Project-aware read-only Data Inspector MCP actions for managed Postgres
  and Redis, with bounded query execution, reader roles, Redis allowlists,
  result caps, timeouts, and activity audit metadata.
- Add Project Settings Data Access opt-in UI and `data_source_access`
  persistence for agent read access.

### Changed

- Improve Data Access and AI Ops UX copy, empty states, read-access indicators,
  Activity filtering, and audit readability.
- Improve `recovery_receipt` readability for agent-primary verification with
  compact action and check summary fields.
- Update runtime dependencies, development tooling, and GitHub workflow
  versions.

### Fixed

- Preserve the owner project Docker network for attached services during
  redeploy, same-image runtime recreate, and blue-green candidate startup.
- Make oversized Postgres Data Inspector reads fail closed with
  `DATA_RESULT_TOO_LARGE`, and block Postgres `set_config()` queries before
  execution.
- Add feature-specific AI Ops briefing provider status to `/health`.
- Pass the AI Ops briefing system prompt through the AI SDK `system` option.

### Tests

- Pin the Data Inspector reader setup boundary so bounded Postgres reads and
  schema describe calls do not re-run reader role setup or admin grants.

## [0.2.1-rc.11] - 2026-07-04

### Fixed

- Preserve the owner project Docker network for attached services during
  redeploy, same-image runtime recreate, and blue-green candidate startup.

## [0.2.1-rc.10] - 2026-07-04

### Changed

- Clarify Data Access UX surfaces by showing a dedicated Activity empty state
  for data-read audits and read-only agent read-access indicators on Project
  Resources.

### Tests

- Pin the Data Inspector reader setup boundary so bounded Postgres reads and
  schema describe calls do not re-run reader role setup or admin grants.

## [0.2.1-rc.9] - 2026-07-04

### Changed

- Improve Project Data Access agent guidance, Redis authentication and database
  selection, and Activity audit readability while keeping query results out of
  persisted audit metadata.

## [0.2.1-rc.8] - 2026-07-04

### Changed

- Clarify the Project Data Access enable flow with explicit default-off copy,
  visible read-scope/credential/audit facts, and a confirmation dialog before
  enabling agent read access.

## [0.2.1-rc.7] - 2026-07-04

### Changed

- Clarify Home and Project AI Ops empty states when runtime health is degraded
  but no AI Ops briefing exists.
- Improve Project Data Access cards with managed/external source labels,
  health badges, read-access warning copy, and direct Activity audit links.
- Add a Data Access filter to the Activity timeline so agent data-read audit
  rows are easier to review.
- Fix the Home project card markup so service health chips are not nested
  inside another button.

## [0.2.1-rc.6] - 2026-07-03

### Changed

- Update runtime AI SDK, provider, Hono, Docker, and utility dependencies.
- Update development toolchain dependencies, including Playwright, Vitest
  coverage, Prettier, release-it, and typescript-eslint.
- Update GitHub workflows to use `actions/checkout@v7`.
- Document the `/health.aiOpsBriefing` release contract and fix the release
  process health verification endpoint.

## [0.2.1-rc.5] - 2026-07-03

### Fixed

- Add feature-specific AI Ops briefing provider status to `/health` so an
  `aiOpsBriefing` route can be reported independently from the dormant legacy
  LLM/agent status fields.

## [0.2.1-rc.4] - 2026-07-03

### Fixed

- Pass the AI Ops briefing system prompt through the AI SDK `system` option
  instead of a system-role message in `messages`, preserving the untrusted
  evidence guard while avoiding provider SDK warning paths.

## [0.2.1-rc.3] - 2026-07-03

### Fixed

- Make oversized Postgres Data Inspector reads fail closed with
  `DATA_RESULT_TOO_LARGE` when the response byte cap is reached before row JSON
  can be parsed, instead of surfacing a generic MCP tool error.
- Block Postgres `set_config()` queries before execution so session-mutating
  functions get the same explicit `DATA_QUERY_BLOCKED` response as other
  non-read SQL.

## [0.2.1-rc.2] - 2026-07-03

### Added

- Add Project-aware read-only Data Inspector MCP actions for managed Postgres
  and Redis: `list_data_sources`, `describe_data_source`, and
  `read_data_source`.
- Add Project Settings → Data Access opt-in UI and `data_source_access`
  persistence for agent read access.
- Add bounded query execution with Postgres read-only reader roles, Redis
  read-operation allowlists, result caps, timeouts, and activity audit metadata.

### Changed

- Increase the default MCP operation count to 83 and document the Data
  Inspector contract in the MCP reference.

## [0.2.1-rc.1] - 2026-07-02

### Changed

- Improve `recovery_receipt` readability for agent-primary verification by
  adding `next_action`, `passed_checks`, and compact `check_summary` fields.
- Make `next_action` the canonical receipt action while keeping
  `_agent_guidance.next_steps` derived from it for MCP envelope compatibility.

## [0.2.0] - 2026-06-30

### Changed

- Promote `v0.2.0` from `v0.2.0-rc.21` after final AWS rc.21 health and
  MCP-first failure-ticket triage smoke passed.

## [0.2.0-rc.21] - 2026-06-27

### Changed

- Improve MCP-first AI Ops failure-ticket triage by allowing instance/default
  agents to list open tickets without a project target while keeping scoped
  tokens target-bound.
- Make `list_ai_ops_briefings` return a compact triage projection with no
  evidence, LLM telemetry, dedupe fields, or duplicate call links.
- Add readable `recovery_receipt` fields including `summary`, `report_to_user`,
  `can_resolve`, `primary_check`, `failed_checks`, and `unknown_checks` so
  agents can report verification results without interpreting raw check arrays.

## [0.2.0-rc.20] - 2026-06-22

### Fixed

- Reduce noisy AI Ops failure tickets by skipping log-only evidence,
  self-healed container crashes, cancelled deploys, and build-only deploy
  failures while preserving restart-loop tickets when Docker reports explicit
  restart evidence.

## [0.2.0-rc.19] - 2026-06-19

### Added

- Add awaited user-input safety state for AI Ops dependency failures so
  user-owned external env values such as `EXCHANGE_API_URL` are recorded as
  pending operator input before an agent can mutate them.

### Security

- Block MCP `set_env_vars`, `update_app`, and `redeploy_app` attempts that try
  to guess or apply pending user-owned external env values, while still allowing
  unrelated env changes and route-only repairs.

## [0.2.0-rc.18] - 2026-06-19

### Changed

- Harden Verified Failure Ticket MCP responses so AI Ops briefing rows carry a
  `briefing_id`-aware diagnostic call, dependency failures expose structured
  `needs_user_input` terminal guidance, and common hallucinated service
  diagnose actions redirect to `openlander_monitor.diagnose_service`.

## [0.2.0-rc.17] - 2026-06-18

### Fixed

- Make `diagnose_service` mark unreachable dependency endpoints as
  user-input-gated so agents ask operators for missing values instead of
  guessing replacement URLs.

## [0.2.0-rc.16] - 2026-06-16

### Changed

- Simplify AI Ops surfaces by removing the Service Detail AI tab and keeping
  service-specific briefing review inside the Project AI Ops tab.
- Keep Project Settings AI focused on opt-in and budget policy, with a direct
  link to Project AI Ops for briefing review.
- Add a Project AI Ops service filter and `?tab=ai&service=...` deep link so
  service-scoped briefing views live under the Project investigation surface.
- Show a read-only selected-service policy indicator when service AI Ops
  behavior follows the Project setting or has a service override.

## [0.2.0-rc.15] - 2026-06-16

### Changed

- Improve the Home AI Ops Inbox so the empty and active states read as an
  operations surface with all-clear/attention copy, unresolved count, and a
  clear Projects CTA.
- Make the Project AI Ops tab policy-aware by showing the Project briefing mode,
  budget status, opt-in guidance, and a direct Configure AI Ops path.
- Promote Open in Agent as the primary briefing action while keeping Verify
  after fix, View evidence, and manual status actions visible as secondary
  controls.
- Clarify that the Service AI Ops panel controls service-level overrides while
  incident briefings should be reviewed from Home Inbox or Project AI Ops.

## [0.2.0-rc.14] - 2026-06-16

### Added

- Add the Home AI Ops Inbox and Project AI Ops tab so operators can review
  briefing incidents without drilling into each service's settings tab.
- Add manual AI Ops briefing status actions for `acknowledged` and `resolved`,
  plus an `unresolved` filter that keeps open and acknowledged briefings visible
  until a human closes them.
- Add a Verify after fix action that copies the deterministic
  `diagnose_service` + `briefing_id` MCP call for recovery receipt checks while
  keeping `recovery_receipt.status="verified"` as a signal, not an automatic
  status transition.

## [0.2.0-rc.13] - 2026-06-16

### Fixed

- Fix the Service AI Ops override save response so the web panel receives the
  Project policy, Service override, and resolved policy shape it expects after
  saving.

## [0.2.0-rc.12] - 2026-06-14

### Added

- Add AI Ops recovery receipts to `diagnose_service` when `briefing_id` is
  supplied, comparing incident-time briefing evidence with live route health,
  container status, restart stability, and latest deploy status.
- Add a verification MCP call to AI Ops Agent handoff prompts so agents can call
  `diagnose_service` with the original `briefing_id` after a fix and read
  `recovery_receipt.status`.

## [0.2.0-rc.11] - 2026-06-13

### Fixed

- Load saved AI provider routes into `ModelRegistry` during application boot so
  AI Ops Briefing provider configuration survives process restarts.
- Keep fresh installs and empty legacy provider credentials disabled instead of
  promoting them into an active default AI provider route.

## [0.2.0-rc.10] - 2026-06-13

### Added

- Add service-scoped MCP token metadata and enforcement so project- and
  service-scoped tokens only see and act on their allowed targets.

### Changed

- Normalize AI Ops briefing evidence and `diagnose_service` evidence through a
  shared read model with freshness metadata, token estimates, and omitted
  evidence follow-up calls.
- Improve deterministic AI Ops summaries so fallback briefing text includes the
  service, container, exit code, restart signal, and route status when available.

### Fixed

- Treat length-truncated AI Ops LLM summaries as fallback cases instead of
  persisting partial provider output, and expose summary status, finish reason,
  truncation, and token usage metadata to API/MCP readers.
- Harden scoped MCP action-status authorization for `action_id` aliases and
  held project-level actions.

### Security

- Return explicit `SCOPE_VIOLATION` rejections for out-of-scope MCP targets,
  re-check scoped destructive approvals before execution, and narrow
  `list_projects` visibility for scoped tokens.
- Wrap AI Ops LLM evidence as untrusted data in the summary prompt so incident
  logs cannot become model instructions.

## [0.2.0-rc.9] - 2026-06-12

### Changed

- Move Project AI Ops into `Project Settings > AI` and Service AI Ops into the
  Service `AI` tab so AI briefing controls are no longer mixed into General or
  Overview panels.

### Fixed

- Fix a Project AI Ops toggle crash by keeping the Project AI Ops update
  response aligned with the briefing-list contract and guarding the briefing
  list state against partial responses.

## [0.2.0-rc.8] - 2026-06-12

### Added

- Add Gemini API as an AI Ops Briefing provider option, using
  `gemini-2.5-flash` as the default model while keeping provider setup separate
  from Project AI Ops opt-in.

## [0.2.0-rc.7] - 2026-06-12

### Added

- Add the Settings → AI Providers page and Web API for configuring the AI Ops
  Briefing provider with OpenAI-compatible or Anthropic API credentials.
- Add encrypted AI provider key storage, connection testing, and explicit UI
  guidance that provider setup does not enable AI Ops by itself.

### Changed

- Move GitLab and Bitbucket Git provider placeholders out of the v0.2 launch
  scope wording and label them as planned after v0.2.

### Security

- Restrict AI provider settings routes to web session authentication, keep API
  keys out of responses, and block unsafe OpenAI-compatible base URLs that point
  at metadata, loopback, local, or link-local targets.

## [0.2.0-rc.6] - 2026-06-12

### Fixed

- Redact LLM-generated AI Ops briefing summaries before persisting them,
  sanitize provider failure messages, and keep deterministic briefing creation
  intact when the configured provider fails.
- Stabilize the services wire-contract coverage gate under heavy release-run
  parallelism.

## [0.2.0-rc.5] - 2026-06-11

### Fixed

- Align the RC cold-agent smoke tests with the explicit downtime policy by
  making lifecycle redeploy checks request `strategy="force"` instead of
  relying on implicit force fallback.

## [0.2.0-rc.4] - 2026-06-11

### Added

- Add the AI Ops Briefing Beta foundation with Project-level opt-in, Service
  override policy, durable fingerprint cooldown, and budget-aware LLM summary
  gating. AI Ops remains OFF by default and provider setup alone does not enable
  briefing generation.
- Add deterministic AI Ops briefings with persisted evidence, rule-owned
  severity/classification, and suggested MCP calls under the existing
  `openlander_monitor` composite action.
- Add AI Ops briefing Web/API surfaces for Project toggles, Service overrides,
  briefing cards, detail drawers, token/cost display, and redacted evidence.
- Add optional LLM summaries for AI Ops briefings using OpenAI-compatible or
  Anthropic providers. LLM output is limited to evidence summaries; it cannot
  change severity, classification, or suggested actions.
- Add Telegram send-only notification support for AI Ops briefings, gated by
  opt-in policy and durable fingerprint cooldown.

### Changed

- Align the v0.2 roadmap and MCP documentation around AI Ops Briefing Beta while
  keeping Variables / Deployment Target / environment-scope work in a separate
  milestone.

### Fixed

- Redact sensitive evidence before AI Ops briefing persistence, Web/MCP
  exposure, and LLM prompts.
- Stabilize AI Ops restart/log fingerprints and harden first-claim dedupe races
  so repeated incidents do not bypass cooldown.
- Wire passive runtime signals (`health:degraded`, `container:die`, and
  `deploy:failed`) into briefing creation, summary generation, and Telegram
  notification without enabling automatic remediation.

## [0.1.17] - 2026-06-10

### Added

- Expose custom-domain route health and direct managed Traefik Host verification
  in MCP domain repair surfaces, including `add_domain_route`,
  `list_domain_routes`, `apply_route_config`, and `list_projects`.

### Changed

- Clarified user-facing MCP, web prompt, and launch documentation vocabulary
  around the Project resource model: Projects contain Applications, Compose
  stacks, and Database/Cache/Storage resources. Compatibility action names and
  wire fields such as `openlander_managed_service`, `service_id`, and
  `deployable_service` remain unchanged.
- Clarified the agent surface policy in the Agent Guide and MCP docs: AI agents
  should use the `/mcp` endpoint and `openlander_*` tools, not direct REST
  `/api` fallback calls.
- Prepended copied Agent Guide prompts with a quick
  `openlander_project({ action: "help" })` setup check so agents stop and ask
  for MCP registration when the tools are unavailable.

### Fixed

- Wait past the managed Traefik HTTP provider poll window before accepting
  direct custom-domain route probe success for live domain/route mutations, so
  `apply_route_config` can no longer treat a stale old-route 2xx as proof that a
  newly broken `container_port` route is healthy.
- Group service-scoped incidents by their owning Project in agent context.
- Return a structured `MCP_TOKEN_USED_ON_REST_API` response when an MCP Agent
  Token is sent to REST `/api` routes, including the correct `/mcp` endpoint and
  a registration example.
- Extended the public vocabulary audit to reject `managed DB` wording in
  user-facing docs, MCP/runtime strings, and web prompt copy.

## [0.1.17-rc.4] - 2026-06-10

### Changed

- Clarified the agent surface policy in the Agent Guide and MCP docs: AI agents
  should use the `/mcp` endpoint and `openlander_*` tools, not direct REST
  `/api` fallback calls.
- Prepended copied Agent Guide prompts with a quick
  `openlander_project({ action: "help" })` setup check so agents stop and ask
  for MCP registration when the tools are unavailable.

### Fixed

- Return a structured `MCP_TOKEN_USED_ON_REST_API` response when an MCP Agent
  Token is sent to REST `/api` routes, including the correct `/mcp` endpoint and
  a registration example.

## [0.1.17-rc.3] - 2026-06-10

### Changed

- Clarified user-facing MCP, web prompt, and launch documentation vocabulary
  around the Project resource model: Projects contain Applications, Compose
  stacks, and Database/Cache/Storage resources. Compatibility action names and
  wire fields such as `openlander_managed_service`, `service_id`, and
  `deployable_service` remain unchanged.

### Fixed

- Extended the public vocabulary audit to reject `managed DB` wording in
  user-facing docs, MCP/runtime strings, and web prompt copy.

## [0.1.17-rc.2] - 2026-06-10

### Fixed

- Wait past the managed Traefik HTTP provider poll window before accepting
  direct custom-domain route probe success for live domain/route mutations, so
  `apply_route_config` can no longer treat a stale old-route 2xx as proof that a
  newly broken `container_port` route is healthy.

## [0.1.17-rc.1] - 2026-06-10

### Added

- Expose custom-domain route health and direct managed Traefik Host verification
  in MCP domain repair surfaces, including `add_domain_route`,
  `list_domain_routes`, `apply_route_config`, and `list_projects`.

### Fixed

- Group service-scoped incidents by their owning Project in agent context, and
  return a clear `MCP_PAT_NOT_ACCEPTED_FOR_REST` error when MCP personal access
  tokens are used against REST API routes.

## [0.1.16] - 2026-06-09

### Changed

- Make OpenLander-managed Traefik app routing HTTP-provider-only. Managed app,
  compose, preview, recovery, and rollback containers no longer publish Docker
  Host routers; `/api/traefik/config` is the single source of truth for public
  app routes from active service rows and active preview records.
- Allow existing-service `deploy_app` requests with source-only changes
  (`repo_url`, `branch`, `source`, `image`, or `port`) to save the source update
  and start `update_app` in one structured path when the caller explicitly
  targets a service. Dockerfile/build config changes still use
  `update_service_config`, then `update_app`.
- Block no-strategy `update_app` / `redeploy_app` calls when blue-green is not
  eligible instead of falling back to `strategy="force"` without an explicit
  user downtime decision.
- Tighten deploy-plan env value validation by treating provided placeholder or
  structurally invalid values as blocking input.

### Fixed

- Rename adopted managed Traefik containers to the standard `traefik-ol` name,
  so stop/status checks and project-network sync all target the same active
  container after adoption.
- Reconnect OpenLander-managed Traefik to existing active project networks on
  startup/adoption, so HTTP-provider-only upgraded hosts can still resolve
  existing app, compose, rollback, and recovery container backends.
- Connect the managed Traefik container to the OpenLander container's compose
  network in containerized installs, and point the HTTP provider at the
  OpenLander container DNS name, so custom host ports and containerized installs
  keep managed routes reachable.
- Recreate older managed Traefik containers whose provider configuration still
  enables Docker routing or targets stale endpoints.
- Verify blue-green cutovers after the previous container is stopped before
  removing it, and observe green-container stability before switching the public
  route, so stale routes and delayed crash-loop candidates fail while the
  previous version remains serving.
- Wait across the blue-green green-container readiness window instead of
  treating Docker `HEALTHCHECK` `starting` states as immediate probe failures.

## [0.1.16-rc.10] - 2026-06-09

### Fixed

- Rename adopted managed Traefik containers to the standard `traefik-ol` name,
  so stop/status checks and project-network sync all target the same active
  container after adoption.

## [0.1.16-rc.9] - 2026-06-09

### Fixed

- Apply the OpenLander container network attachment to adopted managed Traefik
  containers as well as the standard `traefik-ol` container, and keep subsequent
  project-network sync pointed at the adopted container, so adoption does not
  leave the HTTP provider unable to resolve either OpenLander or app backends.

## [0.1.16-rc.8] - 2026-06-08

### Fixed

- Connect the standard OpenLander-managed Traefik container to the OpenLander
  container's compose network in containerized installs, so the HTTP provider
  endpoint can resolve the `openlander` container DNS name.

## [0.1.16-rc.7] - 2026-06-08

### Fixed

- Point the managed Traefik HTTP provider at the OpenLander container DNS name
  in containerized installs, and recreate older Traefik containers whose
  provider endpoint still targets `host.docker.internal`, so custom
  `OPENLANDER_PORT` host mappings do not break app routes or blue-green
  cutovers.

## [0.1.16-rc.6] - 2026-06-08

### Fixed

- Reconnect OpenLander-managed Traefik to existing active project networks on
  startup/adoption, so HTTP-provider-only upgraded hosts can still resolve
  existing app, compose, rollback, and recovery container backends.

## [0.1.16-rc.5] - 2026-06-08

### Changed

- Make OpenLander-managed Traefik app routing HTTP-provider-only. Managed app,
  compose, preview, recovery, and rollback containers no longer publish Docker
  Host routers; `/api/traefik/config` is the single source of truth for public
  app routes from active service rows and active preview records.
- Recreate older managed Traefik containers that still enable the Docker
  provider, so upgraded hosts do not keep stale Docker-label routers around
  blue-green cutovers.

## [0.1.16-rc.4] - 2026-06-08

### Changed

- Allow existing-service `deploy_app` requests with source-only changes
  (`repo_url`, `branch`, `source`, `image`, or `port`) to save the source update
  and start `update_app` in one structured path when the caller explicitly
  targets a service. Dockerfile/build config changes still use
  `update_service_config`, then `update_app`.
- Tighten deploy-plan env value validation by removing fixture-specific
  `EXCHANGE_API_*` rules and treating any provided placeholder or structurally
  invalid value as blocking input, even when the key itself is optional.

### Fixed

- Verify blue-green cutovers after the previous container is stopped before
  removing it, so stale Docker-label routes cannot make a promotion look
  successful while the public route would become 404 after cleanup.

## [0.1.16-rc.3] - 2026-06-08

### Changed

- Block no-strategy `update_app` / `redeploy_app` calls when blue-green is not
  eligible instead of falling back to `strategy="force"` without an explicit
  user downtime decision.

### Fixed

- Recreate legacy OpenLander Traefik containers that do not expose the HTTP
  provider, so blue-green route cutovers and route-config updates are not
  validated against stale Docker-label routes that disappear after blue cleanup.

## [0.1.16-rc.2] - 2026-06-08

### Fixed

- Observe blue-green green-container stability before switching the public route,
  so delayed crash-loop candidates fail while the previous version remains the
  active backend.

## [0.1.16-rc.1] - 2026-06-08

### Fixed

- Wait across the blue-green green-container readiness window instead of
  collapsing Docker `HEALTHCHECK` `starting` states into the probe runner's
  short retry loop, so healthy candidates with a Docker start period can be
  promoted correctly before the post-switch stability check.

## [0.1.15] - 2026-06-08

### Changed

- Return `status: "already_public"` from `expose_public` when an app already has
  a reachable public route, instead of forcing agents through optional tunnel
  creation.
- Add success guidance to `deploy_app` wait responses so agents know to report
  `preferred_url` and stop instead of calling extra expose/deploy actions.

## [0.1.15-rc.1] - 2026-06-08

### Changed

- Return `status: "already_public"` from `expose_public` when an app already has
  a reachable public route, instead of forcing agents through optional tunnel
  creation.
- Add success guidance to `deploy_app` wait responses so agents know to report
  `preferred_url` and stop instead of calling extra expose/deploy actions.

## [0.1.14] - 2026-06-07

### Added

- Add the `openlander_service.update_app` MCP action as the normal intent for
  updating an existing Application to its latest saved source/configuration,
  while reusing the existing deploy lock, blue-green eligibility, status, and
  diagnostic contract.
- Add local operator MCP token rotation commands for repeatable QA and
  self-hosted setup workflows.
- Add compact deploy-plan needs-input summaries so agents can ask for the first
  real missing or invalid value instead of copying placeholder secrets.

### Changed

- Prefer blue-green automatically for eligible no-strategy app updates, while
  preserving explicit `strategy="force"` for operators who intentionally accept
  downtime.
- Tighten MCP guidance around force-style updates: failed blue-green updates now
  emphasize when the previous version is still serving and no longer hand agents
  a direct force fallback call.
- Keep Day-1 composite deploy plans responsible for the target Project and
  project-scoped managed Postgres/Redis topology, reducing agent-side manual
  Project/database/cache assembly.
- Treat user-owned external SaaS values as trusted input that must come from a
  saved or confirmed source; OpenLander blocks obvious placeholder/example
  values instead of inventing plausible secrets.

### Fixed

- Wait for auto-provisioned managed PostgreSQL and Redis services to become
  reachable before starting the application container.
- Preserve the previous version during failed blue-green updates, including
  crash-loop candidates caught by the post-switch stability window.
- Surface representative public-traffic failures in deploy status and
  `diagnose_service`, so healthcheck-only false positives can be reported as
  `TRAFFIC_HEALTH_MISMATCH`.
- Improve Day-2 route and port recovery diagnostics with high-confidence
  `PORT_MISMATCH` suggestions, `apply_route_config` verification, and automatic
  rollback when route verification fails.
- Avoid misclassifying self/base URLs or reachable non-2xx external APIs as
  high-confidence dependency failures.

## [0.1.14-rc.28] - 2026-06-07

### Changed

- Align implicit force-fallback MCP messages with explicit `strategy="force"`
  responses so agents see the same terminal-status and diagnosis warning in the
  primary message.

## [0.1.14-rc.27] - 2026-06-07

### Changed

- Tighten MCP guidance around force-style app updates: explicit or fallback
  `strategy="force"` responses now warn agents not to report success until
  terminal deploy status and diagnostics confirm health.
- Stop returning a direct `fallback_call` to force after blue-green eligibility
  rejections; agents now get guidance to fix eligibility or ask before accepting
  downtime.
- Clarify `restart_service` as an advanced force-style runtime recreate path,
  not the normal safe latest-code update path.

## [0.1.14-rc.26] - 2026-06-07

### Added

- Add `openlander_service.update_app` as the clear MCP intent for updating an
  existing Application/worker to its latest stored source/config while reusing
  the existing redeploy safety path.

### Changed

- Prefer `update_app` in MCP prompts, guidance, diagnostics, and docs whenever
  agents need to apply saved app source/config/env changes to an existing
  workload.

## [0.1.14-rc.25] - 2026-06-07

### Fixed

- Make failed blue-green deploy status emphasize that the previous version is
  still serving, and warn agents not to immediately retry with force.

## [0.1.14-rc.24] - 2026-06-07

### Fixed

- Clarify `deploy_app` existing-Project redeploy delegation responses so agents
  know a redeploy has already started and should poll `status_call` instead of
  creating another Application.

## [0.1.14-rc.23] - 2026-06-07

### Fixed

- Persist lazy representative traffic failures from `get_deploy_status` so
  `diagnose_service` can promote async deploy healthcheck-only 5xx failures to
  `TRAFFIC_HEALTH_MISMATCH`.

## [0.1.14-rc.22] - 2026-06-06

### Fixed

- Prefer high-confidence actionable diagnoses over representative traffic
  mismatch symptoms, and only promote stored representative traffic failures to
  a diagnosis when the current health probe is still reachable.

## [0.1.14-rc.21] - 2026-06-06

### Fixed

- Surface representative traffic failures as `TRAFFIC_HEALTH_MISMATCH` in
  `diagnose_service`, and mark recent deploy summaries with an unhealthy
  effective status when stored representative traffic evidence failed.

## [0.1.14-rc.20] - 2026-06-06

### Fixed

- Persist representative public traffic probe evidence on deploy logs so
  polled deploy status can surface healthcheck-only false positives.
- Mark `get_deploy_status` results as unhealthy when representative public
  traffic returns a 5xx, while keeping transient lazy-probe failures out of
  permanent deploy-log evidence.
- Include stored representative traffic evidence in `diagnose_service` recent
  deployment summaries.

## [0.1.14-rc.19] - 2026-06-06

### Fixed

- Prefer blue-green redeploys automatically for eligible Applications when
  agents call `redeploy_app` without an explicit strategy, keeping the previous
  version serving through route verification and the post-switch stability
  window.
- Keep explicit `strategy="force"` available for shorter replacement redeploys
  when downtime is acceptable, and fall back to force automatically when
  blue-green is not currently eligible.
- Update MCP schema descriptions and public deploy docs so agent guidance no
  longer says force is the default redeploy strategy.

## [0.1.14-rc.18] - 2026-06-06

### Fixed

- Keep blue-green redeploys on the previous version until the green container
  survives a 30-second post-switch stability window, and restore blue when the
  new version starts crashing or becomes unhealthy during that window.
- Probe representative public traffic before reporting a waited deploy as
  successful, so healthcheck-only false positives are downgraded to unhealthy
  with a diagnostic follow-up.
- Add a compact deploy-plan `needs_input` action summary so agents can ask for
  the first real missing/invalid value and retry with the correct
  `update_deploy_plan` payload.
- Align deploy stability policy with Swarm/Kubernetes-style min-ready behavior
  by ignoring pre-window restart history, tolerating transient Docker inspect
  failures, retrying public traffic probes briefly, and returning structured
  route-probe status codes.

## [0.1.14-rc.17] - 2026-06-06

### Fixed

- Allow deploy plans to accept user-confirmed external environment values through
  a trusted update path while keeping untrusted inline SaaS values blocked.
- Treat app self/base URLs as normal app configuration instead of external SaaS
  credentials, and narrow fake/reserved env heuristics to avoid blocking real
  demo/test hosts or secrets containing common substrings.

## [0.1.14-rc.16] - 2026-06-06

### Fixed

- Keep deploy plans in `needs_input` when user-owned external app env values
  are supplied inline without a trusted/saved source, so agents cannot turn
  missing SaaS credentials or public URLs into plausible invented values during
  Day-1 deploy planning.

## [0.1.14-rc.15] - 2026-06-06

### Fixed

- Keep deploy plans in `needs_input` for additional fake external app env values,
  including example SMTP hosts, demo/sample self URLs, copied AWS example keys,
  and shape-correct but placeholder-like API secrets.

## [0.1.14-rc.14] - 2026-06-05

### Fixed

- Wait for auto-provisioned managed PostgreSQL and Redis services to become
  reachable before starting the application container, preventing first-start
  races where the app boots before its managed dependencies accept connections.
- Strengthen managed-service readiness checks with PostgreSQL credential-level
  `SELECT 1` and Redis `PING` probes instead of relying only on container state
  or logs.
- Keep reachable HTTP non-2xx dependency probes as raw diagnostic evidence
  without synthesizing high-confidence `DEPENDENCY_UNREACHABLE` diagnoses.
- Reject more obvious fake/sample/dummy API keys and example-like HTTP hosts
  before deploy execution.

## [0.1.14-rc.13] - 2026-06-05

### Fixed

- Keep deploy plans in `needs_input` when supplied app environment values are
  invalid, including reserved/example HTTP(S) hosts, too-short secrets, and
  prefix mismatches for known API key formats.
- Surface value-shape requirements in deploy-plan responses without copyable
  fake secret/API examples, so agents ask users for real secrets and reachable
  endpoints instead of deploying placeholder values.

## [0.1.14-rc.12] - 2026-06-05

### Fixed

- Detect schema-driven Node.js environment validators that read required
  variables through dynamic `process.env[key]` access, so deploy plans surface
  those app secrets before runtime boot loops.
- Grant managed PostgreSQL app users privileges on the target database `public`
  schema and its default tables/sequences when creating service-scoped users.

## [0.1.14-rc.11] - 2026-06-05

### Fixed

- Honor explicit external `DATABASE_URL` and `REDIS_URL` values throughout
  Day-1 deploy plans, so stale managed-resource proposals cannot trigger
  approval, target-Project pre-creation, or OpenLander-managed database/cache
  provisioning.

## [0.1.14-rc.10] - 2026-06-05

### Fixed

- Keep Day-1 composite deploy plans from leaking into manual Project, database,
  and cache assembly by creating and binding the target Project before approved
  managed resource provisioning.
- Ensure app runtime and auto-provisioned Postgres/Redis resources share the
  same Project/network, including monorepo plans that reuse a pre-created parent
  Project during execution.
- Update MCP deploy-plan guidance so agents stay on the composite approval path
  instead of hand-assembling Project and managed-service primitives.

## [0.1.14-rc.9] - 2026-06-05

### Fixed

- Add a short post-deploy stability observation window to `deploy_app(wait=true)`
  so containers that start crashing immediately after an initial healthy signal
  are returned as unhealthy with `post_deploy_stability`, warnings, and
  `diagnostic_call`.
- Warn in `diagnose_service` when the configured healthcheck path succeeds but
  representative traffic returns HTTP 5xx, while keeping ambiguous 401/403/404
  and redirect responses as raw probe evidence instead of high-confidence
  failures.

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
