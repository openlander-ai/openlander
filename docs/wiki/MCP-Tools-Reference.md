# MCP Tools Reference

OpenLander exposes its functionality to AI coding agents through a **composite-tool surface**:

- **5 composite tools** — enabled by default
- **66 unique default operations** surfaced through those composites
- **13 platform tools** for server admin (health, Docker inspect, orphan adoption, etc.) — gated behind `config.mcp.platformTools: true`

Each composite takes `{ action, params }` — e.g.
`openlander_deploy({ action: "deploy_app", params: { repo_url: "...", name: "my-app" } })`.
Run `{ action: "help" }` on any composite to list its action catalog with machine-readable
`input_schema`, `required_params`, and `optional_params`. Run
`{ action: "help", params: { action_name: "create_deploy_plan" } }` to fetch one action contract.

Model note: **Project = workspace/group** and **Service = deployable unit**. Repository, image,
branch, Dockerfile, and build context belong to services. Project-level runtime actions have been
removed; use service runtime actions instead.

Agent routing rule of thumb:

| User asks for                                 | Call                                                                       |
| --------------------------------------------- | -------------------------------------------------------------------------- |
| "Deploy this new app/repo/image"              | `openlander_deploy.deploy_app`                                             |
| "Redeploy/restart/rollback this existing app" | `openlander_service.redeploy_app` / `restart_service` / `rollback_service` |
| "Set env vars or connect DB/Redis to an app"  | `openlander_service.set_env_vars`, then `redeploy_app`                     |
| "Create PostgreSQL/Redis/MySQL/etc."          | `openlander_managed_service.create_service`                                |
| "Why is this failing?"                        | `openlander_monitor.diagnose_service` with `service_id`                    |
| "Was this killed by host memory/Docker?"      | `openlander_monitor.diagnose_host_resources`                               |

Prefer `service_id` for follow-up actions. `project_name` is a limited shortcut only when a project
group contains exactly one deployable service.

Remote MCP uses scoped Bearer tokens. Use **Settings → MCP** for org-wide admin tokens and a
project's **MCP** tab for project-scoped agent tokens. Project-scoped tokens are the safer default
for daily work because they cannot operate outside the project group where they were issued.

Destructive MCP operations are intentionally gated. Service deletion is blocked at the MCP boundary
and must be completed in the web UI with typed confirmation. Supported bulk cleanup actions such as
`bulk_delete_env_vars confirm=true` enter the human approval hold queue before execution.

**Project/app archive, delete, and purge are human UI-only.** Composites do not expose
`archive_service`, `archive_project`, `delete_project`, `delete_app`, `remove_app`, or
`purge_project`. Calls to those names return
`{ error: "HUMAN_UI_ONLY", _agent_guidance: { message: "...use the web UI: Settings → Danger zone..." } }`
so agents do not silently substitute `remove_service` or `cleanup_docker` (those target managed
infrastructure services, not deployable apps).

Composite catalog:

| Composite                    | Action slots | Purpose                                                                            |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `openlander_deploy`          | 16           | Deploy plans, execution, previews, rollbacks, build logs, Git                      |
| `openlander_project`         | 14           | Project groups, secrets, temporary share URLs; env actions route to services       |
| `openlander_service`         | 19           | Deployable app/worker lifecycle, config, domain routes, and service env vocabulary |
| `openlander_managed_service` | 21           | Managed infrastructure services, credentials, backups, volumes, disk usage         |
| `openlander_monitor`         | 10           | Logs, alerts, system stats, host diagnosis, project stats, probes                  |

`openlander_project` owns group/config actions. `openlander_service` owns deployable runtime actions.

## Tool Categories

| Category                                                 | Tools | Description                            |
| -------------------------------------------------------- | ----- | -------------------------------------- |
| [Deploy Plan](#deploy-plan)                              | 5     | Create, update, execute deploy plans   |
| [Deployment Controls](#deployment-controls)              | 6     | Status, rollback, previews             |
| [Project Operations](#project-operations)                | 4     | Group listing and group-scoped config  |
| [Environment Variables](#environment-variables--secrets) | 11    | Env vars, secrets, secret files        |
| [Services](#services--infrastructure)                    | 17    | Create databases, manage infra         |
| [Domains](#domains)                                      | 2     | Register Host/path domain routes       |
| [Git & Repository](#git--repository)                     | 4     | Scan repos, list GitHub repos          |
| [Monitoring](#monitoring--logs)                          | 10    | Logs, stats, alerts, host diagnosis    |
| [Debug](#debug--troubleshooting)                         | 1     | Build logs for external-agent analysis |
| [Volume Management](#volume-management)                  | 5     | Docker volumes, disk cleanup           |
| [Infrastructure Analysis](#infrastructure-analysis)      | 2     | Repo analysis, web search              |
| [Platform Admin](#platform-admin)                        | 13    | Health, events, docker inspect         |

---

## Deploy Plan

### `create_deploy_plan`

Analyze a repository and create a deployment plan.

| Parameter           | Type    | Required | Description                    |
| ------------------- | ------- | -------- | ------------------------------ |
| `repo_url`          | string  | No       | Git repository URL             |
| `branch`            | string  | No       | Branch to deploy               |
| `name`              | string  | No       | Project name                   |
| `source`            | string  | No       | `'git'` or `'image'`           |
| `image`             | string  | No       | Docker image (if source=image) |
| `cmd`               | string  | No       | Container command override     |
| `port`              | number  | No       | Container port                 |
| `env_vars`          | object  | No       | Environment variables          |
| `prefer_dockerfile` | boolean | No       | Prefer existing Dockerfile     |
| `dockerfile_path`   | string  | No       | Relative Dockerfile path       |
| `docker_target`     | string  | No       | Docker build target stage      |

### `update_deploy_plan`

Update a deployment plan with missing values.

| Parameter | Type   | Required | Description                            |
| --------- | ------ | -------- | -------------------------------------- |
| `plan_id` | string | Yes      | Plan ID                                |
| `updates` | object | Yes      | JSON with env, dockerfile, or services |

### `execute_deploy_plan`

Execute a deployment plan (non-blocking).

| Parameter                    | Type     | Required | Description                                                          |
| ---------------------------- | -------- | -------- | -------------------------------------------------------------------- |
| `plan_id`                    | string   | Yes      | Plan ID                                                              |
| `deploy_only`                | string[] | No       | Service names for compose projects                                   |
| `approve_all_safe_resources` | boolean  | No       | Approve every proposed project-scoped managed service on the plan    |
| `approvals.create_resources` | string[] | No       | Approve specific proposed services by identifier (e.g. `postgresql`) |

When a plan is in **`needs_approval`** status it proposes project-scoped managed services
(listed in `services[]` with `resolution="proposed_project_service"`) — for example a
`postgresql` database OpenLander would auto-provision and wire to `DATABASE_URL`. The
provisioning is gated: execute returns `needs_approval` with `approval_required.create_resources`
(the identifiers to approve) and creates nothing until you approve. Re-run with
`approve_all_safe_resources=true` to approve all, or `approvals.create_resources=[...]` to approve
individually. Unapproved, compose, or not-auto-creatable services are never created — supply their
connection env (e.g. an external `DATABASE_URL`) or create them first.

Auto-provisioning is supported only for **existing** projects. Executing an approved plan for a
brand-new app (no project row yet) returns `needs_target_project` and creates nothing. To deploy
the new app now, pass an external connection URL (e.g. `DATABASE_URL`) in `env_vars` so no managed
service needs provisioning; auto-provisioning becomes available when deploying under an existing
project. OpenLander-managed shared services and external TCP database/cache endpoints are not part
of the v0.1 MCP surface.

### `deploy_app`

One-call app deploy front door. With `service_id`, `service_name`, `project_name`, or an existing
project `name`, it redeploys the existing app. With `repo_url` or `image`, it creates a new app.
For new app names, use `name`; `project_name` is only for existing app lookup/scoping.

| Parameter           | Type    | Required | Description                                 |
| ------------------- | ------- | -------- | ------------------------------------------- |
| `service_id`        | string  | No       | Existing deployable service id              |
| `service_name`      | string  | No       | Existing deployable service name            |
| `project_name`      | string  | No       | Existing group lookup or service name scope |
| `repo_url`          | string  | No       | Git repository URL for a new app            |
| `branch`            | string  | No       | Branch                                      |
| `name`              | string  | No       | New project name, or existing project alias |
| `source`            | string  | No       | `'git'` or `'image'`                        |
| `image`             | string  | No       | Docker image                                |
| `cmd`               | string  | No       | Command override                            |
| `port`              | number  | No       | Container port                              |
| `env_vars`          | object  | No       | Environment variables                       |
| `no_cache`          | boolean | No       | Force fresh build when redeploying existing |
| `strategy`          | string  | No       | Redeploy strategy for existing services     |
| `health_check_path` | string  | No       | Health check path                           |
| `wait`              | boolean | No       | Block until complete (default: true)        |
| `timeout`           | number  | No       | Max seconds to wait (default: 300)          |

### `validate_deploy_plan`

Validate a plan before executing.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `plan_id` | string | Yes      | Plan ID     |

---

## Deployment Controls

### `get_deploy_status`

Get real-time deployment status.

| Parameter      | Type    | Required | Description             |
| -------------- | ------- | -------- | ----------------------- |
| `project_id`   | string  | No       | Project group id        |
| `project_name` | string  | No       | Project group name      |
| `deploy_id`    | string  | No       | Completed deploy log id |
| `job_id`       | string  | No       | Alias for `deploy_id`   |
| `wait`         | boolean | No       | Block until complete    |
| `timeout`      | number  | No       | Max wait seconds        |

Use `project_id`/`project_name` for current in-flight deploys. Use `deploy_id`
or `job_id` to distinguish a completed deploy from an unknown id; unknown ids
return `status: "not_found"` instead of the same empty list as "no active jobs".

### `get_deploy_history`

Get deployment history.

| Parameter      | Type   | Required | Description               |
| -------------- | ------ | -------- | ------------------------- |
| `project_id`   | string | No       | Project group id          |
| `project_name` | string | No       | Project group name        |
| `limit`        | number | No       | Max entries (default: 10) |

Provide either `project_id` or `project_name`.

### `rollback_service`

Rollback a deployable app/worker service to the stored previous Docker image.
This is an image rollback only: it does not restore databases, volumes,
environment variables, secrets, or service configuration.

| Parameter      | Type   | Required | Description                           |
| -------------- | ------ | -------- | ------------------------------------- |
| `service_id`   | string | No       | Deployable service id                 |
| `service_name` | string | No       | Deployable service name               |
| `project_name` | string | No       | Optional group scope for name lookups |

Provide either `service_id` or `service_name`. If no previous image tag is
available, fix the source/configuration issue and use `redeploy_app` instead.

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

### `list_projects`

List all projects with status, ports, URLs. No parameters.

### `redeploy_app` / `restart_service`

Deploy or restart a deployable app/worker service. Project-level runtime actions have been removed.

| Parameter           | Type    | Required | Description                                                                                      |
| ------------------- | ------- | -------- | ------------------------------------------------------------------------------------------------ |
| `service_id`        | string  | No       | Deployable service id                                                                            |
| `service_name`      | string  | No       | Deployable service name                                                                          |
| `project_name`      | string  | No       | Optional group scope for name lookups                                                            |
| `no_cache`          | boolean | No       | Force fresh build                                                                                |
| `strategy`          | string  | No       | `'force'` by default; `'blue-green'` only for eligible git/image services behind managed Traefik |
| `health_check_path` | string  | No       | Health check path                                                                                |

Provide either `service_id` or `service_name`.

`strategy="blue-green"` is conditional in v0.1.3. It is rejected with
`BLUE_GREEN_UNSUPPORTED` for compose stacks, services without a current running
container, services without a health check or explicit `health_check_path`, and
installations not using managed OpenLander/Traefik HTTP-provider routes. The
zero-downtime guarantee applies to OpenLander domain/Traefik routes only; direct
`localhost:{assigned_port}` URLs may change during deploy.

Blue-green in v0.1.3 is best-effort. OpenLander health-checks the green
container directly, flips the active route target, waits for the managed Traefik
HTTP provider polling window, and probes the public route before removing blue.
It does not yet prove that the successful HTTP response came from green via a
Traefik API resolved-target check or app version marker.

For blue-green, make `health_check_path` a readiness endpoint, not a static page.
If the service needs a database, cache, storage bucket, or other dependency to
serve real traffic, the readiness endpoint should check those dependencies before
returning 2xx.

### `expose_public` / `unexpose_public`

Create or remove a temporary public share URL for a project. This is an optional public-access
feature and requires a configured tunnel backend on the OpenLander host. If the tunnel backend is
not installed/configured, use the normal service URL, custom domain routing, or configure the tunnel
first.

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |

### `update_service_config`

Update deployable service build configuration.

| Parameter         | Type   | Required | Description                           |
| ----------------- | ------ | -------- | ------------------------------------- |
| `service_id`      | string | No       | Deployable service id                 |
| `service_name`    | string | No       | Deployable service name               |
| `project_name`    | string | No       | Optional group scope for name lookups |
| `dockerfile_path` | string | No       | Dockerfile path                       |
| `docker_target`   | string | No       | Build target                          |
| `build_context`   | string | No       | Build context path                    |

---

## Environment Variables & Secrets

### `list_env_vars` / `get_env_var`

| Parameter      | Type    | Required       | Description                                  |
| -------------- | ------- | -------------- | -------------------------------------------- |
| `service_id`   | string  | No             | Deployable service id                        |
| `service_name` | string  | No             | Deployable service name                      |
| `project_name` | string  | No             | Convenience target for single-service groups |
| `key`          | string  | Yes (get only) | Env var key                                  |
| `reveal`       | boolean | No (list only) | Return raw values instead of masked values   |

Env vars belong to deployable services. Prefer `service_id` or `service_name`; `project_name`
is accepted only when the group has exactly one deployable service, otherwise the tool
returns `SERVICE_SELECTION_REQUIRED` with candidates. `list_env_vars` masks by default.
`NEXT_PUBLIC_*`, `PUBLIC_*`, `VITE_PUBLIC_*`, and `NUXT_PUBLIC_*` are treated as public and
are not masked. Empty strings render as `""`; missing single-key lookups throw `NOT_FOUND`.

### `set_env_vars`

| Parameter        | Type    | Required | Description                                       |
| ---------------- | ------- | -------- | ------------------------------------------------- |
| `service_id`     | string  | No       | Deployable service id                             |
| `service_name`   | string  | No       | Deployable service name                           |
| `project_name`   | string  | No       | Convenience target for single-service groups      |
| `variables`      | object  | Yes      | Key-value pairs; values must be strings           |
| `defer_redeploy` | boolean | No       | Default `true`; pass `false` to apply immediately |

`set_env_vars` is an upsert keyed by `(service_id, key)`. It saves only by default and returns
`changed: [{ key, op }]`, where `op` is `insert`, `update`, or `noop`. `null` values are rejected
with `BAD_REQUEST`; `""` stores an explicit empty value. To apply saved changes to a running
container, call `redeploy_app`, or pass `defer_redeploy=false`.

### `export_env_vars`

| Parameter      | Type   | Required | Description                                  |
| -------------- | ------ | -------- | -------------------------------------------- |
| `service_id`   | string | No       | Deployable service id                        |
| `service_name` | string | No       | Deployable service name                      |
| `project_name` | string | No       | Convenience target for single-service groups |

Exports all service env vars as raw `.env` text and records an audit event without storing raw values in the audit log.

### `delete_env_var` / `bulk_delete_env_vars`

| Parameter        | Type     | Required            | Description                                       |
| ---------------- | -------- | ------------------- | ------------------------------------------------- |
| `service_id`     | string   | No                  | Deployable service id                             |
| `service_name`   | string   | No                  | Deployable service name                           |
| `project_name`   | string   | No                  | Convenience target for single-service groups      |
| `key`            | string   | Yes (single delete) | Env var key                                       |
| `keys`           | string[] | Yes (bulk delete)   | Env var keys                                      |
| `confirm`        | boolean  | Yes (bulk apply)    | Omit or pass `false` for dry-run preview only     |
| `defer_redeploy` | boolean  | No                  | Default `true`; pass `false` to apply immediately |

`bulk_delete_env_vars` without `confirm=true` returns `{ would_delete, not_found, count_to_delete, confirm_required: true }` and makes no changes.

### `set_global_secret` / `list_global_secrets`

| Parameter     | Type   | Required | Description  |
| ------------- | ------ | -------- | ------------ |
| `key`         | string | Yes      | Secret key   |
| `value`       | string | Yes      | Secret value |
| `description` | string | No       | Description  |

### `expose_public` / `unexpose_public`

Project composite aliases for temporary public URLs. This is optional and depends on the configured
tunnel backend; it is not required for normal deploy/redeploy flows.

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
| `project_id`   | string | No       | Attach to this project group id                                |
| `project_name` | string | No       | Attach to this project group name                              |

`create_service` requires `project_id` or `project_name`. This keeps new
databases/caches attached to the isolated project Docker network used by the app
that will consume them. Cross-project shared managed services are not exposed in
v0.1, and OpenLander does not expose managed database/cache ports over external
TCP. Create the service with the target app's `project_id` or `project_name`.

### `list_services`

| Parameter         | Type    | Required | Description                                     |
| ----------------- | ------- | -------- | ----------------------------------------------- |
| `include_orphans` | boolean | No       | Include unmanaged OpenLander service containers |

`include_orphans=true` surfaces OpenLander-managed service containers that still exist in Docker but are missing from the `services` table.

MCP `list_services` intentionally omits credential values. Use `get_service_credentials` for connection strings, users, passwords, and database names.

### `get_service_status`

| Parameter      | Type   | Required | Description                         |
| -------------- | ------ | -------- | ----------------------------------- |
| `service_id`   | string | No       | Managed/infrastructure service id   |
| `service_name` | string | No       | Managed/infrastructure service name |

Provide either `service_id` or `service_name`. Deployable app/worker services are intentionally rejected; use `openlander_service` or `diagnose_service` for those.

### `start_service` / `stop_service`

| Parameter      | Type   | Required | Description                         |
| -------------- | ------ | -------- | ----------------------------------- |
| `service_name` | string | Yes      | Managed/infrastructure service name |

### `exec_service_container`

| Parameter         | Type     | Required | Description                         |
| ----------------- | -------- | -------- | ----------------------------------- |
| `service_name`    | string   | Yes      | Managed/infrastructure service name |
| `command`         | string[] | Yes      | Command argv array                  |
| `timeout_seconds` | number   | No       | Max execution time                  |

`command` must be an argv array such as `["psql", "-U", "openlander", "-c", "SELECT 1"]`.
Shell strings like `"psql -U openlander"` are intentionally rejected.

`remove_service` is human-only in OpenLander 0.1 and returns
`OPERATION_REQUIRES_HUMAN_UI` from MCP. Use the service page delete action for
typed-confirm deletion with the managed-volume opt-in checkbox.

### `get_service_credentials`

| Parameter      | Type   | Required | Description                         |
| -------------- | ------ | -------- | ----------------------------------- |
| `service_id`   | string | No       | Managed/infrastructure service id   |
| `service_name` | string | No       | Managed/infrastructure service name |

Provide either `service_id` or `service_name`.

### `get_service_logs`

| Parameter      | Type   | Required | Description                   |
| -------------- | ------ | -------- | ----------------------------- |
| `service_name` | string | Yes      | Service name                  |
| `lines`        | number | No       | Number of lines (default: 50) |

### Database Operations

`create_database` / `list_databases` / `create_service_user`

| Parameter       | Type   | Required   | Description               |
| --------------- | ------ | ---------- | ------------------------- |
| `service_name`  | string | Yes        | Service name              |
| `database_name` | string | Yes        | Database name             |
| `username`      | string | Yes (user) | Username                  |
| `password`      | string | No         | Auto-generated if omitted |

### MinIO Bucket Operations

`create_bucket` / `list_buckets` / `delete_bucket`

| Parameter      | Type   | Required | Description        |
| -------------- | ------ | -------- | ------------------ |
| `service_name` | string | Yes      | MinIO service name |
| `bucket_name`  | string | Yes      | Bucket name        |

### Backup Operations

`backup_service` / `restore_service` / `list_service_backups`

| Parameter      | Type   | Required      | Description  |
| -------------- | ------ | ------------- | ------------ |
| `service_name` | string | Yes           | Service name |
| `backup_id`    | string | Yes (restore) | Backup ID    |

---

## Domains

### `add_domain_route`

| Parameter              | Type    | Required | Description                                              |
| ---------------------- | ------- | -------- | -------------------------------------------------------- |
| `service_id`           | string  | No       | Preferred deployable service id                          |
| `service_name`         | string  | No       | Deployable service name                                  |
| `project_id`           | string  | No       | Optional project group id for single-deployable groups   |
| `project_name`         | string  | No       | Optional project group name for single-deployable groups |
| `domain`               | string  | Yes      | Domain host that already points to OpenLander            |
| `path_prefix`          | string  | No       | Public path prefix to match (default `/`)                |
| `strip_prefix`         | boolean | No       | Strip `path_prefix` before forwarding                    |
| `upstream_path_prefix` | string  | No       | Internal path prefix to add before forwarding            |
| `target_port`          | number  | No       | Override the service container port for this route       |

Provide `service_id`, `service_name`, `project_id`, or `project_name`. Multi-service groups require
an explicit service target.

Domain route = a Traefik Host/path route for a domain already pointed at OpenLander port 80.
OpenLander v0.1 does not create DNS records, Cloudflare tunnels, ngrok endpoints, or TLS
certificates. Docker labels are not the source of truth for custom domains; check
`/api/traefik/config` and Traefik loaded routers when debugging.

### `list_domain_routes`

Optional `service_id`, `service_name`, `project_id`, or `project_name` filters. With no parameters,
lists all registered domain routes.

---

## Git & Repository

### `scan_dockerfiles` / `scan_project`

| Parameter  | Type   | Required | Description        |
| ---------- | ------ | -------- | ------------------ |
| `repo_url` | string | Yes      | Git repository URL |
| `branch`   | string | No       | Branch             |

### `list_github_repos`

| Parameter    | Type   | Required | Description                |
| ------------ | ------ | -------- | -------------------------- |
| `page`       | number | No       | Page number                |
| `visibility` | string | No       | `all`, `public`, `private` |

### `search_github_repos`

| Parameter | Type   | Required | Description  |
| --------- | ------ | -------- | ------------ |
| `query`   | string | Yes      | Search query |

GitHub repository discovery returns safe HTTPS clone URLs only. Private-repo credentials are injected internally at clone time and are never included in MCP responses.

---

## Monitoring & Logs

### `get_instance_info`

No parameters. Returns the current OpenLander MCP instance identity:
`id`, `name`, `endpoint`, `host`, `suggestedName`, and whether the name is still a default.
Use this first when multiple OpenLander servers are connected to the same AI client.

### `get_logs`

| Parameter      | Type   | Required | Description                                           |
| -------------- | ------ | -------- | ----------------------------------------------------- |
| `service_id`   | string | No       | Deployable service id; preferred from `list_projects` |
| `service_name` | string | No       | Deployable service name                               |
| `project_id`   | string | No       | Convenience target for single-service groups          |
| `project_name` | string | No       | Convenience target for single-service groups          |
| `lines`        | number | No       | Number of lines                                       |

Provide one of `service_id`, `service_name`, `project_id`, or `project_name`. Prefer
`service_id` when chaining from `list_projects`.

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

| Parameter      | Type   | Required | Description                                  |
| -------------- | ------ | -------- | -------------------------------------------- |
| `service_id`   | string | No       | Deployable service id; preferred             |
| `service_name` | string | No       | Deployable service name                      |
| `project_id`   | string | No       | Convenience target for single-service groups |
| `project_name` | string | No       | Convenience target for single-service groups |

### `diagnose_service`

| Parameter           | Type   | Required | Description                                  |
| ------------------- | ------ | -------- | -------------------------------------------- |
| `service_id`        | string | No       | Deployable service id; preferred             |
| `service_name`      | string | No       | Deployable service name                      |
| `project_id`        | string | No       | Convenience target for single-service groups |
| `project_name`      | string | No       | Convenience target for single-service groups |
| `path`              | string | No       | HTTP path to probe                           |
| `health_check_path` | string | No       | Alias for `path`                             |
| `lines`             | number | No       | Log lines to include                         |

If `path` is omitted, OpenLander uses a configured base path env such as
`NEXT_PUBLIC_BASE_PATH` before falling back to the service health path.

### `probe_host`

| Parameter      | Type    | Required | Description                                         |
| -------------- | ------- | -------- | --------------------------------------------------- |
| `target`       | string  | No       | Hostname, URL, IP, or `container-name:port`         |
| `host`         | string  | No       | Alias for `target`                                  |
| `port`         | number  | No       | Port for TCP or host-only probes                    |
| `protocol`     | string  | No       | `http`, `https`, or `tcp`; default auto-detect      |
| `path`         | string  | No       | HTTP path                                           |
| `internal`     | boolean | No       | Probe from the target project container when `true` |
| `service_id`   | string  | No       | Deployable service context for internal probes      |
| `service_name` | string  | No       | Deployable service name context for internal probes |
| `project_id`   | string  | No       | Project context for internal probes                 |
| `project_name` | string  | No       | Project context for internal probes                 |
| `timeout_ms`   | number  | No       | Probe timeout                                       |

Provide either `target` or `host`. When `internal=true`, also provide
`service_id`, `service_name`, `project_id`, or `project_name` so OpenLander can
probe from the correct isolated project network.

### `mcp_action_status`

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

| Parameter      | Type   | Required | Description               |
| -------------- | ------ | -------- | ------------------------- |
| `deploy_id`    | string | No       | Deploy log id             |
| `project_id`   | string | No       | Project group id          |
| `project_name` | string | No       | Project group name        |
| `deploy_index` | number | No       | Deploy index (0 = latest) |

Provide `deploy_id` by itself when known, or provide `project_id`/`project_name` with optional `deploy_index`.

OpenLander 0.1 does not expose built-in AI diagnosis. External MCP agents should
read `get_build_log` / `get_logs`, inspect the failure in their own context, then
apply config/repo changes and call `redeploy_app`.

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

### `get_disk_usage`

Docker disk usage breakdown. No parameters. If Docker's `df` endpoint stalls under heavy host
load, the tool returns `unavailable: true` with `DOCKER_DISK_USAGE_UNAVAILABLE` instead of
timing out the MCP request.

### `cleanup_docker`

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

### `platform_cleanup_orphans` / `platform_reconcile` / `platform_force_remove`

| Parameter      | Type    | Required           | Description                  |
| -------------- | ------- | ------------------ | ---------------------------- |
| `confirm`      | boolean | Yes                | Must be true                 |
| `dry_run`      | boolean | No                 | Preview mode (default: true) |
| `container_id` | string  | Yes (force_remove) | Container ID                 |

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
- Logs, raw build output, Docker details, host resources, and full diagnostics
  are fetched through dedicated actions such as `get_build_log`,
  `diagnose_service`, and `diagnose_host_resources`.
- `execute_deploy_plan` is non-blocking — always poll `get_deploy_status`
- Timestamps are ISO 8601 format.
- Error responses include machine-readable codes.
