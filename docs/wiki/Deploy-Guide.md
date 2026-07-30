# Deploy Guide

## Overview

OpenLander deploys **Applications** and **Compose** stacks through a plan-first pipeline. A
**Project** is the workspace that holds related resources; a repository, Docker image, or compose
stack is attached inside that Project.

```
create_deploy_plan  →  validate_deploy_plan  →  execute_deploy_plan  →  get_deploy_status
     ↓                         ↓                         ↓                       ↓
  Analyze repo           Catch bad env/URLs         Docker build + run      Poll until done
  Detect services        Check missing input        Traefik routing         completed / failed
  Check env vars         Confirm readiness
```

There's also a convenience `deploy_app` tool that combines all 3 steps.
`deploy_app(target_project_id=...)` adds a newly deployed Application, worker,
or Compose workload into an existing Project. Containers use the target
Project network from their first start, and the parent plus Compose children
are attached transactionally after deployment succeeds. The attach is owned by
the durable deploy-plan execution path, so MCP disconnects or timeouts do not
own the group move. It is not supported with `expose=true`; expose the service
after attach if needed.

Repository selection is deterministic: a valid Compose file is the default;
without Compose, one Dockerfile creates one Application per plan. If multiple
Dockerfiles are found, OpenLander returns `DOCKERFILE_SELECTION_REQUIRED` with
`candidate_dockerfiles`. Retry with one `dockerfile_path`, and repeat with the
same `target_project_id` to add sibling Applications. Set
`prefer_dockerfile=true` to override Compose; when a root `Dockerfile` exists,
it is selected.

## Mental Model

| Term                            | Meaning                                                                            | Use it for                                       |
| ------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| Project                         | A workspace that groups related resources.                                         | Organization, settings, resource list.           |
| Application                     | An app, API, worker, or image workload that OpenLander builds/runs.                | Env vars, redeploys, domains, logs, diagnostics. |
| Compose                         | A compose stack represented as one Project-level resource.                         | Stack deploys and stack-level diagnostics.       |
| Database/Cache/Storage resource | Project-scoped infrastructure such as PostgreSQL, MySQL, Redis, MongoDB, or MinIO. | Credentials, backups, databases, buckets.        |

After a deploy, call `list_projects` and keep the returned Application/Compose
`service_id`. In v0.1.x this compatibility field appears at
`projects[].deployable_service.service_id`. Use that `service_id` for follow-up
MCP actions such as `update_app`, `set_env_vars`, `add_domain_route`, and
`diagnose_service`.

---

## Try It: Deploy the Demo App

The fastest end-to-end check. From any connected agent:

> "Deploy https://github.com/openlander-ai/openlander-demo-app to OpenLander."

The agent runs `deploy_app(repo_url: "https://github.com/openlander-ai/openlander-demo-app", name: "demo")`,
polls `get_deploy_status`, and returns the app URL. Confirm the app responds at its `/health` path.

### Add a Database resource (agent-driven, multi-step)

A new-app deploy does **not** auto-provision a database in one shot. Wire one explicitly.
First call `list_projects` and note the demo's `project_id` (or `project_name`) and its
Application `service_id` (`deployable_service.service_id` in v0.1.x compatibility
output) — `create_service` requires a project target so the database lands on the
same isolated network as the app.

1. `openlander_managed_service.create_service(name: "demo-db", template: "postgresql", project_id: "<project_id>")`
2. `openlander_managed_service.get_service_credentials(service_id: "<db service_id>")`
3. `openlander_service.set_env_vars(service_id: "<app service_id>", variables: { DATABASE_URL: "<connection string>" })`
4. `openlander_service.update_app(service_id: "<app service_id>")`
5. Verify the app's `/health` reports the database as reachable.

---

## Migrating Existing Docker/PaaS Workloads

OpenLander v0.1 is optimized for new OpenLander-managed apps and Project-scoped
resources. Existing Docker/PaaS workloads can still be moved over, but treat
that as an operator-assisted migration rather than a one-click import flow.

Before changing anything, back up persistent data and inspect the existing
containers, volumes, networks, env vars, and routing labels. Do not delete or
recreate data volumes during migration/recovery. Preserve existing Docker
assets, import the required env vars, then redeploy or reconnect services
deliberately with a human-approved runbook.

Automatic adoption of existing containers, networks, and volumes is planned
after v0.1.

---

## Deploy via Web Dashboard

### 1. Create a Project

1. Go to **Projects** → **New Project**
2. Enter a Project name
3. Open the project and click **Add application**
4. Tell your agent what to deploy:
   - Git repository application/worker
   - Docker image
   - Docker Compose stack
   - Database/Cache resource
5. Review the deploy output in the Application detail page

This keeps the mental model aligned with Dokploy-style IA: Project first, then resources inside it.
The canonical deploy API is `POST /api/services/deploy`; it can create a Project plus the initial
Application in one request for the common single-repository case.

### 2. Monitor Deployment

- Build log streams in real-time with ANSI colors
- Progress steps shown in timeline
- On failure: build/runtime logs remain available for manual or external-agent analysis

### 3. Access Your App

After a service deploy succeeds, the service gets a URL:

- **Internal**: `http://your-server:assigned-port`
- **Traefik**: `http://service-name.your-server`
- **Public**: optional temporary share URL or a custom domain route

---

## Deploy via MCP (AI Agents)

### Quick Deploy (One Call)

```
deploy_app(
  repo_url: "https://github.com/user/my-app",
  branch: "main",
  name: "my-app",
  wait: true
)
```

This is the app deploy front door. For a new app, pass `name` as the Project name. If `name`,
`project_name`, `service_id`, or `service_name` matches an existing single Application, it
redeploys that app. Once an app exists, prefer the returned `service_id` for follow-up actions.

### Step-by-Step Deploy

For more control:

#### Step 1: Create Plan

```
create_deploy_plan(
  repo_url: "https://github.com/user/my-app",
  branch: "main"
)
```

Returns a plan with detected services, required env vars, and build config.

Plan statuses:

- `ready` — Can execute immediately
- `needs_input` — Missing env vars or config choices

#### Step 2: Update Plan (if needed)

```
update_deploy_plan(
  plan_id: "plan_xxx",
  updates: { env: { DATABASE_URL: "postgres://..." } }
)
```

#### Step 3: Execute

```
execute_deploy_plan(plan_id: "plan_xxx")
```

Returns immediately (non-blocking).

#### Step 4: Validate or Poll Status

Before executing, you can call:

```
validate_deploy_plan(plan_id: "plan_xxx")
```

After executing, poll:

```
get_deploy_status(service_id: "<service_id from status_call>")
```

Poll until status is `completed` or `failed`.

#### Step 5: Diagnose Failures

If deployment reports `failed`, `unhealthy`, timeout, or the app behaves unexpectedly:

```
diagnose_service(service_id: "my-app__svc")
```

Use `get_build_log(deploy_id: "...")` when you need the full build output. If a
container started and then crashed during deploy, the same response also includes
the captured `runtime_log` when available.

---

## Deploy Options

## API Migration Note

`Project` is no longer a repository-backed entity. `POST /api/projects` only creates an empty
group:

```json
{ "name": "my-stack" }
```

Sending `repo_url` or `branch` to `POST /api/projects` now returns `PROJECT_SOURCE_REMOVED`.
Create deployables with the canonical service endpoint instead:

```http
POST /api/services/deploy
```

Git service body:

```json
{
  "source": "git",
  "repo_url": "https://github.com/user/my-app",
  "branch": "main",
  "project_name": "my-stack",
  "service_name": "web"
}
```

Image service body:

```json
{
  "source": "image",
  "image_url": "ghcr.io/user/my-worker:latest",
  "project_name": "my-stack",
  "service_name": "worker"
}
```

If `project_id` and `project_name` are both sent, `project_id` wins and a mismatched name returns
`INVALID_PROJECT_TARGET`.

### From Git Repository

| Parameter           | Required | Description                                          |
| ------------------- | -------- | ---------------------------------------------------- |
| `repo_url`          | Yes      | Git repository URL for the service                   |
| `branch`            | No       | Branch to deploy (default: repository default)       |
| `name`              | No       | Service/project seed name (auto-generated from repo) |
| `env_vars`          | No       | JSON object of env vars                              |
| `prefer_dockerfile` | No       | Use existing Dockerfile                              |
| `dockerfile_path`   | No       | Path to Dockerfile                                   |
| `build_context`     | No       | Build context relative to repository root            |
| `docker_target`     | No       | Multi-stage build target                             |

For a monorepo Dockerfile such as `infra/Dockerfile.api` that copies shared
root packages, set `build_context: "."`. OpenLander uses BuildKit for both
single-Application and Compose Dockerfile builds.

### From Docker Image

| Parameter | Required | Description                        |
| --------- | -------- | ---------------------------------- |
| `source`  | Yes      | Set to `"image"`                   |
| `image`   | Yes      | Docker image (e.g. `nginx:latest`) |
| `port`    | No       | Container port                     |
| `cmd`     | No       | Override command                   |
| `name`    | No       | Project name                       |

### Docker Compose

For multi-service projects:

```
deploy_compose(
  repo_url: "https://github.com/user/my-stack",
  branch: "main",
  profiles: ["production"]
)
```

OpenLander manages public HTTP routing through Traefik. Compose files must not
publish host ports with `ports:` because that bypasses OpenLander's port
allocation and can break safe redeploys. Use `expose:` to document internal
container ports, then add a domain or use the generated service URL.

#### Compose environment migration

Saved OpenLander env values are interpolation input for Compose; they are not
automatically copied into every child container. Each service receives only the
keys it declares through `environment` or `env_file`:

```yaml
x-app-env: &app-env
  DATABASE_URL: ${DATABASE_URL}
  API_BASE_URL: ${API_BASE_URL}

services:
  web:
    environment:
      <<: *app-env
      NODE_ENV: production
  migrate:
    environment:
      DATABASE_URL: ${DATABASE_URL}
  static:
    environment: {} # explicitly inject no saved OpenLander env
```

This applies to a single Compose file and ordered base/overlay files; YAML merge
keys such as `<<: *app-env` are resolved before deployment. If a workload has
saved env but a service declares neither `environment` nor `env_file`, preflight
stops with `COMPOSE_ENV_DECLARATION_REQUIRED`. Add an explicit declaration for
the keys that child needs, or `environment: {}` when it intentionally receives
none. This prevents database credentials meant for an API or migration job from
being copied into a web/static container.

---

## Updating An Existing App

### Update To Latest Stored Source

```
update_app(service_id: "my-app__svc")
```

### Update with Fresh Build

```
update_app(service_id: "my-app__svc", no_cache: true)
```

For a Stateful Compose change, `update_app` can return a non-terminal approval
response instead of starting the deploy:

```json
{
  "status": "pending_approval",
  "action_run_id": "action_...",
  "diff": [{ "service_name": "db", "changed_fields": ["image"] }],
  "backup_required": true,
  "poll_call": {
    "tool": "openlander_monitor",
    "action": "mcp_action_status",
    "params": { "action_run_id": "action_..." }
  }
}
```

Review or reject it in Pending Approvals. Approval pins the commit, Compose
fingerprint, and current container; a stale plan stops with
`STATEFUL_APPROVAL_STALE`. PostgreSQL major/image-family, volume contract, and
runtime-role migrations remain blocked with `STATEFUL_MIGRATION_REQUIRED`.

### Blue-Green Deploy (Conditional Zero Downtime)

```
update_app(
  service_id: "my-app__svc",
  strategy: "blue-green",
  health_check_path: "/health"
)
```

Eligible git/image services only. Compose stacks, services without a health
check, services outside managed OpenLander/Traefik routing, and direct
`localhost:{assigned_port}` host-port access are not covered. In managed mode,
OpenLander app routes are emitted by the Traefik HTTP provider from active
service rows and active preview records; app containers do not publish their own
Docker-label Host routers.
OpenLander starts a green container, waits for health, flips the HTTP-provider
route to the green container, probes the route, stops blue, verifies the public
route still reaches green, then removes the old blue container. If the green
build/health/route probe fails, the old blue route stays active and the green
container is cleaned up.

This is a best-effort zero-downtime path, not a hard guarantee. OpenLander waits
for the managed Traefik HTTP provider to poll the updated route, probes the
public route before stopping blue, and verifies the route again after blue is
stopped. If Traefik polling is delayed beyond that window, a short blip is still
possible, but OpenLander rolls back to blue when the post-blue-stop route check
does not stay reachable.

When `strategy` is omitted, `update_app` uses blue-green automatically for
eligible services and blocks when blue-green is not currently eligible. If
`force` is used explicitly, wait for
`get_deploy_status` to reach a terminal state and call `diagnose_service` before
reporting success. Pass `strategy: "force"` explicitly only when downtime is
acceptable and the user wants the shorter replacement path.

Use a real readiness endpoint for `health_check_path`. If the app depends on a
database, cache, object storage, or external service, that endpoint should verify
those dependencies; a static 200 response can allow blue-green promotion while
part of the app is still broken.

If a blue-green update fails while the previous version is still serving, treat
that as a safe failed update. Inspect diagnostics and fix source/config before
trying another update; do not immediately force the failed candidate over the
serving version unless the user explicitly accepts downtime.

---

## Rollback

```
rollback_service(service_name: "my-app")
```

Reverts to the stored previous Docker image immediately. This does not restore
databases, volumes, environment variables, secrets, or service configuration. If
there is no previous image available, fix the source/configuration issue and run
`update_app` instead.

---

## Auto-Dockerfile

No Dockerfile in your repo? OpenLander auto-generates one for 27+ frameworks:

| Category       | Frameworks                                             |
| -------------- | ------------------------------------------------------ |
| **JavaScript** | Next.js, Express, NestJS, Vite, Nuxt, SvelteKit, Astro |
| **Python**     | FastAPI, Django, Flask, Gradio, Streamlit              |
| **Ruby**       | Rails                                                  |
| **Java**       | Spring Boot                                            |
| **PHP**        | Laravel                                                |
| **.NET**       | ASP.NET                                                |
| **Go**         | Go modules                                             |
| **Rust**       | Cargo projects                                         |

---

## Deployment Lifecycle

| Status        | Meaning                      |
| ------------- | ---------------------------- |
| `created`     | Plan created, analyzing repo |
| `needs_input` | Missing env vars or config   |
| `ready`       | Ready to execute             |
| `executing`   | Build + deploy in progress   |
| `completed`   | Successfully deployed        |
| `failed`      | Build or deploy failed       |
| `rolled_back` | Reverted to previous version |

---

## Preview Deployments

Deploy an ephemeral environment for a branch:

```
preview_deploy(
  repo_url: "https://github.com/user/my-app",
  branch: "feature/new-ui"
)
```

Clean up when done:

```
cleanup_preview(preview_id: "preview_xxx")
```

---

## Deploy Triggering

OpenLander 0.1 does not expose GitHub/GitLab/Bitbucket push webhooks. Trigger deployments
explicitly from the web UI or through MCP after pushing code.
