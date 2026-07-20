# MCP Tools Reference

OpenLander exposes its functionality to AI coding agents through a **composite-tool surface**:

- **5 composite tools** — enabled by default
- **83 unique default operations** surfaced through those composites
- **13 platform tools** for server admin (health, Docker inspect, orphan adoption, etc.) — gated behind `config.mcp.platformTools: true`

Each composite takes `{ action, params }` — e.g.
`openlander_deploy({ action: "deploy_app", params: { repo_url: "...", name: "my-app" } })`.
Run `{ action: "help" }` on any composite to list its action catalog with machine-readable
`input_schema`, `required_params`, and `optional_params`. Run
`{ action: "help", params: { action_name: "create_deploy_plan" } }` to fetch one action contract.

Model note: **Project = workspace**. **Application**, **Compose**, **Database**, **Cache**, and **Storage** are resources inside a Project. Wire fields and MCP action names such as `service_id` and `openlander_service` remain compatible in v0.1.x.

Agent routing rule of thumb:

| User asks for                                    | Call                                                                                                        |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| "Deploy this new app/repo/image"                 | `openlander_deploy.deploy_app`                                                                              |
| "Create a new app project before DB/cache"       | `openlander_project.create_project`                                                                         |
| "Update this existing app to latest code/config" | `openlander_service.update_app`                                                                             |
| "Restart/rollback this existing app"             | `openlander_service.restart_service` / `rollback_service`                                                   |
| "Change app branch/repo/image source"            | `deploy_app` with an explicit `service_id`/`service_name`, or `update_application_source` then `update_app` |
| "Set env vars or connect DB/Redis to an app"     | `openlander_service.set_env_vars`, then `update_app`                                                        |
| "Fix route port mismatch without rebuild"        | `openlander_service.apply_route_config`                                                                     |
| "Create PostgreSQL/Redis/MySQL/etc."             | `openlander_managed_service.create_service`                                                                 |
| "Inspect this project's database/cache safely"   | `openlander_managed_service.list_data_sources` / `describe_data_source` / `read_data_source`                |
| "Why is this failing?"                           | `openlander_monitor.diagnose_service` with `service_id`                                                     |
| "What did AI Ops notice?"                        | `openlander_monitor.list_ai_ops_briefings` / `get_ai_ops_briefing`                                          |
| "Was this killed by host memory/Docker?"         | `openlander_monitor.diagnose_host_resources`                                                                |

Prefer `service_id` for follow-up actions. `project_name` is a limited shortcut only when a Project
contains exactly one Application.
`list_projects().projects[].deployable_service_count` is the v0.1.x compatibility
field for Application/worker count in the Project; it does not include Database
resources, caches, buckets, or the Compose parent metadata row.

Remote MCP uses Bearer tokens. Mint one from the **Your Agent** page (`/mcp-server`) in the
dashboard, or from the setup wizard's MCP step — both issue an instance-wide token, **shown only
once**. The current API value for this instance-wide scope is `scope_kind: "org"` for compatibility;
this is not an organization feature. To get the value again, use **Regenerate** (or
`POST /api/mcp/token/regenerate`), which revokes the previous token; `POST /api/mcp/token` may not
return the plaintext once a token already exists. Project- and service-scoped tokens exist via the
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
values from different targets in one call. `mcp_action_status` may be polled with a service-scoped
token for held actions in the scoped service's Project, so handoff flows can follow their own
approval/status lifecycle without broadening the token.

This Bearer token is for MCP, not for raw REST `/api` calls. A correctly registered agent should
see the five `openlander_*` composite tools and should be able to call
`openlander_project({ action: "help" })`. If those tools are missing, fix MCP registration
instead of asking the model to call OpenLander's HTTP API directly.
If the same token is sent to `/api`, OpenLander returns `MCP_TOKEN_USED_ON_REST_API`
with the correct `/mcp` endpoint and a registration example.

Destructive MCP operations are intentionally gated. Some real ToolDefs appear in the action catalog
but are blocked at the MCP boundary because they delete Database/Cache/Storage resources or perform
host-wide cleanup: `remove_service`, `remove_volume`, `delete_bucket`, `platform_force_remove`,
`recover_platform`, `platform_cleanup_orphans`, and `cleanup_docker`. MCP calls to these return
`OPERATION_REQUIRES_HUMAN_UI`; use the web UI or host-maintenance path instead.

Application cleanup and restore use softer paths. `archive_project`,
`unarchive_project`, `archive_service`, and `unarchive_service` are exposed
through the project/service composites but enter the human approval hold queue
before executing.
Archive is reversible cleanup, not permanent deletion: archived Applications
are hidden from default active lists, can be inspected with
`list_archived_services`, and can be restored with `unarchive_service` or
`unarchive_project`. Restore actions do not redeploy automatically.
Approval-hold responses include both `actionRunId` and `action_run_id`, plus a
`poll_call` envelope for `openlander_monitor.mcp_action_status`, an
`effect_preview`, and `after_approval` guidance so agents know what changed and
what to do after approval.
Supported bulk cleanup actions such as `bulk_delete_env_vars confirm=true` also
enter that queue.

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

| Composite                    | Action slots | Purpose                                                                               |
| ---------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| `openlander_deploy`          | 18           | Deploy plans, execution, previews, rollbacks, build logs, Git                         |
| `openlander_project`         | 17           | Projects, lifecycle, secrets, temporary share URLs; env actions route to Applications |
| `openlander_service`         | 25           | Application lifecycle, config, domain routes, and env vocabulary                      |
| `openlander_managed_service` | 24           | Database/Cache/Storage resources, credentials, backups, data inspection, disk usage   |
| `openlander_monitor`         | 13           | Logs, alerts, AI Ops briefings, topology, system stats, host diagnosis, probes        |

`openlander_project` owns Project/config actions. `openlander_service` owns Application runtime actions.

## Tool Categories

| Category                                                 | Tools | Description                                           |
| -------------------------------------------------------- | ----- | ----------------------------------------------------- |
| [Deploy Plan](#deploy-plan)                              | 6     | Create, inspect, update, execute deploy plans         |
| [Deployment Controls](#deployment-controls)              | 7     | Status, cancel, rollback, previews                    |
| [Project Operations](#project-operations)                | 7     | Project lifecycle, listing, and Project-scoped config |
| [Environment Variables](#environment-variables--secrets) | 11    | Env vars, secrets, secret files                       |
| [Resources](#services--infrastructure)                   | 17    | Create databases, manage infrastructure resources     |
| [Data Inspector](#project-aware-data-inspector)          | 3     | Bounded read-only data-source inspection              |
| [Domains](#domains)                                      | 2     | Register Host/path domain routes                      |
| [Git & Repository](#git--repository)                     | 4     | Scan repos, list GitHub repos                         |
| [Monitoring](#monitoring--logs)                          | 12    | Logs, stats, alerts, AI Ops briefings, host diagnosis |
| [Debug](#debug--troubleshooting)                         | 1     | Build logs for external-agent analysis                |
| [Volume Management](#volume-management)                  | 5     | Docker volumes, disk cleanup                          |
| [Infrastructure Analysis](#infrastructure-analysis)      | 2     | Repo analysis, web search                             |
| [Platform Admin](#platform-admin)                        | 13    | Health, events, docker inspect                        |

---

## Deploy Plan

### `create_deploy_plan`

Analyze a repository and create a deployment plan.

| Parameter           | Type     | Required | Description                                         |
| ------------------- | -------- | -------- | --------------------------------------------------- |
| `repo_url`          | string   | No       | Git repository URL                                  |
| `branch`            | string   | No       | Branch to deploy                                    |
| `name`              | string   | No       | Project name                                        |
| `source`            | string   | No       | `'git'` or `'image'`                                |
| `image`             | string   | No       | Docker image (if source=image)                      |
| `cmd`               | string   | No       | Container command override                          |
| `port`              | number   | No       | Container port                                      |
| `health_check_path` | string   | No       | Health check path                                   |
| `env_vars`          | object   | No       | Environment variables                               |
| `prefer_dockerfile` | boolean  | No       | Prefer existing Dockerfile                          |
| `dockerfile_path`   | string   | No       | Relative Dockerfile path                            |
| `docker_target`     | string   | No       | Docker build target stage                           |
| `compose_file`      | string   | No       | Repository-relative Compose file                    |
| `compose_files`     | string[] | No       | Ordered Compose files, from base to overlays        |
| `compose_profiles`  | string[] | No       | Compose profiles to activate                        |
| `traffic_service`   | string   | No       | Compose application used for representative traffic |
| `environment`       | string   | No       | `production` (default) or `development`             |
| `target_project_id` | string   | No       | Deploy first Application into an existing Project   |

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
When `deploy_app` resolves an existing app and includes source-only changes (`repo_url`, `branch`,
`source`, `image`, or `port`), OpenLander saves those source settings first and then starts
`update_app`. Dockerfile/build config changes still require `update_service_config`, then
`update_app`.
When dependency manifests declare git-based dependencies, OpenLander refreshes the dependency
install layer while preserving normal Docker cache behavior for other repos. Use `no_cache=true`
only when you need a fully uncached build.

`target_project_id` attaches a newly deployed single app/worker service to an
existing Project after the deploy succeeds. The attach is owned by the
durable deploy-plan execution path, not request-local MCP post-processing, so
agents should poll status and then use the returned `service_id` for follow-up
service actions. It is not supported with `expose=true`, compose, or ambiguous
monorepo deploys; expose the service after attach if needed. Use `create_project`
first when a brand-new app needs a project-scoped Database/Cache/Storage resource before first
boot.

| Parameter           | Type    | Required | Description                                                      |
| ------------------- | ------- | -------- | ---------------------------------------------------------------- |
| `service_id`        | string  | No       | Existing Application id                                          |
| `service_name`      | string  | No       | Existing Application name                                        |
| `project_name`      | string  | No       | Existing group lookup or service name scope                      |
| `repo_url`          | string  | No       | Git repository URL for a new app                                 |
| `branch`            | string  | No       | Branch                                                           |
| `name`              | string  | No       | New Project name, or existing project alias                      |
| `source`            | string  | No       | `'git'` or `'image'`                                             |
| `image`             | string  | No       | Docker image                                                     |
| `cmd`               | string  | No       | Command override                                                 |
| `port`              | number  | No       | Container port                                                   |
| `env_vars`          | object  | No       | Environment variables                                            |
| `no_cache`          | boolean | No       | Force fresh build when Docker cache may hide dependency changes  |
| `target_project_id` | string  | No       | Attach new single Application to an existing group               |
| `strategy`          | string  | No       | Redeploy strategy for existing services                          |
| `health_check_path` | string  | No       | Health check path                                                |
| `traffic_service`   | string  | No       | Compose application used for readiness, URL, and traffic probing |
| `wait`              | boolean | No       | Block until complete (default: true)                             |
| `timeout`           | number  | No       | Max seconds to wait (default: 300)                               |

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

When called with a scoped MCP token, the response is filtered before it reaches the agent:
project-scoped tokens see only the scoped Project, and service-scoped tokens see only Projects that
contain the scoped service. For service-scoped tokens, `deployable_service`,
`deployable_services`, and `deployable_service_count` are also reduced to the scoped service so
agents do not receive sibling service identifiers.

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
request.

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
request.

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

Create or remove a temporary public share URL for a project. This is an optional public-access
feature and requires a configured tunnel backend on the OpenLander host. If the tunnel backend is
not installed/configured, use the normal service URL, custom domain routing, or configure the tunnel
first. If the app already has a reachable public route, `expose_public` returns
`status: "already_public"` with `publicUrl` / `preferred_url` and does not try to
open a tunnel.

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |

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

`compose_file` and `compose_files` cannot be supplied together. Compose-specific fields are valid
only for the Compose parent service; child services and non-Compose Applications are rejected.

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

### `expose_public` / `unexpose_public`

Project composite aliases for temporary public URLs. This is optional and depends on the configured
tunnel backend; it is not required for normal deploy/redeploy flows. When a reachable public route
already exists, `expose_public` returns `status: "already_public"` and the existing URL instead of
calling the tunnel backend.

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |

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

| Parameter      | Type   | Required | Description                                                    |
| -------------- | ------ | -------- | -------------------------------------------------------------- |
| `name`         | string | Yes      | Service name                                                   |
| `template`     | string | No       | `postgresql`, `mysql`, `redis`, `mongodb`, `rabbitmq`, `minio` |
| `image`        | string | No       | Custom Docker image                                            |
| `port`         | number | No       | Port number                                                    |
| `project_id`   | string | No       | Attach to this Project id                                      |
| `project_name` | string | No       | Attach to this Project name                                    |

`create_service` requires `project_id` or `project_name`. This keeps new
databases/caches attached to the isolated project Docker network used by the app
that will consume them. Cross-project shared Database/Cache/Storage resources are not exposed in
v0.1, and OpenLander does not expose Database/Cache resource ports over external
TCP. Create the service with the target app's `project_id` or `project_name`.
The standalone action does not write env vars to the app; use the returned
`suggested_env` with `openlander_service.set_env_vars`, then `update_app`.

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

`remove_service` is human-only in OpenLander 0.1 and returns
`OPERATION_REQUIRES_HUMAN_UI` from MCP. Use the service page delete action for
typed-confirm deletion with the managed-volume opt-in checkbox.

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

`create_bucket` and `list_buckets` are MCP-executable. `delete_bucket` is human-only in OpenLander
0.1 and returns `OPERATION_REQUIRES_HUMAN_UI` from MCP; delete buckets from the web UI after
confirming the data-loss impact.

### Backup Operations

`backup_service` / `restore_service` / `list_service_backups`

| Parameter      | Type   | Required      | Description  |
| -------------- | ------ | ------------- | ------------ |
| `service_name` | string | Yes           | Service name |
| `backup_id`    | string | Yes (restore) | Backup ID    |

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

Domain route = a Traefik Host/path route for a domain already pointed at OpenLander port 80.
OpenLander v0.1 does not create DNS records, Cloudflare tunnels, ngrok endpoints, or TLS
certificates. Docker labels are not the source of truth for custom domains; check
`/api/traefik/config` and Traefik loaded routers when debugging.

The response includes `route_health` and `route_verification`. Verification is
a direct managed-Traefik Host-header probe from the OpenLander host; it proves
that Traefik has loaded the Host/path route, not that external DNS, Cloudflare,
or TLS are configured.

### `list_domain_routes`

Optional `service_id`, `service_name`, `project_id`, or `project_name` filters. With no parameters,
lists all registered domain routes.

| Parameter | Type    | Required | Description                                                                 |
| --------- | ------- | -------- | --------------------------------------------------------------------------- |
| `verify`  | boolean | No       | Probe routes through managed Traefik. Defaults to true for targeted lookups |

Targeted responses include `route_health` and `route_verification` by default.
Unfiltered lists skip live probes unless `verify: true` is provided, to avoid
turning inventory calls into large probe fanouts.

---

## Git & Repository

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

When the supplied `service_id` is a Compose parent, OpenLander diagnoses the persisted
`traffic_service` child and returns the Project's `aggregate_status`. The returned `service` is the
actual child used for live container, log, HTTP, route, and dependency checks. If no representative
traffic child can be resolved, the action returns the child status summary and marks live probes as
skipped instead of reporting the containerless parent as `CONTAINER_NOT_RUNNING`; diagnose a child
`service_id` directly after selecting it from `get_topology`.

Environment dependency checks, including HTTP and HTTPS endpoints, run from the diagnosed service
container so Project-network DNS names are evaluated from the same network as the application.
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

`DEPENDENCY_UNREACHABLE` is intentionally user-input-gated. When a saved
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
agent guidance. Archive success returns `suggested_call` for
`list_archived_services`; restore success reminds agents that no container was
started automatically.

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
Without `tail`, `get_build_log` returns the full persisted build log and, when
OpenLander captured one during a runtime crash, `runtime_log`. The response
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

`remove_volume` is human-only in OpenLander 0.1 and returns
`OPERATION_REQUIRES_HUMAN_UI` from MCP. Remove persistent volumes from the web UI after confirming
the data-loss impact.

### `get_disk_usage`

Docker disk usage breakdown. No parameters. If Docker's `df` endpoint stalls under heavy host
load, the tool returns `unavailable: true` with `DOCKER_DISK_USAGE_UNAVAILABLE` instead of
timing out the MCP request.

### `cleanup_docker`

`cleanup_docker` is human-UI / host-maintenance only in OpenLander 0.1 and returns
`OPERATION_REQUIRES_HUMAN_UI` from MCP. Agents may call `get_disk_usage` to confirm pressure, then
surface cleanup to the operator instead of calling this action.

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
