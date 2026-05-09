# Deploy Guide

## Overview

OpenLander deploys deployable services through a 3-step pipeline. A **project** is the
workspace/group that holds related services; a repository, Docker image, or compose stack is attached
to a service inside that project.

```
create_deploy_plan  →  execute_deploy_plan  →  get_deploy_status
     ↓                       ↓                        ↓
  Analyze repo          Run the build            Poll until done
  Detect services       Docker build + run       completed / failed
  Check env vars        Traefik routing
```

There's also a convenience `deploy` tool that combines all 3 steps.

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
- **Public**: Quick Share via TryCloudflare (temporary URL)

---

## Deploy via MCP (AI Agents)

### Quick Deploy (One Call)

```
deploy(
  repo_url: "https://github.com/user/my-app",
  branch: "main",
  wait: true
)
```

This clones, builds, runs, and waits for completion. It creates or selects a project group, then
creates a deployable service that owns the repo/branch/build source.

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

#### Step 4: Poll Status

```
get_deploy_status(project_name: "my-app")
```

Poll until status is `completed` or `failed`.

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
deploy_service(service_name: "my-app")
```

### Redeploy with Fresh Build

```
deploy_service(service_name: "my-app", no_cache: true)
```

### Blue-Green Deploy (Zero Downtime)

```
deploy_service(
  service_name: "my-app",
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
