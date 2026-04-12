# Deploy Guide

## Overview

OpenLander deploys projects through a 3-step pipeline:

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

### 1. Create New Project

1. Go to **Projects** → **New Project**
2. Choose source:
   - **My Repos** — Select from connected GitHub repos
   - **Search** — Search public/private repos
   - **Docker Image** — Deploy a pre-built image
3. Select branch
4. Review detected environment variables
5. Click **Deploy**

### 2. Monitor Deployment

- Build log streams in real-time with ANSI colors
- Progress steps shown in timeline
- On failure: AI analysis appears inline

### 3. Access Your App

After successful deploy, your app gets a URL:

- **Internal**: `http://your-server:assigned-port`
- **Traefik**: `http://project-name.your-server`
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

This clones, builds, runs, and waits for completion. Returns project URL on success.

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

### From Git Repository

| Parameter           | Required | Description                             |
| ------------------- | -------- | --------------------------------------- |
| `repo_url`          | Yes      | Git repository URL                      |
| `branch`            | No       | Branch to deploy (default: main)        |
| `name`              | No       | Project name (auto-generated from repo) |
| `env_vars`          | No       | JSON object of env vars                 |
| `prefer_dockerfile` | No       | Use existing Dockerfile                 |
| `dockerfile_path`   | No       | Path to Dockerfile                      |
| `docker_target`     | No       | Multi-stage build target                |

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
redeploy_project(project_name: "my-app")
```

### Redeploy with Fresh Build

```
redeploy_project(project_name: "my-app", no_cache: true)
```

### Blue-Green Deploy (Zero Downtime)

```
deploy_blue_green(
  project_name: "my-app",
  health_check_path: "/health"
)
```

Starts new container → health check passes → switches traffic → stops old container.

---

## Rollback

```
rollback_project(project_name: "my-app")
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

## Webhooks (Auto-Deploy)

Set up automatic redeployment on git push:

```
enable_webhook(
  project_name: "my-app",
  source: "github",
  branch_filter: "main"
)
```

Supports: GitHub, GitLab, Bitbucket.
