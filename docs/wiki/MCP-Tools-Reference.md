# MCP Tools Reference

OpenLander exposes its functionality to AI coding agents through a **composite-tool surface**:

- **4 composite tools** (`openlander_deploy`, `openlander_project`, `openlander_service`, `openlander_monitor`) bundling **70 actions** — enabled by default
- **11 platform tools** for server admin (health, docker inspect, etc.) — gated behind `config.mcp.platformTools: true`

Each composite takes `{ action, params }` — e.g. `openlander_deploy({ action: "deploy", params: { repo_url: "..." } })`. Run `{ action: "help" }` on any composite to list its action catalog.

Internally these compose 99 `ToolDef` entries (used by both the web UI and MCP adapter); the counts below refer to the underlying category groupings, which roll up into the 4 composites.

## Tool Categories

| Category                                                 | Tools | Description                            |
| -------------------------------------------------------- | ----- | -------------------------------------- |
| [Deploy Plan](#deploy-plan)                              | 5     | Create, update, execute deploy plans   |
| [Deployment Controls](#deployment-controls)              | 7     | Status, rollback, blue-green, previews |
| [Project Operations](#project-operations)                | 8     | Start, stop, remove, redeploy, share   |
| [Environment Variables](#environment-variables--secrets) | 10    | Env vars, secrets, secret files        |
| [Services](#services--infrastructure)                    | 17    | Create databases, manage infra         |
| [Domains](#domains)                                      | 2     | Map custom domains                     |
| [Git & Repository](#git--repository)                     | 4     | Scan repos, list GitHub repos          |
| [Docker Compose](#docker-compose)                        | 3     | Deploy multi-service projects          |
| [Monitoring](#monitoring--logs)                          | 5     | Logs, stats, alerts                    |
| [Debug](#debug--troubleshooting)                         | 2     | Build logs, error analysis             |
| [Volume Management](#volume-management)                  | 5     | Docker volumes, disk cleanup           |
| [Webhooks](#webhooks)                                    | 3     | Auto-deploy webhooks                   |
| [Infrastructure Analysis](#infrastructure-analysis)      | 2     | Repo analysis, web search              |
| [Platform Admin](#platform-admin)                        | 12    | Health, events, docker inspect         |

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

### `deploy`

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

### `rollback_project`

Rollback to previous Docker image.

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |

### `deploy_blue_green`

Zero-downtime deploy with blue-green strategy.

| Parameter           | Type   | Required | Description           |
| ------------------- | ------ | -------- | --------------------- |
| `project_name`      | string | Yes      | Project name          |
| `health_check_path` | string | No       | Health check endpoint |

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

### `stop_project` / `start_project` / `restart_project`

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |

`restart_project` also accepts `no_cache` (boolean) to force fresh build.

### `remove_project`

Permanently remove project and container.

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |

### `redeploy_project`

Redeploy with same configuration.

| Parameter           | Type    | Required | Description                 |
| ------------------- | ------- | -------- | --------------------------- |
| `project_name`      | string  | Yes      | Project name                |
| `no_cache`          | boolean | No       | Force fresh build           |
| `strategy`          | string  | No       | `'blue-green'` or `'force'` |
| `health_check_path` | string  | No       | Health check path           |

### `share_project`

Generate temporary public URL via TryCloudflare.

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |

### `update_project_config`

Update build configuration.

| Parameter         | Type   | Required | Description        |
| ----------------- | ------ | -------- | ------------------ |
| `project_name`    | string | Yes      | Project name       |
| `dockerfile_path` | string | No       | Dockerfile path    |
| `docker_target`   | string | No       | Build target       |
| `build_context`   | string | No       | Build context path |

---

## Environment Variables & Secrets

### `list_env_vars` / `get_env_var`

| Parameter      | Type   | Required       | Description  |
| -------------- | ------ | -------------- | ------------ |
| `project_name` | string | Yes            | Project name |
| `key`          | string | Yes (get only) | Env var key  |

### `set_env_vars`

| Parameter      | Type   | Required | Description     |
| -------------- | ------ | -------- | --------------- |
| `project_name` | string | Yes      | Project name    |
| `variables`    | object | Yes      | Key-value pairs |

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

No parameters.

### `get_service_status` / `start_service` / `stop_service` / `remove_service`

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `service_name` | string | Yes      | Service name |

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

`create_database` / `list_databases` / `create_service_database` / `create_service_user`

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

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |
| `domain`       | string | Yes      | Domain name  |

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

## Docker Compose

### `deploy_compose`

| Parameter  | Type     | Required | Description        |
| ---------- | -------- | -------- | ------------------ |
| `repo_url` | string   | Yes      | Git repository URL |
| `branch`   | string   | No       | Branch             |
| `name`     | string   | No       | Project name       |
| `profiles` | string[] | No       | Compose profiles   |

### `list_compose_services`

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |

### `orchestrate_deploy`

Deploy monorepo services in dependency order.

| Parameter  | Type     | Required | Description        |
| ---------- | -------- | -------- | ------------------ |
| `repo_url` | string   | Yes      | Git repository URL |
| `branch`   | string   | No       | Branch             |
| `profiles` | string[] | No       | Compose profiles   |

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

### `debug_build_error`

Analyze build failure with AI.

| Parameter      | Type   | Required | Description    |
| -------------- | ------ | -------- | -------------- |
| `project_name` | string | Yes      | Project name   |
| `build_log`    | string | No       | Build log text |

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

Docker disk usage breakdown. No parameters.

### `cleanup_docker`

| Parameter | Type   | Required | Description                                          |
| --------- | ------ | -------- | ---------------------------------------------------- |
| `level`   | string | No       | `soft`, `standard`, `aggressive` (default: standard) |

---

## Webhooks

### `enable_webhook`

| Parameter       | Type   | Required | Description                     |
| --------------- | ------ | -------- | ------------------------------- |
| `project_name`  | string | Yes      | Project name                    |
| `source`        | string | Yes      | `github`, `gitlab`, `bitbucket` |
| `branch_filter` | string | No       | Branch to trigger on            |

### `disable_webhook`

| Parameter      | Type   | Required | Description                     |
| -------------- | ------ | -------- | ------------------------------- |
| `project_name` | string | Yes      | Project name                    |
| `source`       | string | Yes      | `github`, `gitlab`, `bitbucket` |

### `get_webhook_config`

| Parameter      | Type   | Required | Description  |
| -------------- | ------ | -------- | ------------ |
| `project_name` | string | Yes      | Project name |

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

> These tools require admin access and are config-gated (`mcp.platformTools: true`).

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
