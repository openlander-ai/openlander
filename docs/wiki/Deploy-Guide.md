# Deploy Guide

## Overview

OpenLander deploys **deployable services** through a plan-first pipeline. A **project** is the
workspace/group that holds related services; a repository, Docker image, or compose stack is attached
to a service inside that project.

```
create_deploy_plan  →  validate_deploy_plan  →  execute_deploy_plan  →  get_deploy_status
     ↓                         ↓                         ↓                       ↓
  Analyze repo           Catch bad env/URLs         Docker build + run      Poll until done
  Detect services        Check missing input        Traefik routing         completed / failed
  Check env vars         Confirm readiness
```

There's also a convenience `deploy_app` tool that combines all 3 steps.

## Mental Model

| Term               | Meaning                                                                    | Use it for                                                   |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Project group      | A workspace that groups related services.                                  | Organization, settings, service list.                        |
| Deployable service | An app, API, worker, or compose child that OpenLander builds/runs.         | Env vars, redeploys, domains, logs, diagnostics.             |
| Managed service    | Shared infrastructure such as PostgreSQL, MySQL, Redis, MongoDB, or MinIO. | Credentials, backups, databases, buckets, service lifecycle. |

After a deploy, call `list_projects` and keep `projects[].deployable_service.service_id`.
Use that `service_id` for follow-up MCP actions such as `redeploy_app`, `set_env_vars`,
`map_domain`, and `diagnose_service`.

---

## Deploy via Web Dashboard

### 1. Create a Project Group

1. Go to **Projects** → **New Project**
2. Enter a project name
3. Open the project and click **Add service**
4. Tell your agent what to deploy:
   - Git repository application/worker
   - Docker image
   - Docker Compose stack
   - Managed database/cache service
5. Review the deploy output in the service detail page

This keeps the mental model aligned with Dokploy-style IA: project = group, service = deployable
unit. The canonical deploy API is `POST /api/services/deploy`; it can create a project group plus
the initial service in one request for the common single-repository case.

### 2. Monitor Deployment

- Build log streams in real-time with ANSI colors
- Progress steps shown in timeline
- On failure: build/runtime logs remain available for manual or external-agent analysis

### 3. Access Your App

After a service deploy succeeds, the service gets a URL:

- **Internal**: `http://your-server:assigned-port`
- **Traefik**: `http://service-name.your-server`
- **Public**: optional temporary share URL or a custom domain mapping

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

This is the app deploy front door. For a new app, pass `name` as the project group name. If `name`,
`project_name`, `service_id`, or `service_name` matches an existing single-deployable app, it
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
get_deploy_status(project_name: "my-app")
```

Poll until status is `completed` or `failed`.

#### Step 5: Diagnose Failures

If deployment reports `failed`, `unhealthy`, timeout, or the app behaves unexpectedly:

```
diagnose_service(service_id: "my-app__svc")
```

Use `get_build_log(deploy_id: "...")` when you need the full build output.

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
| `docker_target`     | No       | Multi-stage build target                             |

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

---

## Redeployment

### Redeploy (Same Config)

```
redeploy_app(service_id: "my-app__svc")
```

### Redeploy with Fresh Build

```
redeploy_app(service_id: "my-app__svc", no_cache: true)
```

### Blue-Green Deploy (Zero Downtime)

```
redeploy_app(
  service_id: "my-app__svc",
  strategy: "blue-green",
  health_check_path: "/health"
)
```

Starts new container → health check passes → switches traffic → stops old container.

---

## Rollback

```
rollback_service(service_name: "my-app")
```

Reverts to the previous Docker image immediately.

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
