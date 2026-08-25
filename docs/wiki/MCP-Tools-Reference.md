# MCP Tools Reference

OpenLander exposes its functionality to AI coding agents through a **composite-tool surface**:

- **5 composite tools** — enabled by default
- **142 unique default operations** surfaced through those composites
- **13 platform tools** for server admin (health, Docker inspect, orphan adoption, etc.) — gated behind `config.mcp.platformTools: true`

Each composite takes `{ action, params }` — e.g.
`openlander_deploy({ action: "deploy_app", params: { repo_url: "...", name: "my-app" } })`.
Run `{ action: "help" }` on any composite to get a compact action catalog. Then run
`{ action: "help", params: { action_name: "create_deploy_plan" } }` to fetch that action's
machine-readable `input_schema`, `required_params`, and `optional_params`. Use
`{ action: "help", params: { verbose: true } }` only when a client needs every action schema at once.

Model note: **Project = workspace**. **Application**, **Compose**, **Database**, **Cache**, and **Storage** are resources inside a Project. Wire fields and MCP action names such as `service_id` and `openlander_service` remain compatible in v0.1.x.

Agent routing rule of thumb:

| User asks for                                      | Call                                                                                                        |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| "Deploy this new app/repo/image"                   | `openlander_deploy.deploy_app`                                                                              |
| "Create a new app project before DB/cache"         | `openlander_project.create_project`                                                                         |
| "Update this existing app to latest code/config"   | `openlander_service.update_app`                                                                             |
| "Restart/rollback this existing app"               | `openlander_service.restart_service` / `rollback_service`                                                   |
| "Change app branch/repo/image source"              | `deploy_app` with an explicit `service_id`/`service_name`, or `update_application_source` then `update_app` |
| "Set env vars or connect DB/Redis to an app"       | `openlander_service.set_env_vars`, then `update_app`                                                        |
| "Fix route port mismatch without rebuild"          | `openlander_service.apply_route_config`                                                                     |
| "Create PostgreSQL/Redis/MySQL/etc."               | `openlander_managed_service.create_service`                                                                 |
| "Inspect this project's database/cache safely"     | `openlander_managed_service.list_data_sources` / `describe_data_source` / `read_data_source`                |
| "Why is this failing?"                             | `openlander_monitor.diagnose_service` with `service_id`                                                     |
| "What did AI Ops notice?"                          | `openlander_monitor.list_ai_ops_briefings` / `get_ai_ops_briefing`                                          |
| "Was this killed by host memory/Docker?"           | `openlander_monitor.diagnose_host_resources`                                                                |
| "Is Docker's network pool exhausted?"              | `openlander_monitor.list_docker_networks`                                                                   |
| "Capture this customer review delivery"            | `openlander_project.create_delivery` / `record_delivery_feedback`                                           |
| "Show FDE portfolio blockers across Projects"      | `openlander_project.list_engagements` / `get_engagement`                                                    |
| "Start a customer engagement and Project"          | `openlander_project.bootstrap_engagement`                                                                   |
| "Register a repo before deployment is defined"     | `openlander_project.register_project_repository`                                                            |
| "Plan and hand off an Agent delivery run"          | `openlander_project.plan_delivery` / `record_delivery_run_progress` / `resume_delivery_run`                 |
| "Apply or inspect the repository Project manifest" | `openlander_project.apply_project_manifest` / `get_project_manifest`                                        |
| "Prepare this Project for cloud migration"         | `openlander_project.get_migration_snapshot`                                                                 |
| "Compare AWS and GCP migration targets"            | `openlander_project.compare_migration_targets`                                                              |
| "Build a PostgreSQL cloud migration runbook"       | `openlander_project.get_migration_runbook`                                                                  |
| "Inspect PostgreSQL before cloud migration"        | `openlander_project.get_migration_preflight`                                                                |
| "Build once and promote the same artifact"         | `openlander_deploy.create_release` / `promote_release` / `evaluate_promotion`                               |
| "Stop or roll back a Release"                      | `openlander_deploy.recall_release` / `rollback_environment`                                                 |
| "Create this week's internal and customer report"  | `openlander_project.generate_weekly_report` / `publish_weekly_report`                                       |
| "Classify the feedback into review items"          | `openlander_project.submit_delivery_work_item_drafts`                                                       |
| "Is the customer Receipt ready?"                   | `openlander_project.get_delivery_readiness`                                                                 |

Prefer `service_id` for follow-up actions. `project_name` is a limited shortcut only when a Project
contains exactly one Application.
`list_projects().projects[].deployable_service_count` is the v0.1.x compatibility
field for Application/worker count in the Project; it does not include Database
resources, caches, buckets, or the Compose parent metadata row.

Remote MCP uses Bearer tokens. Mint one from the **Your Agent** page (`/mcp-server`) in the
dashboard, or from the setup wizard's MCP step — both issue an instance-wide token, **shown only
after an explicit Reveal click**. The current API value for this instance-wide scope is
`scope_kind: "org"` for compatibility; this is not an organization feature. The signed-in dashboard
can reveal newly issued tokens again without revoking them. **Regenerate** (or
`POST /api/mcp/token/regenerate`) still revokes the previous token; `POST /api/mcp/token` may not
return plaintext once a token already exists. Project- and service-scoped tokens exist via the
API (`POST /api/tokens` with `scope_kind: "project"` + `scope_project_id`, or
`scope_kind: "service"` + `scope_service_id`) but are not part of the 0.1 onboarding UI. The MCP
endpoint is your dashboard origin + `/mcp` (`:10114` only when reaching OpenLander without a
reverse proxy).

Scoped tokens are enforced at the MCP composite boundary. A project-scoped token can target only
that Project; a service-scoped token can target only that exact Application/Compose `service_id`,
even when sibling services share the same Project. Cross-scope, sibling, and targetless host-level
calls return `{ code: "SCOPE_VIOLATION" }` with `details.reason` such as `project_mismatch`,
`service_mismatch`, `target_required`, or `target_not_found_or_out_of_scope`; scoped tokens do not
distinguish a missing target from an out-of-scope target. `list_projects` is the scoped discovery
exception: it returns only Projects and Application/Compose `service_id` values visible to the token.
When an action supplies more than one target selector, every supplied selector must be inside the
token scope; agents should not mix `service_id`, `project_id`, `deploy_id`, or `action_run_id`
values from different targets in one call. Delivery selectors (`delivery_id`, `artifact_id`,
`report_artifact_id`, and `predecessor_delivery_id`) follow the same rule. `mcp_action_status` may be polled with a service-scoped
token for held actions in the scoped service's Project, so handoff flows can follow their own
approval/status lifecycle without broadening the token.

This Bearer token is for MCP, not for raw REST `/api` calls. A correctly registered agent should
see the five `openlander_*` composite tools and should be able to call
`openlander_project({ action: "help" })`. If those tools are missing, fix MCP registration
instead of asking the model to call OpenLander's HTTP API directly.
If the same token is sent to `/api`, OpenLander returns `MCP_TOKEN_USED_ON_REST_API`
with the correct `/mcp` endpoint and a registration example.

Destructive MCP operations are intentionally gated. Host-maintenance actions
`platform_force_remove`, `recover_platform`, and `platform_cleanup_orphans`
remain human-UI-only and return `OPERATION_REQUIRES_HUMAN_UI`.

Database/Cache/Storage deletion actions `remove_service`, `remove_volume`, and `delete_bucket`
follow the effective Security permission instead. The default is `allow`; an operator can change the
global, Project, or service setting to `approval_required` (returns a pollable `action_run_id`) or
`block` (returns `OPERATION_PERMISSION_DENIED`). Service overrides win over Project overrides, which
win over the global default. Database credential, container-exec, and data-inspection actions follow
the separate `database_access` allow/block permission.

Host-wide `cleanup_docker` follows only the global `destructive_actions` setting because it has no
Project or service target. It executes immediately when allowed, enters the same durable approval
queue when approval is required, and returns `OPERATION_PERMISSION_DENIED` when blocked. A held
request includes the requested `level` in its approval summary.

Application cleanup and restore use softer paths. `archive_project`,
`unarchive_project`, `archive_service`, and `unarchive_service` are exposed
through the project/service composites but enter the human approval hold queue
before executing.
Archive is reversible cleanup, not permanent deletion: archived Applications
are hidden from default active lists, can be inspected with
`list_archived_services`, and can be restored with `unarchive_service` or
`unarchive_project`. Preserved Stateful Compose resources resume in place;
other restore actions do not redeploy automatically.
Archive execution uses the durable deployment lock plus the in-process job
registry as its concurrency check. Dockerfile and Compose deployments both own
the same durable lock. An active deployment returns `DEPLOY_LOCKED`; after an
approved archive fails this way, `mcp_action_status` includes sanitized
`error_code` and `error_details` such as `lock_session`,
`blocked_service_id`, `status_source`, and `operation_phase` when known. An old
persisted `building` status without an active lock or job is normalized and
does not block archive.
Approval-hold responses include both `actionRunId` and `action_run_id`, plus a
`poll_call` envelope for `openlander_monitor.mcp_action_status`, an
`effect_preview`, and `after_approval` guidance so agents know what changed and
what to do after approval.
Supported bulk cleanup actions such as `bulk_delete_env_vars confirm=true` also
enter that queue.
`remove_unused_docker_network` follows the same approval hold. It rechecks the
exact `network_name` and `network_id`, requires zero active endpoints, and never
removes system/shared, external, or other-instance networks. Label-less legacy
`ol-*` networks additionally require `allow_legacy_unlabeled=true`.

**Project/app hard delete and purge remain human UI-only.** Composites do not expose
`delete_project`, `delete_app`, `remove_app`, or `purge_project`. Calls to those names return
`{ error: "HUMAN_UI_ONLY", web_ui: { surface: "project_settings_danger" }, safe_alternatives: [...], do_not_substitute: [...] }`
so agents do not silently substitute `remove_service` or `cleanup_docker` (those target
Database/Cache/Storage resources, not Applications). For whole Project lifecycle changes, use
`archive_project` / `unarchive_project` with `project_id` or `project_name`; for one Application,
use `archive_service` / `unarchive_service` with a `service_id`.

User-owned external configuration is also gated. If `diagnose_service` determines that a saved
external dependency value such as `EXCHANGE_API_URL` requires user input, OpenLander records a
pending input for that field. MCP attempts to change that field through `set_env_vars` or inline
`update_app` / `redeploy_app` `env_vars` return `{ code: "USER_INPUT_REQUIRED" }` and include
`report_to_user`; agents must ask the user for the value and must not retry with a guessed endpoint.
Unrelated env changes, route-only repairs such as `apply_route_config`, read-only AI Ops actions,
and restart calls without env mutation are not blocked by this gate. The gate can be cleared only
from trusted human surfaces (for example, saving the value in the web UI) or by a later
`diagnose_service` observing the dependency as reachable.

Composite catalog:

| Composite                    | Action slots | Purpose                                                                                                 |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- |
| `openlander_deploy`          | 28           | Deploy plans, immutable Releases, Promotion, rollback, build logs, Git                                  |
| `openlander_project`         | 64           | Projects, manifests, migration planning, Agent Delivery, weekly reports, Engagement, lifecycle, secrets |
| `openlander_service`         | 26           | Application lifecycle, config, domain routes, public access, and env vocabulary                         |
| `openlander_managed_service` | 24           | Database/Cache/Storage resources, credentials, backups, data inspection, disk usage                     |
| `openlander_monitor`         | 15           | Logs, alerts, AI Ops briefings, topology, host/network diagnosis, probes                                |

`openlander_project` owns Project/config actions. `openlander_service` owns Application runtime actions.

## Tool Categories

| Category                                                  | Tools | Description                                                                         |
| --------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------- |
| [Deploy Plan](#deploy-plan)                               | 6     | Create, inspect, update, execute deploy plans                                       |
| [Deployment Controls](#deployment-controls)               | 7     | Status, cancel, rollback, previews                                                  |
| [Project Operations](#project-operations)                 | 7     | Project lifecycle, listing, and Project-scoped config                               |
| [Delivery Workspace](#delivery-workspace)                 | 14    | Review evidence, feedback, Gates, deploy links, Receipt preview                     |
| [Agent Delivery Run](#agent-delivery-run)                 | 8     | Plan, verify, hand off, resume, cancel, or complete                                 |
| [Project Manifest](#project-manifest)                     | 3     | Register source and apply/inspect Project configuration                             |
| [Migration Planning](#migration-planning)                 | 4     | Export a neutral graph, compare targets, inspect PostgreSQL, and build a DB runbook |
| [Release and Promotion](#release-and-promotion)           | 6     | Build once, promote an immutable digest, recall, or roll back                       |
| [Weekly Reporting](#weekly-reporting)                     | 3     | Freeze evidence and publish internal/customer HTML and PDF                          |
| [Engagement Portfolio](#engagement-portfolio)             | 3     | Engagement bootstrap and cross-Project portfolio reads                              |
| [Environment Variables](#environment-variables--secrets)  | 11    | Env vars, secrets, secret files                                                     |
| [Resources](#services--infrastructure)                    | 17    | Create databases, manage infrastructure resources                                   |
| [Data Inspector](#project-aware-data-inspector)           | 3     | Bounded read-only data-source inspection                                            |
| [Managed public sharing](#expose_public--unexpose_public) | 3     | Publish, inspect, or stop an OpenLander-managed public URL                          |
| [Custom domains](#domains)                                | 2     | Register and inspect user-managed Host/path routes                                  |
| [Git & Repository](#git--repository)                      | 4     | Scan repos, list GitHub repos                                                       |
| [Monitoring](#monitoring--logs)                           | 14    | Logs, stats, alerts, AI Ops briefings, host/network diagnosis                       |
| [Debug](#debug--troubleshooting)                          | 1     | Build logs for external-agent analysis                                              |
| [Volume Management](#volume-management)                   | 5     | Docker volumes, disk cleanup                                                        |
| [Infrastructure Analysis](#infrastructure-analysis)       | 2     | Repo analysis, web search                                                           |
| [Platform Admin](#platform-admin)                         | 13    | Health, events, docker inspect                                                      |

---

## Deploy Plan

### `create_deploy_plan`

Analyze a repository and create a deployment plan.

| Parameter           | Type     | Required | Description                                                        |
| ------------------- | -------- | -------- | ------------------------------------------------------------------ |
| `repo_url`          | string   | No       | Git repository URL                                                 |
| `branch`            | string   | No       | Branch to deploy                                                   |
| `name`              | string   | No       | Project name                                                       |
| `source`            | string   | No       | `'git'` or `'image'`                                               |
| `image`             | string   | No       | Docker image (if source=image)                                     |
| `cmd`               | string   | No       | Container command override                                         |
| `port`              | number   | No       | Container port                                                     |
| `health_check_path` | string   | No       | Health check path                                                  |
| `env_vars`          | object   | No       | Environment variables                                              |
| `prefer_dockerfile` | boolean  | No       | Prefer existing Dockerfile                                         |
| `dockerfile_path`   | string   | No       | Relative Dockerfile path                                           |
| `build_context`     | string   | No       | Build context relative to repository root                          |
| `docker_target`     | string   | No       | Docker build target stage                                          |
| `compose_file`      | string   | No       | Repository-relative Compose file                                   |
| `compose_files`     | string[] | No       | Ordered Compose files, from base to overlays                       |
| `compose_profiles`  | string[] | No       | Compose profiles to activate                                       |
| `traffic_service`   | string   | No       | Compose application used for representative traffic                |
| `environment`       | string   | No       | `production` (default) or `development`                            |
| `target_project_id` | string   | No       | Deploy an Application or Compose workload into an existing Project |

For Compose plans, OpenLander auto-selects `traffic_service` when exactly one exposed application
exists. Multiple exposed applications return `needs_input` with
`build.traffic_service_candidates`; choose one with
`update_deploy_plan({ updates: { traffic_service: "..." } })`. Resource/job-only stacks omit the
representative HTTP probe.

Use either `compose_file` or `compose_files`, not both. Overlay files are merged in array order and
support Compose `!reset`, for example
`["docker-compose.yml", "deploy/docker-compose.prod.yml"]`. The first path remains available as
`build.compose_file` for backward compatibility; multi-file plans also return `build.compose_files`.

### `update_deploy_plan`

Update a deployment plan with missing values.

| Parameter | Type   | Required | Description                                                           |
| --------- | ------ | -------- | --------------------------------------------------------------------- |
| `plan_id` | string | Yes      | Plan ID                                                               |
| `updates` | object | Yes      | JSON with env, Compose file(s)/profiles, traffic service, or services |

### `get_deploy_plan`

Retrieve a deployment plan by ID.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `plan_id` | string | Yes      | Plan ID     |

### `execute_deploy_plan`

Execute a deployment plan (non-blocking).

| Parameter                    | Type     | Required | Description                                                                       |
| ---------------------------- | -------- | -------- | --------------------------------------------------------------------------------- |
| `plan_id`                    | string   | Yes      | Plan ID                                                                           |
| `deploy_only`                | string[] | No       | Compose services to replace; dependencies are treated as prerequisites            |
| `approve_all_safe_resources` | boolean  | No       | Approve every proposed project-scoped Database/Cache/Storage resource on the plan |
| `approvals.create_resources` | string[] | No       | Approve specific proposed services by identifier (e.g. `postgresql`)              |

When a plan is in **`needs_approval`** status it proposes project-scoped Database/Cache/Storage resources
(listed in `services[]` with `resolution="proposed_project_service"`) — for example a
`postgresql` database OpenLander would auto-provision and wire to `DATABASE_URL`. The
provisioning is gated: execute returns `needs_approval` with `approval_required.create_resources`
(the identifiers to approve) and creates nothing until you approve. Re-run with
`approve_all_safe_resources=true` to approve all, or `approvals.create_resources=[...]` to approve
individually. Unapproved, compose, or not-auto-creatable services are never created — supply their
connection env (e.g. an external `DATABASE_URL`) or create them first.

This auto-provisioning and env wiring applies to the deploy-plan approval flow
only. Standalone `create_service` creates the Database/Cache/Storage resource and returns
`suggested_env`. If the target project already has an Application, redeploy
that Application to apply saved env. If the project is empty, deploy the first app
with `deploy_app(target_project_id=...)`.

For brand-new apps, approved safe resources are provisioned into the same Project/network that the
app deploy uses. The plan engine creates/owns that target Project before provisioning, so agents do
not need to hand-assemble `create_project` -> `create_service` -> `deploy_app(target_project_id)`
for the common PostgreSQL/Redis case. If the user already has a real external connection URL such
as RDS or Upstash, pass it in `env_vars` and skip Database/Cache/Storage resource creation.
Shared OpenLander-provisioned Database/Cache resources and external TCP database/cache endpoints are not part of the
v0.1 MCP surface.

### `deploy_app`

One-call app deploy front door. With `service_id`, `service_name`, `project_name`, or an existing
project `name`, it redeploys the existing app. With `repo_url` or `image`, it creates a new app.
For new app names, use `name`; `project_name` is only for existing app lookup/scoping.
After a successful `deploy_app`, OpenLander records the deployed image digest as an implicit
Delivery/Agent Run/Release compatibility record. This adoption does not rebuild the image, so a
later Promotion can reuse the exact immutable artifact. Existing-app calls return the Release as
pending because the delegated `update_app` path is asynchronous.
When `deploy_app` resolves an existing app and includes source-only changes (`repo_url`, `branch`,
`source`, `image`, or `port`), OpenLander saves those source settings first and then starts
`update_app`. Dockerfile/build config changes still require `update_service_config`, then
`update_app`.
When dependency manifests declare git-based dependencies, OpenLander refreshes the dependency
install layer while preserving normal Docker cache behavior for other repos. Use `no_cache=true`
only when you need a fully uncached build.

`target_project_id` attaches a newly deployed Application, worker, or Compose
workload to an existing Project after the deploy succeeds. The target Project
network is used from the first container start. The attach is owned by the
durable deploy-plan execution path, not request-local MCP post-processing, so
agents should poll status and then use the returned `service_id` for follow-up
service actions. It is not supported with `expose=true`; expose the service
after attach if needed. Use `create_project`
first when a brand-new app needs a project-scoped Database/Cache/Storage resource before first
boot.

If a repository has valid Compose, Compose is selected by default. Without
Compose, multiple Dockerfiles return `status: "needs_selection"`, code
`DOCKERFILE_SELECTION_REQUIRED`, and `candidate_dockerfiles`. Choose one
`dockerfile_path` per plan. “One Application per plan” does not mean one
Application per Project: repeat with the same `target_project_id` for siblings.
For monorepos, pass `build_context: "."` when a nested Dockerfile copies shared
files from the repository root. Without an explicit value, the Dockerfile's
directory remains the default context for backward compatibility.

| Parameter           | Type    | Required | Description                                                       |
| ------------------- | ------- | -------- | ----------------------------------------------------------------- |
| `service_id`        | string  | No       | Existing Application id                                           |
| `service_name`      | string  | No       | Existing Application name                                         |
| `project_name`      | string  | No       | Existing group lookup or service name scope                       |
| `repo_url`          | string  | No       | Git repository URL for a new app                                  |
| `branch`            | string  | No       | Branch                                                            |
| `name`              | string  | No       | New Project name, or existing project alias                       |
| `source`            | string  | No       | `'git'` or `'image'`                                              |
| `image`             | string  | No       | Docker image                                                      |
| `cmd`               | string  | No       | Command override                                                  |
| `port`              | number  | No       | Container port                                                    |
| `env_vars`          | object  | No       | Environment variables                                             |
| `no_cache`          | boolean | No       | Force fresh build when Docker cache may hide dependency changes   |
| `dockerfile_path`   | string  | No       | Dockerfile path for a new Git Application                         |
| `build_context`     | string  | No       | Build context for a new Git Application                           |
| `docker_target`     | string  | No       | Multi-stage target for a new Git Application                      |
| `target_project_id` | string  | No       | Attach a new Application or Compose workload to an existing group |
| `strategy`          | string  | No       | Redeploy strategy for existing services                           |
| `health_check_path` | string  | No       | Health check path                                                 |
| `traffic_service`   | string  | No       | Compose application used for readiness, URL, and traffic probing  |
| `wait`              | boolean | No       | Block until complete (default: true)                              |
| `timeout`           | number  | No       | Max seconds to wait (default: 300)                                |

### `validate_deploy_plan`

Validate a plan before executing.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `plan_id` | string | Yes      | Plan ID     |

---

## Deployment Controls

### `get_deploy_status`

Get real-time deployment status.

| Parameter      | Type    | Required | Description              |
| -------------- | ------- | -------- | ------------------------ |
| `service_id`   | string  | No       | Application/Compose id   |
| `service_name` | string  | No       | Application/Compose name |
| `project_id`   | string  | No       | Project id               |
| `project_name` | string  | No       | Project name             |
| `deploy_id`    | string  | No       | Completed deploy log id  |
| `job_id`       | string  | No       | Alias for `deploy_id`    |
| `wait`         | boolean | No       | Block until complete     |
| `timeout`      | number  | No       | Max wait seconds         |

Prefer `service_id`/`service_name` for Application/Compose deploys. `project_id`
and `project_name` remain compatibility shortcuts for single-workload Projects.
Use `deploy_id` or `job_id` to distinguish a completed deploy from an unknown id;
unknown ids return `status: "not_found"` instead of the same empty list as
"no active jobs".

### `cancel_deploy`

Cancel an active deployment build.

At least one of `deploy_id`, `service_id`, `service_name`, `project_id`,
`project_name`, or `id` is required. Prefer `service_id` for Application/Compose
deploys. Cancellation targets the resolved runtime build stream.

| Parameter      | Type   | Required | Description                                          |
| -------------- | ------ | -------- | ---------------------------------------------------- |
| `deploy_id`    | string | No       | Deploy log ID                                        |
| `service_id`   | string | No       | Application/Compose id                               |
| `service_name` | string | No       | Application/Compose name                             |
| `project_id`   | string | No       | Project ID                                           |
| `project_name` | string | No       | Project name                                         |
| `id`           | string | No       | Alias for deploy ID, service ID, project ID, or name |

### `get_deploy_history`

Get deployment history.

| Parameter      | Type   | Required | Description               |
| -------------- | ------ | -------- | ------------------------- |
| `service_id`   | string | No       | Application/Compose id    |
| `service_name` | string | No       | Application/Compose name  |
| `project_id`   | string | No       | Project id                |
| `project_name` | string | No       | Project name              |
| `limit`        | number | No       | Max entries (default: 10) |

Prefer `service_id` or `service_name`. Project targets remain compatibility
shortcuts for single-workload Projects.

### `rollback_service`

Rollback an Application to the stored previous Docker image.
This is an image rollback only: it does not restore databases, volumes,
environment variables, secrets, or service configuration.

| Parameter      | Type   | Required | Description                           |
| -------------- | ------ | -------- | ------------------------------------- |
| `service_id`   | string | No       | Application id                        |
| `service_name` | string | No       | Application name                      |
| `project_name` | string | No       | Optional group scope for name lookups |

Provide either `service_id` or `service_name`. If no previous image tag is
available, fix the source/configuration issue and use `update_app` instead.

### `preview_deploy`

Deploy ephemeral preview for a branch.

| Parameter  | Type   | Required | Description        |
| ---------- | ------ | -------- | ------------------ |
| `repo_url` | string | Yes      | Git repository URL |
| `branch`   | string | Yes      | Branch             |

### `cleanup_preview`

Remove a preview deployment.

| Parameter    | Type   | Required | Description |
| ------------ | ------ | -------- | ----------- |
| `preview_id` | string | Yes      | Preview ID  |

### `list_previews`

List active preview deployments. No parameters.

---

## Project Operations

### `create_project`

Create an empty Project before attaching an Application/worker to an existing group or manually
provisioning Database/Cache/Storage resources. This creates no runtime container and
does not set a repository source.

| Parameter      | Type     | Required | Description                  |
| -------------- | -------- | -------- | ---------------------------- |
| `name`         | string   | Yes      | Project slug                 |
| `display_name` | string   | No       | Human-readable display name  |
| `description`  | string   | No       | Optional project description |
| `tags`         | string[] | No       | Optional project tags        |

For a typical new app that needs PostgreSQL/Redis/etc. before first boot, prefer the deploy-plan
approval flow so OpenLander keeps the app and resources on one Project/network. Use this manual
Project-first path only for existing groups, shared/external dependencies, or resource types the
plan cannot auto-provision. Do not deploy with a placeholder connection string just to create the
project.

### `list_projects`

List all projects with status, ports, URLs. No parameters.

`failed_initial_deploy: true` identifies a retained deployment attempt that has failed evidence but
no successful deployment history or running container. Inspect its logs before retrying; if it is
no longer needed, use the existing approval-gated `archive_project` flow. OpenLander does not
auto-delete failed deployment evidence.

When called with a scoped MCP token, the response is filtered before it reaches the agent:
project-scoped tokens see only the scoped Project, and service-scoped tokens see only Projects that
contain the scoped service. For service-scoped tokens, `deployable_service`,
`deployable_services`, and `deployable_service_count` are also reduced to the scoped service so
agents do not receive sibling service identifiers.

## Migration Planning

### `get_migration_snapshot`

Generate an on-demand, provider-neutral migration graph for one Project.

| Parameter    | Type   | Required | Description |
| ------------ | ------ | -------- | ----------- |
| `project_id` | string | Yes      | Project ID  |

The response contains Project identity, Application/Compose and
Database/Cache/Storage resources, formal Service Connections, persistent mount
metadata, domain routes, environment-variable keys, secret-file mount metadata,
runtime-inspection status, and deterministic readiness checks. It does not
contain Markdown, raw logs, environment-variable values, global secrets,
secret-file contents, or data payloads.

This is a read-only preparation step. It does not create cloud resources, copy
database/object/volume data, or change DNS. A project-scoped token may read only
its exact Project; a service-scoped token cannot request this Project-wide
snapshot because it would expose sibling resource metadata. The Web Project
page can download the same snapshot as `migration.json` together with a rendered
`MIGRATION.md` document. The same REST bundle also includes an AWS/GCP target
comparison and rendered `TARGETS.md`; both reuse the snapshot's `generated_at`.

### `compare_migration_targets`

Compare the same redacted Project snapshot against two planning targets:
AWS ECS on Fargate and Google Cloud Run.

| Parameter    | Type   | Required | Description |
| ------------ | ------ | -------- | ----------- |
| `project_id` | string | Yes      | Project ID  |

The response contains per-Service target resource recommendations, persistent
data mappings, supporting configuration/network resources, confidence, manual
review findings, and official provider reference links. It intentionally omits
the full source snapshot and Markdown to keep the MCP response focused.

This query does not inspect a cloud account, region, IAM, quota, or pricing. It
does not provision resources, copy data, or change DNS. MongoDB, MinIO,
Compose, and bind-mount mappings remain review-required rather than being
treated as drop-in compatible. Project-scoped tokens may compare only their
exact Project; service-scoped tokens cannot request a Project-wide comparison.

### `get_migration_runbook`

Generate an operator-reviewed PostgreSQL native dump/restore runbook for one
Project-owned Database and one explicit destination.

| Parameter    | Type   | Required    | Description                                                        |
| ------------ | ------ | ----------- | ------------------------------------------------------------------ |
| `project_id` | string | Yes         | Project ID                                                         |
| `target`     | enum   | Yes         | `aws_rds_postgresql` or `gcp_cloud_sql_postgresql`                 |
| `service_id` | string | Conditional | Project-owned PostgreSQL ID; required when the Project has several |

The JSON response contains required operator inputs, preflight and rehearsal
steps, placeholder-only `pg_dump`/`pg_restore` commands, final write-freeze,
schema/row/sequence/extension/application verification, cutover, and rollback.
Markdown is kept out of MCP; the Web endpoint can download the same generated
runbook as JSON and `RUNBOOK.md`.

This action never executes a command, reads credentials or database contents,
provisions a cloud service, copies data, changes application config or DNS, or
creates activity/evidence rows. It accepts only active PostgreSQL resources
owned by the Project; a connected Database owned by another Project is not a
valid source. Both `project_id` and `service_id` are scope-checked, and
service-scoped tokens cannot request the Project-wide runbook.

### `get_migration_preflight`

Inspect one active Project-owned PostgreSQL source before a managed-cloud
migration rehearsal.

| Parameter    | Type   | Required    | Description                                                        |
| ------------ | ------ | ----------- | ------------------------------------------------------------------ |
| `project_id` | string | Yes         | Project ID                                                         |
| `service_id` | string | Conditional | Project-owned PostgreSQL ID; required when the Project has several |

The response includes the observed PostgreSQL version, database size,
encoding/collation, extensions, bounded role metadata, schema/table/sequence
counts, and an estimated row count. It does not query table row contents or
return source credentials, secret values, raw command output, or Markdown.
`database_access` permission and every supplied Project/Service selector are
enforced before inspection.

Actual dump/restore rehearsal is intentionally absent from MCP. It is available
only in the authenticated Web migration dialog, requires explicit confirmation
of a disposable empty target, verifies the target is actually empty, requires
TLS, and never stores or returns the target password. Rehearsal status is
process-memory only; no cloud provisioning, DNS change, source mutation, or
automatic target cleanup is performed.

### `archive_project`

Archive a Project by archiving its active Applications
while preserving configuration and history. This is a soft lifecycle operation:
it does not delete Database resources, volumes, buckets, or host-wide Docker
resources. Services that were already archived before the group archive remain
tracked separately for restore behavior.

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_id`   | string | No       | Project id   |
| `project_name` | string | No       | Project name |

Provide either `project_id` or `project_name`. A successful initial MCP call
returns `status: "pending_approval"`, `actionRunId` / `action_run_id`, and
`poll_call`; poll `mcp_action_status` after the user approves or rejects the
request. After approval, a real concurrent deployment returns `DEPLOY_LOCKED`
with sanitized blocker evidence in the polled action status; stale stored
`building` markers do not cause `ARCHIVE_BUILDING_PROJECT`.

### `unarchive_project`

Restore the archive set from a Project archive. OpenLander restores the
Applications archived by that Project operation and does **not** redeploy them
automatically; call `update_app` with each `service_id` that should run again.

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_id`   | string | No       | Project id   |
| `project_name` | string | No       | Project name |

Provide either `project_id` or `project_name`. A successful initial MCP call
returns `status: "pending_approval"`, `actionRunId` / `action_run_id`, and
`poll_call`; poll `mcp_action_status` after the user approves or rejects the
request. If execution races with a deployment, the terminal poll response uses
`error_code: "DEPLOY_LOCKED"` and may include `error_details.lock_session`,
`blocked_service_id`, `status_source`, and `operation_phase`.

## Delivery Workspace

Delivery actions live under `openlander_project` and operate on evidence
metadata. They do not activate an internal LLM, upload local binary files, or
finalize a Receipt.

For a local file, call `create_evidence_upload` first. Then send its exact bytes
with `PUT` to the returned short-lived bearer `upload_url`, without an MCP
Authorization header. Do not use an MCP token against the general REST API.

For a customer-facing review, use the higher-level package flow instead of
registering each Artifact role manually:

| Action                               | Required parameters                                                               | Purpose                                                         |
| ------------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| `prepare_delivery_review_package`    | `idempotency_key`, `delivery_id`, `review_note`, `files`, `overview`              | Declare one PDF-led customer review package                     |
| `get_delivery_review_package_status` | `delivery_id`, optional `package_id`, optional `include_upload_capabilities`      | Read uploaded/missing files and mint fresh URLs only when asked |
| `publish_delivery_review_package`    | `idempotency_key`, `package_id`, manifest SHA, expected Delivery evidence version | Publish all prepared files and bind the package to Review       |

`prepare_delivery_review_package` requires exactly one PDF `review_document`.
It may also declare one HTML `interactive_preview` and one PNG/JPEG/WebP
`representative_image`. Agents provide filenames, expected SHA-256 values,
sizes, and MIME types; OpenLander derives logical keys, Artifact kinds, Receipt
order, and HTML companion links. The prepare response contains no bearer URL.

Call `get_delivery_review_package_status` with
`include_upload_capabilities=true` only when ready to upload. Its 15-minute PUT
URLs are returned for missing files and are not stored in operation history.
MCP responses resolve these URLs against the active MCP transport origin, so
agents should use the returned absolute URL rather than a configured default port.
Partial uploads remain staged and do not appear as Delivery Artifacts or change
the active Review Gate. The draft can be resumed for seven days.

`publish_delivery_review_package` verifies the manifest and Delivery evidence
version, then creates the visible Artifacts in one transaction. The same PDF
Artifact is both the HTML companion and the Review Gate target. A package-bound
review must be accepted with its `package_id` and exact manifest SHA-256; legacy
Artifact-only review remains supported during the compatibility period.
Instance, organization, and matching Project tokens may use the three package
actions. Service-scoped tokens receive `SCOPE_VIOLATION` because a review
package is a Project-level object.

When every declared file is ready, the status response's `suggested_call`
includes the required stable `idempotency_key` for `publish_delivery_review_package`.
Image signature failures report both `expectedMimeType` and `actualMimeType` when
the uploaded bytes are a supported PNG, JPEG, or WebP with the wrong declaration.

| Action                              | Required parameters                       | Purpose                                                        |
| ----------------------------------- | ----------------------------------------- | -------------------------------------------------------------- |
| `create_delivery`                   | `project_id`, `title`                     | Create a Delivery and its project-default Gates                |
| `list_deliveries`                   | `project_id`                              | List one Project's Deliveries                                  |
| `get_delivery`                      | `delivery_id`                             | Read artifacts, raw feedback, items, approvals, Gates, deploys |
| `update_delivery_draft`             | `delivery_id`                             | Update title, summary, type, maturity, or limitations          |
| `attach_delivery_url`               | `delivery_id`, `provider`, `label`, `url` | Add optional external evidence metadata                        |
| `record_delivery_feedback`          | `delivery_id`, `source_type`, `raw_text`  | Preserve pasted feedback verbatim                              |
| `submit_delivery_work_item_drafts`  | `delivery_id`, `items`                    | Submit AI/external drafts as `proposed` only                   |
| `record_delivery_gate_result`       | `delivery_id`, `gate_key`, `status`       | Store an external Gate result and optional report artifact     |
| `link_delivery_deploy`              | `delivery_id`, `deploy_id`                | Link same-Project successful Production evidence               |
| `get_delivery_readiness`            | `delivery_id`                             | Return deterministic finalization checks and blockers          |
| `generate_delivery_receipt_preview` | `delivery_id`                             | Build a preview and return page metadata                       |

`record_delivery_gate_result` accepts `summary`, `waiver_reason`,
`report_artifact_id`, and `idempotency_key`. A waiver requires a reason. A
JUnit artifact is normalized by OpenLander, and a report containing failures or
errors cannot be recorded as `passed`. Gate idempotency records are durable:
the same key replays its original response, while using that key with different
request content returns `IDEMPOTENCY_KEY_CONFLICT`.

MCP Agents should call `create_evidence_upload` before referencing an Artifact
ID, then `PUT` the file to the returned bearer URL. The authenticated multipart
endpoint `POST /api/projects/:projectId/deliveries/:deliveryId/artifacts`
remains available to the web UI and supported CI clients. Project PAT uploads
and Gate-result submissions require an `Idempotency-Key` header. Final Receipt
confirmation is administrator web-session only; `finalize_delivery*` MCP
requests return `HUMAN_UI_ONLY`. Finalization also requires the evidence version
to match the most recently generated Receipt preview.

## Agent Delivery Run

Agent Delivery actions live under `openlander_project`. They pin work to an
exact commit, manifest hash, and runner image, so another Agent can inspect or
resume the same execution record without relying on chat history.

| Action                         | Required parameters                                                                                | Purpose                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `plan_delivery`                | `idempotency_key`, `project_id`, `title`, `objective`, `definition_of_done`, `gates`               | Store the Delivery objective, manifest path, and Gates |
| `request_delivery_review`      | `idempotency_key`, `delivery_id`, `gate_key`, `artifact_id`, `expected_sha256`                     | Bind one exact latest Artifact to a Review Gate        |
| `get_delivery_review_status`   | `delivery_id`, `gate_key`                                                                          | Read the compact exact-Artifact review checkpoint      |
| `start_delivery_run`           | `idempotency_key`, `delivery_id`, `commit_sha`, `manifest_path`, `manifest_sha256`, `runner_image` | Start one active Run pinned to exact inputs            |
| `get_delivery_run`             | `run_id`                                                                                           | Read the Run and its ordered progress/handoff events   |
| `run_quality_gates`            | `idempotency_key`, `run_id`                                                                        | Run manifest commands in disposable containers         |
| `record_delivery_run_progress` | `idempotency_key`, `run_id`, `phase`, `summary`                                                    | Record progress or pause with `handoff_summary`        |
| `resume_delivery_run`          | `idempotency_key`, `run_id`, `summary`                                                             | Resume a paused Run with an explicit takeover summary  |
| `cancel_delivery_run`          | `idempotency_key`, `run_id`, `reason`                                                              | Cancel an active Run while preserving its evidence     |
| `complete_delivery`            | `idempotency_key`, `delivery_id`, `run_id`, `release_id`, `promotion_id`, `limitations`            | Finalize Completion Evidence after Production          |

`plan_delivery` defaults `manifest_path` to `.openlander/delivery.yml`. Commit
that file before `start_delivery_run`, then pass the exact Git commit and
SHA-256 of the committed manifest. `run_quality_gates` clones the Project's
single Git-backed Application at that exact commit, verifies the manifest and
runner-image digest, and executes only argv arrays declared in the manifest.
Each attempt records exit code, duration, a redacted-log SHA-256, and an
optional JUnit/Playwright/JSON report artifact. A Delivery can have only one `running` or
`paused` Run. Supplying `handoff_summary` to
`record_delivery_run_progress` pauses the Run; the next Agent must call
`resume_delivery_run` before continuing. Commands require a stable
`idempotency_key`; exact retries replay the stored result and changed payloads
return `OPERATION_IDEMPOTENCY_CONFLICT`.

`request_delivery_review` verifies that `artifact_id` belongs to the Delivery,
is the latest non-superseded revision for its logical key and kind, and has the
exact `expected_sha256`. It then binds that Artifact to the selected `review`
Gate as `pending`. `get_delivery_review_status` returns only the bound Artifact
identity, revision, SHA-256, Gate state, active approval-evidence ID, and
machine-readable blockers.

`ready_for_next_step=true` means the exact Artifact revision passed or was
explicitly waived at this review checkpoint. It is permission to continue the
domain-specific workflow, not evidence that an external import, deployment, or
other side effect already ran. Delivery-level customer approval and Receipt
Readiness remain separate checks.

Acceptance itself is intentionally absent from the MCP catalog. A signed-in
reviewer uses **Accept this version** in the Delivery Gates tab; the underlying
`accept_delivery_review` Application Operation rejects MCP and raw REST API-token
actors with `OPERATION_REQUIRES_HUMAN_UI`.

## Project Manifest

`register_project_repository` takes `project_id`, `repo_url`, and `branch`, then creates the Project's
single stopped Git Application record without cloning, building, or deploying it.
Use it when requirements and quality work start before an Environment has been
chosen. It rejects Projects that already contain a different Application source;
changing an existing source remains `update_application_source`.

`apply_project_manifest` applies `.openlander/project.yml` through
`openlander_project`. It stores the exact path, SHA-256, optional Service
composition, Project Environment policy, and optional weekly-report schedule.
It synchronizes stable Environment keys, display names, tiers, Promotion order,
health/Smoke/soak policy, and the manifest SHA-256. The manifest must have
unique keys and orders and exactly one `production` Environment. Removed
entries are not deleted automatically, so an Agent cannot orphan a running
Environment merely by changing Git configuration.

`get_project_manifest(project_id)` compares that applied snapshot with current
Service and Environment rows. It returns `in_sync`, `drifted`, or `not_applied`
plus machine-readable `missing`, `retained`, and `changed` entries. The Web
Delivery view renders the same comparison instead of offering an Environment
authoring form.

Each Environment may also declare `health_timeout_seconds` (1–600), an optional
absolute `smoke_path`, and `soak_seconds` (0–3600). Promotion waits for container
health, probes the exposed local port when a Smoke path is present, waits the
soak window, then repeats health and Smoke checks before recording success.

## Release and Promotion

Release actions live under `openlander_deploy`. A Release builds one immutable
image digest per Git-backed service and reuses those exact service digests
across every Environment.

| Action                 | Required parameters                                       | Purpose                                             |
| ---------------------- | --------------------------------------------------------- | --------------------------------------------------- |
| `create_release`       | `idempotency_key`, `run_id`, `version`                    | Build one Release after required quality Gates pass |
| `get_release`          | `release_id`                                              | Read artifacts and Promotion history                |
| `promote_release`      | `idempotency_key`, `release_id`, `project_environment_id` | Deploy the existing digest to the next Environment  |
| `evaluate_promotion`   | `promotion_id`                                            | Read health, soak, deploy IDs, and failure details  |
| `recall_release`       | `idempotency_key`, `release_id`                           | Block additional Promotion of a ready Release       |
| `rollback_environment` | `idempotency_key`, `project_environment_id`               | Restore the previous successful Release digest      |

All services in one Agent Run must share the same repository and commit;
unrelated repositories require separate Deliveries. `promote_release` never rebuilds. A missing image fails with
`ARTIFACT_UNAVAILABLE`; a changed image identifier fails with
`ARTIFACT_DIGEST_MISMATCH`. Environments must be promoted in manifest order.
The asynchronous create and promote commands return compact `status_call`
links for `get_release` and `evaluate_promotion`.

## Weekly Reporting

Weekly reporting lives under `openlander_project` but requires an
instance/organization-scoped token because one Engagement may contain multiple
Projects.

| Action                   | Required parameters                                              | Purpose                                                        |
| ------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------- |
| `generate_weekly_report` | `idempotency_key`, `engagement_id`, `period_start`, `period_end` | Freeze a one-to-eight-day Engagement evidence snapshot         |
| `publish_weekly_report`  | `idempotency_key`, `report_id`                                   | Render internal and customer HTML/PDF from that exact snapshot |
| `get_weekly_report`      | `report_id`                                                      | Read revision, publication state, blob IDs, and SHA-256 values |

`period_start` and `period_end` use `YYYY-MM-DD`. A published report is
immutable; changed evidence produces another revision. The internal view may
include Agent Run phases, check log hashes, Activity, and technical failure
details. The customer view contains outcomes, Project and Delivery status,
Release/Environment status, and open-issue titles, but excludes check details
and internal Activity. Both views retain their own PDF SHA-256 and point back
to one `evidence_sha256`.

## Engagement Portfolio

Engagement Portfolio adds six idempotent mutation commands and two read actions
to `openlander_project`.
Engagements are internal FDE classification and observability records, not
customer accounts. They group existing Projects without changing Project
runtime, Delivery evidence, or finalized Receipt snapshots.

| Action                           | Required parameters                                    | Purpose                                                      |
| -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| `bootstrap_engagement`           | `idempotency_key`, `customer_name`, `title`, `project` | Atomically create an Engagement and its initial Project      |
| `update_engagement_from_brief`   | `idempotency_key`, `engagement_id`                     | Apply agent-structured brief fields with source artifact IDs |
| `link_project_to_engagement`     | `idempotency_key`, `engagement_id`, `project_id`       | Add one existing Project to an active Engagement             |
| `unlink_project_from_engagement` | `idempotency_key`, `engagement_id`, `project_id`       | Remove membership without changing the Project or evidence   |
| `archive_engagement`             | `idempotency_key`, `engagement_id`                     | Archive the portfolio record while preserving Project links  |
| `unarchive_engagement`           | `idempotency_key`, `engagement_id`                     | Restore an archived Engagement to active status              |
| `list_engagements`               | None                                                   | List runtime health, Delivery status counts, and blockers    |
| `get_engagement`                 | `engagement_id`                                        | Read linked Project health and compact blocker identifiers   |

Portfolio reads and Engagement-wide mutations require an instance/organization-
scoped MCP token. `link_project_to_engagement` and
`unlink_project_from_engagement` also accept a project-scoped token when the
input `project_id` exactly matches that token; sibling Project access and all
service-scoped access return `SCOPE_VIOLATION`. Mutations are backed by the same
Application Operations available at `POST /api/v1/operations/:name`; MCP and
REST do not call one another. Use Delivery actions to retrieve artifacts,
feedback, Gate evidence, and Receipt metadata.

## Evidence intake and structured project updates

| Action                   | Required parameters                                                            | Purpose                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `create_evidence_upload` | `idempotency_key`, Project/Delivery IDs, filename, logical key, revision, kind | Issue a 15-minute upload capability and reserve an artifact ID                                                      |
| `record_project_update`  | `idempotency_key`, Project ID, summary, source, entries or transitions         | Record durable decisions, actions, risks, questions, dependencies, progress, and facts without requiring a Delivery |
| `get_project_context`    | Project ID                                                                     | Read current decisions, open items, changed Delivery context, and the 10 most recent updates                        |
| `get_project_update`     | Project ID, update ID                                                          | Read one immutable update with full sources, items, transitions, and Delivery links                                 |

`create_evidence_upload` returns an absolute HTTP `upload_url`, `PUT` method,
expiry, size limit, and the reserved `artifact_id`. The URL is a bearer
capability: do not log or share it. Send the file bytes to that URL without an
MCP Authorization header. Uploading validates type, size, hash, Project
ownership, Delivery mutability, and artifact revision. Replaying the same upload
is idempotent.

`record_project_update` also accepts meeting labels, HTTP(S) URLs, and
repository/WBS-relative paths, so agents can record collaboration context before
a Delivery exists. Update bodies are immutable. Correct earlier information by
recording a new Update and resolving, dismissing, or superseding the earlier
item with its expected status. `get_project_context` is the compact handoff read;
use scoped help for its bounded response schema, then call `get_project_update`
only when full source details are needed. These durable records, rather than the
30-day Activity log, feed internal weekly reports. Customer reports expose only
the count of open confirmation items and do not include repository paths, WBS
paths, actor identity, or internal detail.

When an implementation slice is ready, pass the relevant current item IDs as
`plan_delivery.source_project_update_item_ids`. OpenLander snapshots each item's
status and update timestamp with the Delivery. If that Project context later
changes, Delivery reads return `context_changed=true` and the Project context
query lists the affected Delivery IDs. This is a review warning only; it does
not fail Gates or change Delivery status automatically.

### `update_app` / `redeploy_app` / `restart_service`

Update or restart an Application. Use `update_app` for the normal "ship the
latest stored source/image/config" intent on an existing app. `redeploy_app`
remains as a compatibility/advanced alias over the same deploy primitive.
`restart_service` runs Docker restart against the existing long-running
Application/resource container. It does not clone, build, replace, or remove the
container, and the container ID stays the same. One-shot jobs return
`SERVICE_OPERATION_UNSUPPORTED`; use `update_app(strategy="force")` when an image
replacement is actually required.
Project-level runtime actions have been removed. Git-based dependency installs
get a targeted dependency-layer refresh; `no_cache=true` remains the manual
full-cache bypass for update/redeploy. The legacy `restart_service.no_cache`
input remains accepted for compatibility but is ignored because restart does
not build an image.

| Parameter           | Type    | Required | Description                                                                                              |
| ------------------- | ------- | -------- | -------------------------------------------------------------------------------------------------------- |
| `service_id`        | string  | No       | Application id                                                                                           |
| `service_name`      | string  | No       | Application name                                                                                         |
| `project_name`      | string  | No       | Optional group scope for name lookups                                                                    |
| `no_cache`          | boolean | No       | Force fresh build when Docker cache may hide dependency changes                                          |
| `strategy`          | string  | No       | Defaults to `'blue-green'` when eligible; falls back to `'force'` otherwise                              |
| `health_check_path` | string  | No       | Health check path                                                                                        |
| `env_vars`          | object  | No       | Inline env vars to save before update/redeploy; user-input-gated fields can return `USER_INPUT_REQUIRED` |

Provide either `service_id` or `service_name`.

When `update_app` changes an existing Stateful Compose child, it returns
`status: "pending_approval"`, `action_run_id`, a secret-free `diff`,
`backup_required: true`, and `poll_call`; it does not report deploy success.
Pending Approvals shows the changed fields, backup requirement, and data
preservation effect. Approval is rejected as `STATEFUL_APPROVAL_STALE` if the
commit, Compose fingerprint, or current container changed while waiting.
PostgreSQL major/image-family, volume source/target, and runtime-role changes
return `STATEFUL_MIGRATION_REQUIRED` and require a dedicated migration.

A successful `restart_service` returns `status: "restarted"`, `project_id`,
`service_id`, the unchanged `container_id`, and a `diagnostic_call` for
`diagnose_service`.

`strategy="blue-green"` is conditional. It is rejected with
`BLUE_GREEN_UNSUPPORTED` when requested explicitly for compose stacks, services
without a current running container, services without a health check or explicit
`health_check_path`, and installations not using managed OpenLander/Traefik
HTTP-provider routes. When `strategy` is omitted, `update_app` and
`redeploy_app` automatically use blue-green for eligible services and fall back
to `force` otherwise. If `force` is used explicitly or as a fallback, do not
report success until `get_deploy_status` reaches a terminal state and
`diagnose_service` confirms health. The zero-downtime guarantee applies to
OpenLander domain/Traefik routes only; direct `localhost:{assigned_port}` URLs
may change during deploy.

Blue-green is best-effort. OpenLander health-checks the green container directly,
flips the active route target, waits for the managed Traefik HTTP provider
polling window, probes the public route, and keeps blue until green survives a
post-switch stability window before removing blue. It does not yet prove that the
successful HTTP response came from green via a Traefik API resolved-target check
or app version marker.

For blue-green, make `health_check_path` a readiness endpoint, not a static page.
If the service needs a database, cache, storage bucket, or other dependency to
serve real traffic, the readiness endpoint should check those dependencies before
returning 2xx.

If blue-green fails while the previous version is still serving, treat it as a
safe failed update. Inspect diagnostics and fix source/config before trying
another update; do not immediately force the failed candidate over the serving
version unless the user explicitly accepts downtime.

### `archive_service`

Archive an Application while preserving configuration and
history. This is the MCP-safe cleanup path when an agent created the wrong app
or the user asks to clean up a deployable. It stops/removes the runtime and
waits for human approval before executing. It does **not** permanently delete
Database resources, volumes, buckets, or host-wide Docker resources.

| Parameter      | Type   | Required | Description                           |
| -------------- | ------ | -------- | ------------------------------------- |
| `service_id`   | string | No       | Application id                        |
| `service_name` | string | No       | Application name or group name        |
| `project_name` | string | No       | Optional group scope for name lookups |

Provide either `service_id` or `service_name`. A successful initial MCP call
returns `status: "pending_approval"`, `actionRunId` / `action_run_id`, and
`poll_call`; poll `mcp_action_status` after the user approves or rejects the
request.

### `list_archived_services`

List archived Applications in a Project. Use this after
`archive_service` / `archive_project`, or when the user asks what can be
restored or permanently deleted. It returns Applications only; managed
databases, caches, buckets, volumes, and host resources are excluded.

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_id`   | string | No       | Project id   |
| `project_name` | string | No       | Project name |

Provide either `project_id` or `project_name`. Hard delete remains web
UI-only; this action is a read-only way for agents to inspect reversible
archive state before suggesting restore or human UI deletion.
Each service item includes `available_actions.restore` (MCP approval via
`unarchive_service`) and `available_actions.permanent_delete` (`web_ui_only`,
Project Settings > Danger > Archived services, including the typed confirmation
string the human must enter).

### `unarchive_service`

Restore an archived Application while preserving the same
configuration and history. This reverses `archive_service` after human approval
and does **not** redeploy automatically; call `update_app` if the service
should run again.

| Parameter      | Type   | Required | Description                           |
| -------------- | ------ | -------- | ------------------------------------- |
| `service_id`   | string | No       | Application id                        |
| `service_name` | string | No       | Application name or group name        |
| `project_name` | string | No       | Optional group scope for name lookups |

Provide either `service_id` or `service_name`. A successful initial MCP call
returns `status: "pending_approval"`, `actionRunId` / `action_run_id`, and
`poll_call`; poll `mcp_action_status` after the user approves or rejects the
request.

### `expose_public` / `unexpose_public`

Canonical managed-sharing actions under `openlander_service`. The default
`provider=protected_share` publishes a stable HTTPS URL behind an OpenLander access-code gate.
Set `provider=cloudflare` to use Connected Publish instead; that path has no OpenLander access-code
screen. Cloudflare publishing returns `provisioning` with `public_url: null` until OpenLander has
actually reached the HTTPS URL. It retries propagation checks in the background; poll
`get_public_access` through the returned `status_call` and report the URL only after `status` is
`public`. Unpublishing retains the provider's hostname reservation for reuse.

| Parameter      | Type   | Required | Description                                             |
| -------------- | ------ | -------- | ------------------------------------------------------- |
| `service_id`   | string | No       | Preferred Application/Compose id                        |
| `service_name` | string | No       | Application/Compose name                                |
| `project_id`   | string | No       | Project id; initial publish must resolve one workload   |
| `project_name` | string | No       | Project name; initial publish must resolve one workload |
| `provider`     | string | No       | `protected_share` (default) or `cloudflare`             |

Provide at least one selector. Deploy and redeploy never publish automatically.
Cloudflare account connection and full disconnection remain human UI workflows;
there is no MCP action for deleting the shared Tunnel, DNS reservations, connector, or OAuth token.

### `update_service_config`

Save Application build configuration or Compose deployment selection. Changes are applied by a
subsequent `update_app`. Compose paths are repository-relative and `compose_files` are ordered from
the base file to overlays.

| Parameter          | Type     | Required | Description                                                    |
| ------------------ | -------- | -------- | -------------------------------------------------------------- |
| `service_id`       | string   | No       | Application/Compose id                                         |
| `service_name`     | string   | No       | Application/Compose name                                       |
| `project_name`     | string   | No       | Optional group scope for name lookups                          |
| `dockerfile_path`  | string   | No       | Dockerfile path                                                |
| `docker_target`    | string   | No       | Build target                                                   |
| `build_context`    | string   | No       | Build context path                                             |
| `compose_file`     | string   | No       | One repository-relative Compose file                           |
| `compose_files`    | string[] | No       | Ordered base-to-overlay Compose files; replaces `compose_file` |
| `compose_profiles` | string[] | No       | Active profiles; an empty array clears the selection           |
| `compose_services` | string[] | No       | Selected services; an empty array selects all                  |
| `traffic_service`  | string   | No       | Application service representing public traffic                |
| `environment`      | string   | No       | `production` or `development`                                  |
| `resource_profile` | string   | No       | `micro`, `small`, `medium`, `large`, or `custom`               |
| `memory_mb`        | number   | No       | Custom memory in MB; requires `resource_profile: "custom"`     |

`compose_file` and `compose_files` cannot be supplied together. Compose-specific fields are valid
only for the Compose parent service; child services and non-Compose Applications are rejected.
Resource profiles apply to any Application or Compose workload. The saved limit takes effect on the next
`update_app`; OpenLander rejects limits above 80% of host memory.

### `update_application_source`

Save Application/Compose source settings without deploying. This is the MCP path
for changing an existing app's Git repo, branch, image, image command, or saved
container port. It does **not** start Docker, acquire a deploy lock, mutate live
routes, or deploy automatically; call `update_app` after the update.

| Parameter        | Type     | Required | Description                                                                  |
| ---------------- | -------- | -------- | ---------------------------------------------------------------------------- |
| `service_id`     | string   | No       | Application/Compose id                                                       |
| `service_name`   | string   | No       | Application/Compose name                                                     |
| `project_name`   | string   | No       | Optional group scope, or a single-workload Project shortcut                  |
| `source`         | string   | No       | `git` or `image`                                                             |
| `repo_url`       | string   | No       | Git repository URL. Requires `source=git` or no explicit image source        |
| `branch`         | string   | No       | Git branch. Requires `source=git` or no explicit image source                |
| `image`          | string   | No       | Container image reference. Requires `source=image` or no explicit Git source |
| `cmd`            | string[] | No       | Image start command saved for the next redeploy                              |
| `container_port` | number   | No       | Saved container port for the next redeploy; live routes are not changed      |

Provide `service_id`, `service_name`, or `project_name` when the Project has
exactly one workload. Git source fields cannot be mixed with `source="image"`,
and image fields cannot be mixed with `source="git"`. Compose parents support
Git repo/branch/container-port updates but cannot switch to image source.

### `apply_route_config`

Apply a live route configuration change without rebuilding the image or
recreating the container. In v0.1.x this supports `container_port` re-pointing
for running Applications behind the managed Traefik HTTP provider.

| Parameter        | Type   | Required | Description                                     |
| ---------------- | ------ | -------- | ----------------------------------------------- |
| `service_id`     | string | No       | Application id                                  |
| `service_name`   | string | No       | Application name                                |
| `project_name`   | string | No       | Optional group scope for name lookups           |
| `container_port` | number | Yes      | Port the container listens on inside Docker DNS |

Provide either `service_id` or `service_name`. This is intended for high-confidence
diagnosis such as "the app logs say it listens on 4000, but the route points to
3000." It does not start a build or redeploy.

The response includes `route_verification`. If the service has a
`health_check_path`, OpenLander probes the managed Traefik HTTP-provider route
after the update and returns `status: "verified"` on success. If that probe
fails, OpenLander restores the previous `container_port` and returns
`status: "rolled_back"` with `route_verification.status: "failed"`. Services
without a configured health path return `route_verification.status: "skipped"`
and keep the usual `diagnostic_call` for follow-up inspection.

When the Application has custom domain routes, the response also includes
`domain_route_health`. OpenLander probes those Host routes through the managed
Traefik HTTP provider after the port change. HTTP 5xx or probe failures roll
the port change back; HTTP 4xx is reported as a warning because some apps do not
serve `/` or the route prefix as a health endpoint.

---

## Environment Variables & Secrets

### `list_env_vars` / `get_env_var`

| Parameter      | Type    | Required       | Description                                        |
| -------------- | ------- | -------------- | -------------------------------------------------- |
| `service_id`   | string  | No             | Application id                                     |
| `service_name` | string  | No             | Application name                                   |
| `project_name` | string  | No             | Convenience target for single-Application Projects |
| `key`          | string  | Yes (get only) | Env var key                                        |
| `reveal`       | boolean | No (list only) | Return raw values instead of masked values         |

Env vars belong to Applications. Prefer `service_id` or `service_name`; `project_name`
is accepted only when the Project has exactly one Application, otherwise the tool
returns `SERVICE_SELECTION_REQUIRED` with candidates. `list_env_vars` masks by default.
`NEXT_PUBLIC_*`, `PUBLIC_*`, `VITE_PUBLIC_*`, and `NUXT_PUBLIC_*` are treated as public and
are not masked. Empty strings render as `""`; missing single-key lookups throw `NOT_FOUND`.

### `set_env_vars`

| Parameter        | Type    | Required | Description                                        |
| ---------------- | ------- | -------- | -------------------------------------------------- |
| `service_id`     | string  | No       | Application id                                     |
| `service_name`   | string  | No       | Application name                                   |
| `project_name`   | string  | No       | Convenience target for single-Application Projects |
| `variables`      | object  | Yes      | Key-value pairs; values must be strings            |
| `defer_redeploy` | boolean | No       | Default `true`; pass `false` to apply immediately  |

`set_env_vars` is an upsert keyed by `(service_id, key)`. It saves only by default and returns
`changed: [{ key, op }]`, where `op` is `insert`, `update`, or `noop`. `null` values are rejected
with `BAD_REQUEST`; `""` stores an explicit empty value. To apply saved changes to a running
container, call `update_app`, or pass `defer_redeploy=false`. Runtime-only env changes are applied
with a verified same-image recreate (`apply_mode: same_image_recreate`); build-time keys such as
`NEXT_PUBLIC_*`, `VITE_*`, `REACT_APP_*`, `NUXT_PUBLIC_*`, `PUBLIC_*`, and `GATSBY_*` still require a
full redeploy (`apply_mode: full_redeploy`).

If a field is pending user input from `diagnose_service`, MCP `set_env_vars` returns
`USER_INPUT_REQUIRED` before writing env or starting any apply/redeploy path. This includes
Project-scoped writes when any service in that Project is awaiting the same field. Use the
`report_to_user` message and wait for the operator to supply the value through the web UI.

Immediate applies include `runtime_apply`. For same-image recreates, `runtime_apply.status`
is `verified` when route verification passed, `applied` when the recreate succeeded but
route verification was skipped because no health path is configured, and `failed` when
the runtime apply did not complete. Failed same-image applies include
`previous_version_still_serving` and `fallback: "redeploy_app"` so agents can inspect
before escalating to a full rebuild. Build-time env updates return
`runtime_apply: { mode: "full_redeploy", status: "started" }`.

### `export_env_vars`

| Parameter      | Type   | Required | Description                                        |
| -------------- | ------ | -------- | -------------------------------------------------- |
| `service_id`   | string | No       | Application id                                     |
| `service_name` | string | No       | Application name                                   |
| `project_name` | string | No       | Convenience target for single-Application Projects |

Exports all service env vars as raw `.env` text and records an audit event without storing raw values in the audit log.

### `delete_env_var` / `bulk_delete_env_vars`

| Parameter        | Type     | Required            | Description                                        |
| ---------------- | -------- | ------------------- | -------------------------------------------------- |
| `service_id`     | string   | No                  | Application id                                     |
| `service_name`   | string   | No                  | Application name                                   |
| `project_name`   | string   | No                  | Convenience target for single-Application Projects |
| `key`            | string   | Yes (single delete) | Env var key                                        |
| `keys`           | string[] | Yes (bulk delete)   | Env var keys                                       |
| `confirm`        | boolean  | Yes (bulk apply)    | Omit or pass `false` for dry-run preview only      |
| `defer_redeploy` | boolean  | No                  | Default `true`; pass `false` to apply immediately  |

`bulk_delete_env_vars` without `confirm=true` returns `{ would_delete, not_found, count_to_delete, confirm_required: true }` and makes no changes.
Confirmed deletes with `defer_redeploy=false` use the same runtime-only same-image recreate path
when no build-time env key is involved.

### `set_global_secret` / `list_global_secrets`

| Parameter     | Type   | Required | Description  |
| ------------- | ------ | -------- | ------------ |
| `key`         | string | Yes      | Secret key   |
| `value`       | string | Yes      | Secret value |
| `description` | string | No       | Description  |

Legacy clients may still call `expose_public`, `get_public_access`, and `unexpose_public` through
`openlander_project`, but those compatibility routes are hidden from its general `help` output.
New agents should use the canonical `openlander_service` actions documented above.

### `upload_secret_file` / `list_secret_files` / `remove_secret_file`

| Parameter      | Type   | Required     | Description                         |
| -------------- | ------ | ------------ | ----------------------------------- |
| `project_name` | string | No           | Project name (omit for global)      |
| `filename`     | string | Yes          | Filename                            |
| `content`      | string | Yes (upload) | File content                        |
| `mount_path`   | string | No           | Mount dir (default: `/run/secrets`) |

---

## Services & Infrastructure

### `create_service`

| Parameter      | Type   | Required | Description                                                             |
| -------------- | ------ | -------- | ----------------------------------------------------------------------- |
| `name`         | string | Yes      | Service name                                                            |
| `template`     | string | No       | `postgresql`, `mysql`, `redis`, `mongodb`, `neo4j`, `rabbitmq`, `minio` |
| `image`        | string | No       | Custom Docker image                                                     |
| `port`         | number | No       | Port number                                                             |
| `project_id`   | string | No       | Attach to this Project id                                               |
| `project_name` | string | No       | Attach to this Project name                                             |

`create_service` requires `project_id` or `project_name`. This keeps new
databases/caches attached to the isolated project Docker network used by the app
that will consume them. Cross-project shared Database/Cache/Storage resources are not exposed in
v0.1, and OpenLander does not expose Database/Cache resource ports over external
TCP. Create the service with the target app's `project_id` or `project_name`.
The standalone action saves compatible connection env vars on the target workload
when one exists and returns the same values in `suggested_env`. It does not
redeploy the app; call `update_app` to apply them to a running workload.

For PostgreSQL extension images, `create_service` keeps `DATABASE_URL` as the sole connection
secret and returns implementation guidance based on the selected image family:

| Image family                 | Optional application selector          | Boundary               |
| ---------------------------- | -------------------------------------- | ---------------------- |
| `pgvector/pgvector`          | `VECTOR_STORE_BACKEND=pgvector`        | `VectorStore`          |
| `apache/age`                 | `GRAPH_STORE_BACKEND=age`              | `GraphRepository`      |
| `postgis/postgis`            | `SPATIAL_STORE_BACKEND=postgis`        | `SpatialRepository`    |
| `timescale/timescaledb[-ha]` | `TIMESERIES_STORE_BACKEND=timescaledb` | `TimeSeriesRepository` |

OpenLander does not auto-inject these selectors or duplicate `DATABASE_URL` under capability-specific
names. The selected Docker image must contain extension binaries; versioned application migrations
own `CREATE EXTENSION IF NOT EXISTS` and runtime code keeps extension-specific SQL behind its
adapter/repository boundary.

The `neo4j` template provisions Neo4j Community with Bolt port `7687` and a
persistent `/data` volume. Its `suggested_env` contains `NEO4J_URI`,
`NEO4J_USERNAME`, and `NEO4J_PASSWORD`. OpenLander disables the HTTP Browser
server and does not expose Enterprise multi-database features. Generic volume backup/restore
and database/user creation actions return `SERVICE_OPERATION_UNSUPPORTED` for Neo4j.

For a new MinIO connection, the `minio` template returns `OBJECT_STORAGE_PROVIDER`,
`OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_ACCESS_KEY`, and `OBJECT_STORAGE_SECRET_KEY`. The
returned `_agent_guidance` tells agents to map those values to the selected provider SDK inside an
infrastructure adapter, configure bucket/prefix separately, and persist logical store + object key
references instead of provider URLs. Existing Projects keep any stored `S3_ENDPOINT` / `AWS_*`
values; OpenLander does not auto-rename or remove them. Automatic legacy aliases are not added to a
new connection.

### `list_services`

| Parameter         | Type    | Required | Description                                     |
| ----------------- | ------- | -------- | ----------------------------------------------- |
| `include_orphans` | boolean | No       | Include unmanaged OpenLander service containers |

`include_orphans=true` surfaces OpenLander resource containers that still exist in Docker but are missing from the `services` table.

MCP `list_services` intentionally omits credential values. Use `get_service_credentials` for connection strings, users, passwords, and database names.
Project-scoped rows include `kind`, `attached_project_id`, and `attached_project_name` so agents can tell which app project can reach the database/cache over its Docker network.

### `get_service_status`

| Parameter      | Type   | Required | Description                          |
| -------------- | ------ | -------- | ------------------------------------ |
| `service_id`   | string | No       | Database/Cache/Storage resource id   |
| `service_name` | string | No       | Database/Cache/Storage resource name |

Provide either `service_id` or `service_name`. Applications are intentionally rejected; use `openlander_service` or `diagnose_service` for those.

### `start_service` / `stop_service`

| Parameter      | Type   | Required | Description                          |
| -------------- | ------ | -------- | ------------------------------------ |
| `service_name` | string | Yes      | Database/Cache/Storage resource name |

### `exec_service_container`

| Parameter         | Type     | Required | Description                          |
| ----------------- | -------- | -------- | ------------------------------------ |
| `service_name`    | string   | Yes      | Database/Cache/Storage resource name |
| `command`         | string[] | Yes      | Command argv array                   |
| `timeout_seconds` | number   | No       | Max execution time                   |

`command` must be an argv array such as `["psql", "-U", "openlander", "-c", "SELECT 1"]`.
Shell strings like `"psql -U openlander"` are intentionally rejected.
Do not use this action to package-install PostgreSQL extensions into a running container. Select a
reviewed Docker image containing the extension, activate it through a versioned database migration,
and use this action only for bounded verification when necessary.

`remove_service` follows the effective destructive-action permission. It executes when allowed,
enters the human approval queue when approval is required, and returns
`OPERATION_PERMISSION_DENIED` when blocked. Project/Application hard delete remains a separate
human-UI-only flow.

### `get_service_credentials`

| Parameter      | Type   | Required | Description                          |
| -------------- | ------ | -------- | ------------------------------------ |
| `service_id`   | string | No       | Database/Cache/Storage resource id   |
| `service_name` | string | No       | Database/Cache/Storage resource name |

Provide either `service_id` or `service_name`.

### Project-Aware Data Inspector

`list_data_sources`, `describe_data_source`, and `read_data_source` let an
agent inspect Project-connected managed Postgres/Redis resources without
receiving database credentials. This is not a general SQL editor, not a write
path, and not an external RDS/Atlas/Upstash connector. The web UI owns the
human enable/disable switch under Project Settings → Data Access; MCP reads
return `DATA_ACCESS_NOT_ENABLED` until that access is enabled.

Data-source identifiers are managed `service_id` values. The actions require an
explicit Project or service target so normal scoped-token checks run before
execution. Service-scoped tokens cannot read data sources in v1; use a
Project-scoped or instance token. Query results are capped, timed out, and not
stored. OpenLander writes an activity-log audit row with the operation, query
hash, literal-masked preview, duration, row/item count, and truncation flag, but
not result values.

#### `list_data_sources`

| Parameter         | Type   | Required | Description                             |
| ----------------- | ------ | -------- | --------------------------------------- |
| `project_id`      | string | No       | Project id                              |
| `project_name`    | string | No       | Project name                            |
| `environment_key` | string | No       | Reserved for future environment support |

Returns managed Postgres/Redis sources attached to the Project and external
database/cache URL env vars as `external_requires_setup` placeholders. It never
returns passwords, connection strings, or raw credential fields.

#### `describe_data_source`

| Parameter    | Type          | Required | Description                              |
| ------------ | ------------- | -------- | ---------------------------------------- |
| `service_id` | string        | Yes      | Managed Postgres/Redis service id        |
| `database`   | string/number | No       | Postgres database name or Redis DB index |
| `schema`     | string        | No       | Postgres schema name, default public     |

For Postgres, returns schema/table/column metadata. For Redis, returns keyspace
metadata, database size, and sample key names only. Managed Redis credentials
are used internally; passwords and connection strings are never returned.

#### `read_data_source`

| Parameter    | Type          | Required | Description                              |
| ------------ | ------------- | -------- | ---------------------------------------- |
| `service_id` | string        | Yes      | Managed Postgres/Redis service id        |
| `operation`  | string        | Yes      | `sql.query` or a Redis read op           |
| `query`      | string        | SQL only | Single SELECT/read-only WITH query       |
| `database`   | string/number | No       | Postgres database name or Redis DB index |
| `limit`      | number        | No       | Default 50, max 100                      |
| `key`        | string        | Redis    | Key for get/type/ttl/hgetall             |
| `keys`       | array         | Redis    | Keys for mget                            |
| `pattern`    | string        | Redis    | SCAN pattern, default `*`                |

Postgres uses a dedicated read-only role created by OpenLander when Agent read
access is enabled. SQL text checks are a UX guard only; the read-only database
role is the real boundary. `INSERT`, `UPDATE`, `DELETE`, `COPY`, DDL, grants,
stored-procedure calls, psql backslash commands, and multiple statements are
blocked before execution. Redis does not accept arbitrary command strings; only
`redis.get`, `redis.mget`, `redis.type`, `redis.ttl`, `redis.hgetall`, and
`redis.scan` are expressible. If a Postgres result exceeds the response byte cap,
`read_data_source` returns `DATA_RESULT_TOO_LARGE` instead of returning partial
or malformed row data.

Blocked responses are structured for agents. They include `report_to_user`,
`safe_alternatives`, and `_agent_guidance.next_steps` so an agent can stop,
explain what happened, and avoid retrying unsafe queries or asking for raw
credentials. Redis auth failures return `DATA_REDIS_AUTH_FAILED`; invalid Redis
DB indexes return `DATA_REDIS_DB_INVALID` before any container command runs.

### `get_service_logs`

| Parameter      | Type   | Required | Description                   |
| -------------- | ------ | -------- | ----------------------------- |
| `service_name` | string | Yes      | Service name                  |
| `lines`        | number | No       | Number of lines (default: 50) |

### Database User Operations

`create_service_user`

| Parameter       | Type   | Required   | Description               |
| --------------- | ------ | ---------- | ------------------------- |
| `service_name`  | string | Yes        | Service name              |
| `database_name` | string | Yes        | Database name             |
| `username`      | string | Yes (user) | Username                  |
| `password`      | string | No         | Auto-generated if omitted |

The Database resource itself is provisioned by `create_service` (template `postgresql` /
`mysql` / `mongodb`). `create_database` and `list_databases` are not exposed on the MCP
composite surface — calling them over MCP returns `UNKNOWN_ACTION`.

### MinIO Bucket Operations

`create_bucket` / `list_buckets` / `delete_bucket`

| Parameter      | Type   | Required | Description        |
| -------------- | ------ | -------- | ------------------ |
| `service_name` | string | Yes      | MinIO service name |
| `bucket_name`  | string | Yes      | Bucket name        |

`create_bucket` and `list_buckets` are MCP-executable. `delete_bucket` follows the effective
destructive-action permission: allow, approval hold, or block.

`create_bucket` returns portability guidance with the created bucket. Agents should configure
`OBJECT_STORAGE_BUCKET` and optional `OBJECT_STORAGE_PREFIX` at the application infrastructure
boundary, keep S3/MinIO credentials behind an adapter, and avoid persisting provider URLs as
business data. Existing legacy keys remain untouched unless the user explicitly migrates the
application adapter. This guidance does not provision an AWS/GCP bucket or copy objects.

### Backup Operations

`backup_service` / `restore_service` / `list_service_backups`

| Parameter      | Type   | Required      | Description  |
| -------------- | ------ | ------------- | ------------ |
| `service_name` | string | Yes           | Service name |
| `backup_id`    | string | Yes (restore) | Backup ID    |

`list_service_backups.backups[].createdAt` is always an ISO-8601 string.

---

## Domains

### `add_domain_route`

| Parameter              | Type    | Required | Description                                           |
| ---------------------- | ------- | -------- | ----------------------------------------------------- |
| `service_id`           | string  | No       | Preferred Application id                              |
| `service_name`         | string  | No       | Application name                                      |
| `project_id`           | string  | No       | Optional Project id for single-Application Projects   |
| `project_name`         | string  | No       | Optional Project name for single-Application Projects |
| `domain`               | string  | Yes      | Domain host that already points to OpenLander         |
| `path_prefix`          | string  | No       | Public path prefix to match (default `/`)             |
| `strip_prefix`         | boolean | No       | Strip `path_prefix` before forwarding                 |
| `upstream_path_prefix` | string  | No       | Internal path prefix to add before forwarding         |
| `target_port`          | number  | No       | Override the service container port for this route    |

Provide `service_id`, `service_name`, `project_id`, or `project_name`. Multi-service groups require
an explicit service target.

Domain route = a user-managed custom Traefik Host/path route for a domain already pointed at
OpenLander port 80. This manual route action does not create DNS records, Cloudflare Tunnel routes,
ngrok endpoints, or TLS certificates. Use `expose_public` instead when OpenLander should publish
the Application. Protected Share and Connected Publish own their generated routes and are managed
only through `get_public_access` / `unexpose_public`. Docker labels are not the source of truth for custom domains; check
`/api/traefik/config` and Traefik loaded routers when debugging.

The response includes `route_health` and `route_verification`. Verification is
a direct managed-Traefik Host-header probe from the OpenLander host; it proves
that Traefik has loaded the Host/path route, not that external DNS, Cloudflare,
or TLS are configured.

### `list_domain_routes`

Optional `service_id`, `service_name`, `project_id`, or `project_name` filters. With no parameters,
lists all user-managed custom domain routes. Routes owned by Protected Share or Cloudflare
Connected Publish are intentionally excluded; inspect them with `get_public_access` instead.

There is no MCP domain-route deletion action. Removing a custom route remains a deliberate human
UI operation, while managed routes must be disabled with `unexpose_public`.

| Parameter | Type    | Required | Description                                                                 |
| --------- | ------- | -------- | --------------------------------------------------------------------------- |
| `verify`  | boolean | No       | Probe routes through managed Traefik. Defaults to true for targeted lookups |

Targeted responses include `route_health` and `route_verification` by default.
Unfiltered lists skip live probes unless `verify: true` is provided, to avoid
turning inventory calls into large probe fanouts.

---

## Git & Repository

### Repository Deploy Key credentials

| Action                  | Required parameters | Purpose                                                     |
| ----------------------- | ------------------- | ----------------------------------------------------------- |
| `create_git_deploy_key` | `repo_url`          | Generate a read-only public Deploy Key for one repository   |
| `list_git_credentials`  | None                | List sanitized credentials and Application usage            |
| `verify_git_credential` | `credential_id`     | Verify read access to the credential's exact Git repository |
| `remove_git_credential` | `credential_id`     | Remove an unused credential after human approval            |

`create_git_deploy_key` never returns private key material. Add its returned
public key in the repository settings with write access disabled, then call
`verify_git_credential`. `remove_git_credential` refuses credentials that are
still referenced and enters the MCP approval hold; poll its returned
`poll_call` with `mcp_action_status` after the administrator approves or rejects
the request.

### `scan_dockerfiles`

| Parameter  | Type   | Required | Description        |
| ---------- | ------ | -------- | ------------------ |
| `repo_url` | string | Yes      | Git repository URL |
| `branch`   | string | No       | Branch             |

(`scan_project` exists as a tool def but is not exposed on the MCP composite surface.)

### `list_github_repos`

| Parameter    | Type   | Required | Description                |
| ------------ | ------ | -------- | -------------------------- |
| `page`       | number | No       | Page number                |
| `visibility` | string | No       | `all`, `public`, `private` |

### `search_github_repos`

| Parameter | Type   | Required | Description  |
| --------- | ------ | -------- | ------------ |
| `query`   | string | Yes      | Search query |

GitHub repository discovery returns safe HTTPS clone URLs only. Private or
internal repository credentials are injected internally at clone time and are
never included in MCP responses, deployment status payloads, or build-log
guidance. Agents should pass the returned `clone_url`/`repo_url` as-is instead
of embedding tokens in URLs.

Clone failures caused by DNS resolution, connection timeouts, unreachable
networks, connection resets, or an unreachable GitHub/SSH endpoint return the
retryable `GIT_NETWORK_UNREACHABLE` error. Authentication, missing repository,
and missing branch failures retain their existing error codes. Repository URL
credentials and provider tokens are redacted from errors and logs.

---

## Monitoring & Logs

### `get_instance_info`

No parameters. Returns the current OpenLander MCP instance identity:
`id`, `name`, `endpoint`, `host`, `suggestedName`, and whether the name is still a default.
Use this first when multiple OpenLander servers are connected to the same AI client.

### `list_ai_ops_briefings` / `get_ai_ops_briefing`

AI Ops Briefing Beta read surface. These actions are read-only and do not restart,
redeploy, roll back, edit env vars, or acknowledge incidents.

`list_ai_ops_briefings` lists persisted briefings. With no target, an
instance/default token can use it as the agent-primary triage queue. With
`project_id` or `service_id`, it lists only that Project or Application/Compose
service. Scoped tokens should pass their explicit target so the scope boundary is
unambiguous.

| Parameter    | Type   | Required | Description                                         |
| ------------ | ------ | -------- | --------------------------------------------------- |
| `project_id` | string | No       | Project id                                          |
| `service_id` | string | No       | Application/Compose service_id                      |
| `status`     | string | No       | `open`, `acknowledged`, `resolved`, or `unresolved` |
| `limit`      | number | No       | Max rows, 1-100                                     |

The response is a compact triage payload: `briefing_id`, `project_id`,
`service_id`, `status`, `severity`, `classification`, `title`, one-line
`summary`, `created_at`, and a ticket-first `diagnostic_call` for
`openlander_monitor.diagnose_service` with the `briefing_id` already populated.
Full evidence, LLM telemetry, dedupe fields, and full summaries are kept out of
the list response; call `get_ai_ops_briefing` for detail.

`get_ai_ops_briefing` takes `briefing_id` and returns one briefing with evidence.
The deterministic `suggested_call` is the next diagnostic read. LLM summary text,
when present, is explanatory only. Full briefing responses include
`evidence_metadata` with `observed_at`, `live: false`, `input_token_estimate`,
`input_cap_applied`, and `omitted_evidence` so agents know the evidence is an
incident-time snapshot and whether any capped source should be fetched through a
follow-up call. The token estimate is derived from the capped evidence payload.

The web dashboard's AI Ops detail dialog can copy an Agent handoff prompt. That
prompt does not include a token or credential; it tells the agent to use its
already-configured OpenLander MCP server, start with
`openlander_monitor({ action: "get_ai_ops_briefing", params: { briefing_id } })`,
then inspect the deterministic `suggested_call` and verify route/container/deploy
state before reporting that the incident is fixed.

### `get_logs`

| Parameter      | Type   | Required | Description                                        |
| -------------- | ------ | -------- | -------------------------------------------------- |
| `service_id`   | string | No       | Application id; preferred from `list_projects`     |
| `service_name` | string | No       | Application name                                   |
| `project_id`   | string | No       | Convenience target for single-Application Projects |
| `project_name` | string | No       | Convenience target for single-Application Projects |
| `lines`        | number | No       | Number of tail lines; MCP default 200              |

Provide one of `service_id`, `service_name`, `project_id`, or `project_name`. Prefer
`service_id` when chaining from `list_projects`. For migration or traceback failures, retry
with `lines=500` or `lines=1000` if the default tail is not enough. A completed or failed
one-shot Compose job remains readable by `service_id` while its container is retained.

### `get_system_stats`

Host CPU, memory, disk usage. No parameters.

### `diagnose_host_resources`

Read-only host/Docker pressure diagnosis for SIGKILL/OOM, Docker instability,
or stuck deploys. Does not stop, remove, restart, or clean anything.

| Parameter            | Type    | Required | Description                                  |
| -------------------- | ------- | -------- | -------------------------------------------- |
| `container_limit`    | number  | No       | Max top CPU/memory containers to return      |
| `include_disk_usage` | boolean | No       | Include Docker disk totals; defaults to true |

Use this before falling back to SSH/Docker when build logs suggest `SIGKILL`,
OOM, disk pressure, or Docker daemon instability.

### `list_docker_networks` / `remove_unused_docker_network`

`list_docker_networks` is an instance/org-scoped, read-only inventory for Docker
network address-pool incidents. It returns compact rows with `network_id`,
`network_name`, subnet, endpoint count verified from running and stopped container
attachments, instance ownership, `cleanup_eligible`, and a machine-readable
`cleanup_blocker`. External and system networks are omitted by default; pass
`include_external=true` to include them in the returned rows.
Summary counts always cover the complete Docker network inventory.
`project_network_pool` reports the configured CIDR, fixed `/24` subnet size,
total and unavailable subnet counts, and `pressure` (`ok`, `low`, or
`exhausted`). CIDRs owned by any Docker network count as unavailable, even when
the network is external to OpenLander.

New OpenLander-managed networks use an explicit, collision-checked subnet from
`docker.projectNetworkPoolCidr` (default `10.240.0.0/12`). Existing networks are
not renumbered or migrated. When no subnet is available,
`NETWORK_ADDRESS_POOL_EXHAUSTED` is returned before image build or pull with
`actionRequired=free_or_reconfigure_network_pool`; retrying unchanged input is
not expected to help.

`remove_unused_docker_network` removes one exact network only after all of these
conditions are revalidated immediately before removal:

- `network_name` and `network_id` still identify the same Docker object
- endpoint count is zero
- driver is `bridge` and scope is `local`
- the network belongs to the current OpenLander instance; or it is a label-less
  legacy `ol-*` network and `allow_legacy_unlabeled=true`
- it is not a Docker system network, the shared OpenLander network, an external
  network, or a network owned by another OpenLander instance

MCP calls enter the human approval queue and return `action_run_id` plus
`poll_call`; they do not remove the network immediately. Project- and
service-scoped tokens receive `SCOPE_VIOLATION`. Raw REST API-token mutation is
also rejected; an authenticated web session may execute the operation after the
operator has reviewed the exact name and id.

| Parameter                | Type    | Required | Description                                            |
| ------------------------ | ------- | -------- | ------------------------------------------------------ |
| `include_external`       | boolean | No       | Include external and system networks in inventory rows |
| `network_name`           | string  | Yes      | Exact name returned by `list_docker_networks`          |
| `network_id`             | string  | Yes      | Exact immutable id returned by the inventory           |
| `allow_legacy_unlabeled` | boolean | No       | Required for a label-less legacy `ol-*` network        |
| `idempotency_key`        | string  | Yes      | Stable key for an exact cleanup command retry          |

### `get_project_stats`

| Parameter      | Type   | Required | Description                                        |
| -------------- | ------ | -------- | -------------------------------------------------- |
| `service_id`   | string | No       | Application id; preferred                          |
| `service_name` | string | No       | Application name                                   |
| `project_id`   | string | No       | Convenience target for single-Application Projects |
| `project_name` | string | No       | Convenience target for single-Application Projects |

### `get_topology`

Read-only project service graph for agents. Returns Applications,
connected Database/Cache/Storage resources, and `dependsOn`/`edges` so an agent can see which
apps depend on which databases/caches over MCP. Compose children include `runtime_role`,
`lifecycle`, `health_strategy`, and `is_traffic_target`; Compose projects also return an optional
`aggregate_status` of `running`, `degraded`, or `error`.

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_id`   | string | No       | Project id   |
| `project_name` | string | No       | Project name |

### `diagnose_service`

| Parameter           | Type   | Required | Description                                                                        |
| ------------------- | ------ | -------- | ---------------------------------------------------------------------------------- |
| `service_id`        | string | No       | Application id; preferred                                                          |
| `service_name`      | string | No       | Application name                                                                   |
| `project_id`        | string | No       | Convenience target for single-Application Projects                                 |
| `project_name`      | string | No       | Convenience target for single-Application Projects                                 |
| `briefing_id`       | string | No       | AI Ops briefing id to compare snapshot vs live state and return `recovery_receipt` |
| `path`              | string | No       | HTTP path to probe                                                                 |
| `health_check_path` | string | No       | Alias for `path`                                                                   |
| `lines`             | number | No       | Log lines to include                                                               |

If `path` is omitted, OpenLander uses a configured base path env such as
`NEXT_PUBLIC_BASE_PATH` before falling back to the service health path.

Compose child diagnostics follow `runtime_role`: applications use HTTP/route checks, resources use
Docker health or a known internal TCP port, and one-shot jobs use container exit code plus logs.
Resource and job responses return `roleCheck` and intentionally omit application-only `httpCheck`
and `route` fields.

`recentDeployment` is explicitly marked with `scope: "deployment_history"`. Its persisted
representative-traffic result describes the deploy-time observation only. Current diagnosis and
the normalized `evidence.representativeTraffic` field use live probes, so an old timeout or HTTP
failure remains available for history without overriding a healthy live result.

When the supplied `service_id` is a Compose parent, OpenLander diagnoses the persisted
`traffic_service` child and returns the Project's `aggregate_status`. The returned `service` is the
actual child used for live container, log, HTTP, route, and dependency checks. If no representative
traffic child can be resolved, the action returns the child status summary and marks live probes as
skipped instead of reporting the containerless parent as `CONTAINER_NOT_RUNNING`; diagnose a child
`service_id` directly after selecting it from `get_topology`.

Environment dependency checks use the running container's actual `Config.Env`,
including HTTP and HTTPS endpoints, and run from that container so Project-network DNS names are
evaluated from the same network as the application. Saved env keys are returned only as a masked
inventory and drift comparison; raw values are never returned. If Docker cannot provide
`Config.Env`, dependency probes are marked skipped and OpenLander does not create a high-confidence
dependency diagnosis or pending user input from saved values alone.
HTTP/HTTPS failures without an HTTP status are retried before OpenLander promotes them to a
high-confidence dependency diagnosis or pending user input. HTTP error responses keep their status
evidence and are not treated as network failures. Endpoints that match the service's generated or
custom OpenLander route are excluded from external dependency diagnosis; any stale pending input
for that managed route is resolved.

High-confidence deterministic findings add `diagnosis: { code, summary,
confidence, evidence }` and, when a safe next operation exists, top-level
`suggested_call`. Current codes include `PORT_MISMATCH`,
`ROUTE_BACKEND_MISMATCH`, `RUNTIME_ENV_MISSING`, `BUILD_TIME_ENV_MISSING`, and
`NO_RUNTIME_IMAGE`, `DEPENDENCY_UNREACHABLE`, `RESTART_LOOP`, and
`CONTAINER_NOT_RUNNING`. Ambiguous cases omit `diagnosis` and keep raw `env`,
`buildTimeEnv`, `container`, `logs`, `httpCheck`, `route`, and `dependencies`
fields for agent review.

`DEPENDENCY_UNREACHABLE` is intentionally user-input-gated. When a runtime
dependency endpoint such as `EXCHANGE_API_URL` cannot be reached from Docker,
`diagnosis.recoverability` is `needs_user_input`, `diagnosis.agent_terminal` is
`true`, and `diagnosis.input_required` names the field with
`source_required: "user"`. Agents must report `diagnosis.report_to_user` to the
operator and wait for the correct value instead of guessing or inventing a
replacement endpoint. OpenLander omits `suggested_call` until the missing value
is known. For high-confidence user-owned external values, the same diagnosis also
creates or refreshes a pending-input safety row so MCP mutations for that field
are blocked until a trusted human surface provides the value or a later diagnosis
observes the dependency as reachable.

`diagnose_service` also returns a normalized `evidence` block plus
`evidence_metadata`. This metadata uses `live: true` because the action probes
current host/container state, unlike AI Ops briefing evidence which is a
snapshot from the incident time. If normalized evidence is input-capped,
`omitted_evidence` names the capped field and includes a follow-up MCP call such
as `get_logs` or `get_build_log` when OpenLander can derive one.

When called with `briefing_id`, `diagnose_service` also returns
`recovery_receipt`: a machine-readable before/after comparison between the AI Ops
briefing snapshot and current live diagnostics. The receipt includes
`status: "verified" | "needs_attention" | "unknown" | "unavailable"` plus checks
for `route_health`, `container_status`, `restart_stability`, and
`latest_deploy`. It also includes `summary`, `report_to_user`, `can_resolve`,
`next_action`, `primary_check`, `passed_checks`, `failed_checks`,
`unknown_checks`, and `check_summary` so agents can report the verification
result without interpreting raw before/after payloads. `next_action` is the
canonical agent action; `_agent_guidance.next_steps` repeats it for compatibility
with the broader MCP guidance envelope. `latest_deploy` is
deploy-status evidence unless the response explicitly carries serving-version
evidence; route 200 alone is not proof that the expected version is serving.
Agents should read this receipt before telling the user that an incident is
fixed.

Day-2 recovery loop: call `diagnose_service`, execute its top-level
`suggested_call` when present, then read the action result's verification detail
(`route_verification` for route changes or `runtime_apply` for env changes).
Use `diagnostic_call` when verification is skipped or failed; full redeploy is
the fallback for build-time env changes, missing runtime images, or failed hot
paths that diagnostics cannot resolve.

For route hot paths, `route_verification.status: "verified"` means the managed
Traefik HTTP provider had enough time to poll the updated backend and the public
route still returned a 2xx. OpenLander does not accept an immediate stale 2xx
from the previous route snapshot as proof of cutover.

### `probe_host`

| Parameter      | Type    | Required | Description                                         |
| -------------- | ------- | -------- | --------------------------------------------------- |
| `target`       | string  | No       | Hostname, URL, IP, or `container-name:port`         |
| `host`         | string  | No       | Alias for `target`                                  |
| `port`         | number  | No       | Port for TCP or host-only probes                    |
| `protocol`     | string  | No       | `http`, `https`, or `tcp`; default auto-detect      |
| `path`         | string  | No       | HTTP path                                           |
| `internal`     | boolean | No       | Probe from the target project container when `true` |
| `service_id`   | string  | No       | Application context for internal probes             |
| `service_name` | string  | No       | Application name context for internal probes        |
| `project_id`   | string  | No       | Project context for internal probes                 |
| `project_name` | string  | No       | Project context for internal probes                 |
| `timeout_ms`   | number  | No       | Probe timeout                                       |

Provide either `target` or `host`. When `internal=true`, also provide
`service_id`, `service_name`, `project_id`, or `project_name` so OpenLander can
probe from the correct isolated project network.

### `mcp_action_status`

Check a held destructive MCP action. Approval-hold responses include a
`poll_call` that calls this action with `action_run_id`. The response includes
the approval status, sanitized `requested_args_summary`, `lifecycle_effect`, and
agent guidance. A typed execution failure may also return `error_code` and a
sanitized `error_details` object; arbitrary error-detail keys are not exposed.
Archive success returns `suggested_call` for `list_archived_services`; restore
success reminds agents that no container was started automatically. Successful held Docker cleanup
returns a compact `result` with the level, reclaimed MB, and captured before/after Docker usage totals,
plus a `suggested_call` for `get_disk_usage`.

| Parameter       | Type   | Required | Description                               |
| --------------- | ------ | -------- | ----------------------------------------- |
| `action_run_id` | string | No       | Action run id returned by a held MCP call |
| `action_id`     | string | No       | Alias for `action_run_id`                 |

Provide either `action_run_id` or `action_id`.

### `get_alerts` / `dismiss_alert`

| Parameter  | Type   | Required      | Description |
| ---------- | ------ | ------------- | ----------- |
| `alert_id` | string | Yes (dismiss) | Alert ID    |

---

## Debug & Troubleshooting

### `get_build_log`

| Parameter      | Type   | Required | Description                  |
| -------------- | ------ | -------- | ---------------------------- |
| `deploy_id`    | string | No       | Deploy log id                |
| `service_id`   | string | No       | Application/Compose id       |
| `service_name` | string | No       | Application/Compose name     |
| `project_id`   | string | No       | Project id                   |
| `project_name` | string | No       | Project name                 |
| `deploy_index` | number | No       | Deploy index (0 = latest)    |
| `tail`         | number | No       | Return only the last N lines |

Provide `deploy_id` by itself when known, or provide `service_id`/`service_name`
with optional `deploy_index`. Project targets remain compatibility shortcuts.
For an active service/project target, `get_build_log` returns
`complete: false`, the latest BuildKit step when available, the most recent 30
lines, and `status_call`; poll until terminal. Without `tail`, a completed
target returns the full persisted Dockerfile or Compose build output. Compose
children keep separate build logs, and one-shot migration/job deploy logs carry
`runtime_log` with combined stdout/stderr plus the exit code. The response
includes `full_log`, `returned_chars`, `total_chars`, and `truncated` for the
build log, plus `runtime_full_log`, `runtime_returned_chars`,
`runtime_total_chars`, and `runtime_truncated` when a runtime log is present, so
agents can tell whether they are looking at the whole log or a requested tail.

OpenLander 0.1 does not expose built-in AI diagnosis. External MCP agents should
read `get_build_log` / `get_logs`, inspect the failure in their own context, then
apply config/repo changes and call `update_app`.

---

## Volume Management

### `add_volume`

| Parameter      | Type   | Required | Description           |
| -------------- | ------ | -------- | --------------------- |
| `project_name` | string | Yes      | Project name          |
| `volume_name`  | string | Yes      | Volume name           |
| `mount_path`   | string | Yes      | Mount path (absolute) |

### `list_volumes`

| Parameter      | Type   | Required | Description       |
| -------------- | ------ | -------- | ----------------- |
| `project_name` | string | No       | Filter by project |

### `remove_volume`

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |
| `volume_name`  | string | Yes      | Volume name  |

`remove_volume` follows the effective destructive-action permission: allow, approval hold, or
block. The action permanently deletes the selected volume data.

### `get_disk_usage`

Docker disk usage breakdown. No parameters. If Docker's `df` endpoint stalls under heavy host
load, the tool returns `unavailable: true` with `DOCKER_DISK_USAGE_UNAVAILABLE` instead of
timing out the MCP request.

### `cleanup_docker`

`cleanup_docker` is a host-wide action controlled by the global Security
`destructive_actions` setting. The default `allow` executes immediately; `approval_required`
returns a pollable `action_run_id`; `block` returns `OPERATION_PERMISSION_DENIED`. Project and
service overrides do not apply. The result includes reclaimed MB plus compact Docker usage snapshots
captured before and after cleanup. If either snapshot times out, cleanup still returns its prune
results with that snapshot marked unavailable.

| Parameter | Type   | Required | Description                                          |
| --------- | ------ | -------- | ---------------------------------------------------- |
| `level`   | string | No       | `soft`, `standard`, `aggressive` (default: standard) |

---

## Infrastructure Analysis

### `analyze_infrastructure`

| Parameter  | Type   | Required | Description        |
| ---------- | ------ | -------- | ------------------ |
| `repo_url` | string | Yes      | Git repository URL |
| `branch`   | string | No       | Branch             |

### `web_search`

| Parameter     | Type   | Required | Description     |
| ------------- | ------ | -------- | --------------- |
| `query`       | string | Yes      | Search query    |
| `max_results` | number | No       | Maximum results |

---

## Platform Admin

> These tools require admin access and are config-gated (`mcp.platformTools: true`). The default is `false`.

### `platform_health`

Platform health summary. No parameters.

### `platform_event_log`

| Parameter       | Type   | Required | Description      |
| --------------- | ------ | -------- | ---------------- |
| `limit`         | number | No       | Number of events |
| `event_type`    | string | No       | Filter by prefix |
| `since_minutes` | number | No       | Time window      |

### `platform_container_audit`

| Parameter      | Type   | Required | Description       |
| -------------- | ------ | -------- | ----------------- |
| `project_name` | string | No       | Filter by project |

### `platform_config`

| Parameter | Type   | Required | Description           |
| --------- | ------ | -------- | --------------------- |
| `section` | string | No       | Filter config section |

### `platform_logs`

| Parameter       | Type   | Required | Description   |
| --------------- | ------ | -------- | ------------- |
| `limit`         | number | No       | Log lines     |
| `level`         | string | No       | Level filter  |
| `module`        | string | No       | Module filter |
| `since_minutes` | number | No       | Time window   |

When filters are provided, OpenLander filters the in-memory log buffer first and
then applies `limit`, so older matching errors are not hidden behind recent noise.

### `platform_docker_inspect`

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `container_id` | string | Yes      | Container ID |

### `platform_docker_ps`

| Parameter        | Type    | Required | Description             |
| ---------------- | ------- | -------- | ----------------------- |
| `all`            | boolean | No       | Include stopped         |
| `filter_managed` | boolean | No       | OpenLander-managed only |

### `platform_db_inspect`

| Parameter    | Type   | Required | Description       |
| ------------ | ------ | -------- | ----------------- |
| `table`      | string | Yes      | Table name        |
| `project_id` | string | No       | Filter by project |
| `limit`      | number | No       | Row limit         |

### `platform_adopt_orphan_service`

| Parameter        | Type    | Required              | Description                   |
| ---------------- | ------- | --------------------- | ----------------------------- |
| `container_id`   | string  | Yes, unless name used | Orphan container ID           |
| `container_name` | string  | Yes, unless ID used   | Orphan container name         |
| `confirm`        | boolean | No                    | Default `false`; preview only |

Without `confirm=true`, this returns the service row that would be created and makes no DB changes. With `confirm=true`, OpenLander registers the existing container as an adopted custom image service. Adopted services support logs, restart, stop, and remove; build/redeploy is rejected with `SERVICE_OPERATION_UNSUPPORTED`.

### `platform_cleanup_orphans` / `platform_reconcile`

| Parameter | Type    | Required           | Description                      |
| --------- | ------- | ------------------ | -------------------------------- |
| `confirm` | boolean | Yes (execute only) | Must be true when not previewing |
| `dry_run` | boolean | No                 | Preview mode (default: true)     |

`platform_cleanup_orphans` and `platform_reconcile` default to dry-run preview and make no
changes without `dry_run=false` plus `confirm=true`. `platform_cleanup_orphans` execution and
`recover_platform` are human-only in OpenLander 0.1 and return
`OPERATION_REQUIRES_HUMAN_UI` from MCP.

### `platform_force_remove`

| Parameter      | Type    | Required | Description  |
| -------------- | ------- | -------- | ------------ |
| `container_id` | string  | Yes      | Container ID |
| `confirm`      | boolean | Yes      | Must be true |

`platform_force_remove` has no dry-run mode. It is human-only in OpenLander 0.1 and returns
`OPERATION_REQUIRES_HUMAN_UI` from MCP.

---

## Notes

- All tools return structured JSON responses.
- Status responses stay intentionally small: current status, IDs, revision
  fields such as `deploy_id`/`commit_sha`, and short guidance.
- Tool responses may include `_agent_guidance` with suggested next steps.
- Tool responses may include these call links:
  - `status_call` for polling progress.
  - `diagnostic_call` for service or host diagnosis.
  - `suggested_call` for the primary next mutation/read action.
  - `poll_call` for approval/status polling such as `mcp_action_status`.
- Logs, raw build output, Docker details, host resources, and full diagnostics
  are fetched through dedicated actions such as `get_build_log`,
  `diagnose_service`, and `diagnose_host_resources`.
- `execute_deploy_plan` is non-blocking — always poll `get_deploy_status`
- Timestamps are ISO 8601 format.
- Error responses include machine-readable codes.
