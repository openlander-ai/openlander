# MCP Tools Reference

OpenLander exposes its functionality to AI coding agents through a **composite-tool surface**:

- **5 composite tools** — enabled by default
- **66 unique default operations** surfaced through those composites
- **13 platform tools** for server admin (health, Docker inspect, orphan adoption, etc.) — gated behind `config.mcp.platformTools: true`

Each composite takes `{ action, params }` — e.g. `openlander_deploy({ action: "deploy_app", params: { repo_url: "..." } })`. Run `{ action: "help" }` on any composite to list its action catalog.

Model note: **Project = workspace/group** and **Service = deployable unit**. Repository, image,
branch, Dockerfile, and build context belong to services. Project-level runtime actions have been
removed; use service runtime actions instead.

Remote MCP uses scoped Bearer tokens. Use **Settings → MCP** for org-wide admin tokens and a
project's **MCP** tab for project-scoped agent tokens. Project-scoped tokens are the safer default
for daily work because they cannot operate outside the project group where they were issued.

Destructive MCP operations are intentionally gated. Service deletion is blocked at the MCP boundary
and must be completed in the web UI with typed confirmation. Supported bulk cleanup actions such as
`bulk_delete_env_vars confirm=true` enter the human approval hold queue before execution.

Composite catalog:

| Composite                    | Action slots | Purpose                                                                    |
| ---------------------------- | ------------ | -------------------------------------------------------------------------- |
| `openlander_deploy`          | 18           | Deploy plans, execution, previews, rollbacks, build logs, Git, domains     |
| `openlander_project`         | 14           | Project groups, secrets, public exposure; env actions route to services    |
| `openlander_service`         | 19           | Deployable app/worker lifecycle, config, and service env vocabulary        |
| `openlander_managed_service` | 21           | Managed infrastructure services, credentials, backups, volumes, disk usage |
| `openlander_monitor`         | 8            | Logs, alerts, system stats, project stats, probes                          |

`openlander_project` owns group/config actions. `openlander_service` owns deployable runtime actions.

## Tool Categories

| Category                                                 | Tools | Description                            |
| -------------------------------------------------------- | ----- | -------------------------------------- |
| [Deploy Plan](#deploy-plan)                              | 5     | Create, update, execute deploy plans   |
| [Deployment Controls](#deployment-controls)              | 6     | Status, rollback, previews             |
| [Project Operations](#project-operations)                | 4     | Group listing and group-scoped config  |
| [Environment Variables](#environment-variables--secrets) | 11    | Env vars, secrets, secret files        |
| [Services](#services--infrastructure)                    | 17    | Create databases, manage infra         |
| [Domains](#domains)                                      | 2     | Map custom domains                     |
| [Git & Repository](#git--repository)                     | 4     | Scan repos, list GitHub repos          |
| [Monitoring](#monitoring--logs)                          | 5     | Logs, stats, alerts                    |
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

| Parameter     | Type     | Required | Description                        |
| ------------- | -------- | -------- | ---------------------------------- |
| `plan_id`     | string   | Yes      | Plan ID                            |
| `deploy_only` | string[] | No       | Service names for compose projects |

### `deploy_app`

One-call deploy: analyze, plan, execute, optionally wait.

| Parameter  | Type    | Required | Description                          |
| ---------- | ------- | -------- | ------------------------------------ |
| `repo_url` | string  | No       | Git repository URL                   |
| `branch`   | string  | No       | Branch                               |
| `name`     | string  | No       | Project name                         |
| `source`   | string  | No       | `'git'` or `'image'`                 |
| `image`    | string  | No       | Docker image                         |
| `cmd`      | string  | No       | Command override                     |
| `port`     | number  | No       | Container port                       |
| `env_vars` | object  | No       | Environment variables                |
| `wait`     | boolean | No       | Block until complete (default: true) |
| `timeout`  | number  | No       | Max seconds to wait (default: 300)   |

### `validate_deploy_plan`

Validate a plan before executing.

| Parameter | Type   | Required | Description |
| --------- | ------ | -------- | ----------- |
| `plan_id` | string | Yes      | Plan ID     |

---

## Deployment Controls

### `get_deploy_status`

Get real-time deployment status.

| Parameter      | Type    | Required | Description                 |
| -------------- | ------- | -------- | --------------------------- |
| `project_name` | string  | No       | Project name (omit for all) |
| `wait`         | boolean | No       | Block until complete        |
| `timeout`      | number  | No       | Max wait seconds            |

### `get_deploy_history`

Get deployment history.

| Parameter      | Type   | Required | Description               |
| -------------- | ------ | -------- | ------------------------- |
| `project_name` | string | Yes      | Project name              |
| `limit`        | number | No       | Max entries (default: 10) |

### `rollback_service`

Rollback a deployable app/worker service to the previous Docker image.

| Parameter      | Type   | Required | Description                           |
| -------------- | ------ | -------- | ------------------------------------- |
| `service_id`   | string | No       | Deployable service id                 |
| `service_name` | string | No       | Deployable service name               |
| `project_name` | string | No       | Optional group scope for name lookups |

Provide either `service_id` or `service_name`.

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

| Parameter           | Type    | Required | Description                           |
| ------------------- | ------- | -------- | ------------------------------------- |
| `service_id`        | string  | No       | Deployable service id                 |
| `service_name`      | string  | No       | Deployable service name               |
| `project_name`      | string  | No       | Optional group scope for name lookups |
| `no_cache`          | boolean | No       | Force fresh build                     |
| `strategy`          | string  | No       | `'blue-green'` or `'force'`           |
| `health_check_path` | string  | No       | Health check path                     |

Provide either `service_id` or `service_name`.

### `archive_service` / `unarchive_service`

Archive or restore a deployable service while preserving configuration, environment variables, and history.

| Parameter      | Type   | Required | Description                           |
| -------------- | ------ | -------- | ------------------------------------- |
| `service_id`   | string | No       | Deployable service id                 |
| `service_name` | string | No       | Deployable service name               |
| `project_name` | string | No       | Optional group scope for name lookups |

### `expose_public` / `unexpose_public`

Expose a project publicly through a temporary tunnel, or remove that public exposure.

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

| Parameter  | Type   | Required | Description                                                    |
| ---------- | ------ | -------- | -------------------------------------------------------------- |
| `name`     | string | Yes      | Service name                                                   |
| `template` | string | No       | `postgresql`, `mysql`, `redis`, `mongodb`, `rabbitmq`, `minio` |
| `image`    | string | No       | Custom Docker image                                            |
| `port`     | number | No       | Port number                                                    |

### `list_services`

| Parameter         | Type    | Required | Description                                     |
| ----------------- | ------- | -------- | ----------------------------------------------- |
| `include_orphans` | boolean | No       | Include unmanaged OpenLander service containers |

`include_orphans=true` surfaces OpenLander-managed service containers that still exist in Docker but are missing from the `services` table.

MCP `list_services` intentionally omits credential values. Use `get_service_credentials` for connection strings, users, passwords, and database names.

### `get_service_status` / `start_service` / `stop_service`

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `service_name` | string | Yes      | Service name |

`remove_service` is human-only in OpenLander 0.1 and returns
`OPERATION_REQUIRES_HUMAN_UI` from MCP. Use the service page delete action for
typed-confirm deletion with the managed-volume opt-in checkbox.

### `get_service_credentials`

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `service_name` | string | Yes      | Service name |

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

### `map_domain`

| Parameter      | Type   | Required | Description                                                                |
| -------------- | ------ | -------- | -------------------------------------------------------------------------- |
| `service_id`   | string | No       | Preferred deployable service id                                            |
| `service_name` | string | No       | Deployable service name                                                    |
| `project_name` | string | No       | Optional group scope; legacy fallback only works for single-service groups |
| `domain`       | string | Yes      | Domain name                                                                |

Provide `service_id`, `service_name`, or `project_name`. Multi-service groups require an explicit
service target.

### `list_domains`

No parameters.

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

---

## Monitoring & Logs

### `get_logs`

| Parameter      | Type   | Required | Description     |
| -------------- | ------ | -------- | --------------- |
| `project_name` | string | Yes      | Project name    |
| `lines`        | number | No       | Number of lines |

### `get_system_stats`

Host CPU, memory, disk usage. No parameters.

### `get_project_stats`

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |

### `get_alerts` / `dismiss_alert`

| Parameter  | Type   | Required      | Description |
| ---------- | ------ | ------------- | ----------- |
| `alert_id` | string | Yes (dismiss) | Alert ID    |

---

## Debug & Troubleshooting

### `get_build_log`

| Parameter      | Type   | Required | Description               |
| -------------- | ------ | -------- | ------------------------- |
| `project_name` | string | Yes      | Project name              |
| `deploy_index` | number | No       | Deploy index (0 = latest) |

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

- All tools return structured JSON responses
- Tool responses include `_agent_guidance` with suggested next steps
- `execute_deploy_plan` is non-blocking — always poll `get_deploy_status`
- Timestamps are ISO 8601 format
- Error responses include machine-readable codes
