# Integration Guide

OpenLander runs as an MCP (Model Context Protocol) server, allowing AI coding agents to deploy and manage projects directly.

---

## Supported Clients

| Client             | Protocol              | Setup                      |
| ------------------ | --------------------- | -------------------------- |
| **Claude Code**    | MCP over HTTP         | `claude mcp add`           |
| **OpenClaw**       | MCP over HTTP         | Config file                |
| **OpenCode**       | MCP (local or remote) | opencode.json              |
| **Claude Desktop** | MCP (stdio)           | claude_desktop_config.json |
| **Cursor**         | MCP (stdio)           | .cursor/mcp.json           |
| **Windsurf**       | MCP (stdio)           | mcp_config.json            |

---

## Claude Code

The primary OpenLander client. Add the server with the Claude Code CLI:

```bash
claude mcp add --transport http \
  --header "Authorization: Bearer YOUR_OPENLANDER_TOKEN" \
  openlander https://YOUR_DASHBOARD_ORIGIN/mcp
```

Copy the exact command — token and endpoint already filled in — from the **Your Agent**
page (`/mcp-server`) in the dashboard, or from the MCP step of the setup wizard. The
endpoint is your dashboard origin + `/mcp` (e.g. `https://deploy.example.com/mcp`);
`:10114` appears only when you reach OpenLander directly without a reverse proxy.

The OpenLander token shown here is an MCP token. Use it with the `/mcp` endpoint only,
not as a REST `/api` bearer token. If the agent cannot see `openlander_*` tools, stop
and fix MCP registration instead of falling back to raw HTTP API calls.
If this token is accidentally sent to `/api`, OpenLander returns
`MCP_TOKEN_USED_ON_REST_API` with the correct `/mcp` endpoint and a registration example.

### Test

> "Call `openlander_project({ action: \"help\" })`, then list all projects on OpenLander."

---

## OpenClaw

Add to OpenClaw config (`~/.openclaw/openclaw.json` or via `openclaw config edit`):

Use a specific server key such as `openlander-ais-prod` when you connect more than one
OpenLander instance to the same AI client. The Your Agent page generates this key from
the instance name.

```json
{
  "mcpServers": {
    "openlander-ais-prod": {
      "type": "http",
      "url": "https://YOUR_DASHBOARD_ORIGIN/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_OPENLANDER_TOKEN"
      }
    }
  }
}
```

Get the token from the **Your Agent** page (`/mcp-server`) in the dashboard, or from the
setup wizard's MCP step. It mints an instance-wide token, shown once. The `url` is your dashboard
origin + `/mcp` (`:10114` only when reaching OpenLander without a reverse proxy).

After registration, verify that the client lists the `openlander_*` tools and that
`openlander_project({ action: "help" })` returns the Project action catalog. If not,
the MCP server is not connected; do not substitute direct `/api` requests.

### Test

```bash
openclaw agent --message "List all projects on OpenLander"
```

### Full Workflow with OpenClaw

OpenClaw can handle the complete cycle:

1. Write code
2. Deploy via MCP
3. Test with browser tool
4. Fix issues and redeploy

```bash
openclaw agent --thinking high --message \
  "Create a Todo app, deploy it to OpenLander,
   open it in the browser and test that
   adding/deleting todos works. Fix any issues."
```

---

## OpenCode

### Local (same machine)

```jsonc
// opencode.json or ~/.config/opencode/config.json
{
  "mcp": {
    "openlander-ais-prod": {
      "type": "local",
      "command": ["openlander", "mcp"],
      "enabled": true,
    },
  },
}
```

### Remote (via network)

```jsonc
{
  "mcp": {
    "openlander-ais-prod": {
      "type": "remote",
      "url": "https://YOUR_DASHBOARD_ORIGIN/mcp",
      "enabled": true,
    },
  },
}
```

Verify: `opencode mcp list`

---

## Claude Desktop

```jsonc
// macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
// Windows: %APPDATA%\Claude\claude_desktop_config.json
{
  "mcpServers": {
    "openlander-local": {
      "command": "openlander",
      "args": ["mcp"],
    },
  },
}
```

---

## Cursor

```jsonc
// .cursor/mcp.json (project root)
{
  "mcpServers": {
    "openlander-local": {
      "command": "openlander",
      "args": ["mcp"],
    },
  },
}
```

---

## Windsurf

```jsonc
// ~/.codeium/windsurf/mcp_config.json
{
  "mcpServers": {
    "openlander-local": {
      "command": "openlander",
      "args": ["mcp"],
    },
  },
}
```

---

## Authentication

### Bearer Token

For remote MCP connections, include the auth token in headers:

```
Authorization: Bearer YOUR_TOKEN
```

Get the token from the **Your Agent** page (`/mcp-server`) in the dashboard, or from the
MCP step of the setup wizard. Both mint an instance-wide token, **shown only once**. The current API
value for this instance-wide scope is `scope_kind: "org"` for compatibility; this is not an
organization feature. If you didn't copy it (or need a fresh one), use **Regenerate** on the Your
Agent page — there is no "reveal again". Regenerating **revokes the previous token**, so update your
agent's config with the new value. (Programmatic: `POST /api/mcp/token/regenerate` reliably returns
the plaintext; `POST /api/mcp/token` may omit it once a token already exists.) Project- and
service-scoped tokens exist via the API (`POST /api/tokens` with `scope_kind: "project"` +
`scope_project_id`, or `scope_kind: "service"` + `scope_service_id`) but are not surfaced in the
0.1 onboarding UI. Scoped MCP tokens return `SCOPE_VIOLATION` for cross-project, sibling-service, or
targetless host-level operations, and missing scoped targets are normalized to the same error to
avoid target enumeration. `list_projects` is filtered to the token's visible Project or service.
`mcp_action_status` remains pollable for held actions in the scoped service's Project so
least-privilege handoff flows can track their own approval/status lifecycle.

The endpoint is your dashboard origin + `/mcp` (e.g. `https://deploy.example.com/mcp`).
`:10114` appears only when reaching OpenLander directly without a reverse proxy.

### No Auth (Local)

Local stdio connections (Claude Desktop, Cursor, Windsurf) don't need tokens — they run as a child process.

### Isolated local instances

OpenLander stores its configuration, generated instance identity, and local data under
`~/.openlander` by default. Set `OPENLANDER_DATA_DIR` when a development, test, or secondary
instance must use an independent data root on the same host:

```bash
OPENLANDER_DATA_DIR=/path/to/openlander-candidate openlander start --no-open --port 10115
```

Give each instance its own Postgres database and port as well. The data-directory override keeps
instance identity and configuration separate; it does not make it safe for two instances to share
the same database.

---

## Available Tools

Once connected, AI agents see **5 composite MCP tools** covering **138 unique default operations**, plus 13 optional platform tools with `config.mcp.platformTools: true` (the default is `false`). Each composite takes `{ action, params }`:

| Composite                    | Actions | Purpose                                                                            |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------- |
| `openlander_deploy`          | 28      | Deploy lifecycle: plans, execution, rollback, build                                |
| `openlander_project`         | 48      | Projects, Agent Delivery, Engagement bootstrap/portfolio, secrets, exposure        |
| `openlander_service`         | 26      | Application lifecycle, config, domains                                             |
| `openlander_managed_service` | 24      | Databases, caches, credentials, backups, data inspection, volumes                  |
| `openlander_monitor`         | 15      | Monitoring & ops: logs, AI Ops briefings, topology, alerts, host/network diagnosis |

Sample actions (accessible via `{ action: "<name>", params: {...} }`):

| Task           | Composite → action                                                                                                                  | Description                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Deploy         | `openlander_deploy` → `deploy_app`                                                                                                  | App deploy front door                                                        |
| Status         | `openlander_deploy` → `get_deploy_status`                                                                                           | Check deployment status                                                      |
| List           | `openlander_project` → `list_projects`                                                                                              | Show all projects                                                            |
| Logs           | `openlander_monitor` → `get_logs`                                                                                                   | Container logs                                                               |
| Env Vars       | `openlander_service` → `set_env_vars`                                                                                               | Save Application environment variables                                       |
| Update         | `openlander_service` → `update_app`                                                                                                 | Ship latest stored source/config                                             |
| Rollback       | `openlander_deploy` → `rollback_service`                                                                                            | Revert to previous Docker image only                                         |
| Publish        | `openlander_service` → `expose_public`                                                                                              | Create a protected HTTPS URL and access code                                 |
| Resource       | `openlander_managed_service` → `create_service`                                                                                     | Create Database/Cache resource                                               |
| Inspect        | `openlander_managed_service` → `list_data_sources`                                                                                  | Discover Project data sources                                                |
| Delivery       | `openlander_project` → `create_delivery`                                                                                            | Start an FDE delivery evidence record                                        |
| Portfolio      | `openlander_project` → `list_engagements`                                                                                           | Read internal cross-Project FDE status                                       |
| Bootstrap      | `openlander_project` → `bootstrap_engagement`                                                                                       | Create an Engagement and initial Project atomically                          |
| Register       | `openlander_project` → `register_project_repository`                                                                                | Attach a Git source without deploying                                        |
| Feedback       | `openlander_project` → `record_delivery_feedback`                                                                                   | Preserve pasted customer feedback                                            |
| Receipt        | `openlander_project` → `get_delivery_readiness`                                                                                     | Check deterministic finalization gates                                       |
| Plan run       | `openlander_project` → `plan_delivery`                                                                                              | Store objective, DoD, manifest, and Gates                                    |
| Handoff        | `openlander_project` → `record_delivery_run_progress`                                                                               | Record progress or pause with a handoff                                      |
| Quality        | `openlander_project` → `run_quality_gates`                                                                                          | Run manifest checks in disposable containers                                 |
| Evidence       | `openlander_project` → `create_evidence_upload`                                                                                     | Issue a short-lived upload URL for one artifact                              |
| Review package | `openlander_project` → `prepare_delivery_review_package` / `get_delivery_review_package_status` / `publish_delivery_review_package` | Stage, resume, and atomically publish customer review files                  |
| Review         | `openlander_project` → `request_delivery_review` / `get_delivery_review_status`                                                     | Bind and poll an exact Artifact revision                                     |
| Update         | `openlander_project` → `record_project_update`, `get_project_context`, `get_project_update`                                         | Record and read source-linked Project context before or during Delivery work |

For Agent-originated evidence, call `create_evidence_upload` first and `PUT`
the exact bytes to the returned bearer URL. The upload request does not use the
MCP token as REST authentication. Use the multipart REST endpoint only from a
supported web session or CI client with its own API/PAT authentication.

`bootstrap_engagement`, `update_engagement_from_brief`, `archive_engagement`,
`unarchive_engagement`, `list_engagements`, and `get_engagement` require an
instance/organization MCP token. `link_project_to_engagement` and
`unlink_project_from_engagement` also accept a Project token only when
`project_id` is that token's own Project; sibling Project and service tokens get
`SCOPE_VIOLATION`. Every Engagement mutation requires `idempotency_key`; retrying
the same payload returns the original operation result.

Application Operations are also available to authenticated automation at
`POST /api/v1/operations/:name`. Send the operation input as the JSON body and
commands' stable key in the `Idempotency-Key` header. Both REST and MCP call the
same in-process operation handler; neither adapter calls the other.
`accept_delivery_review` is the deliberate exception: it is callable only from
an authenticated Web session and returns `OPERATION_REQUIRES_HUMAN_UI` to raw
REST API tokens. It is not registered as an MCP action.

MCP env changes target Applications. Use `service_id` or `service_name`;
`project_name` works only for Projects with exactly one Application.
Monitoring actions such as `get_logs` and `get_project_stats` follow the same
targeting rule; prefer the Application `service_id` returned by `list_projects`
(`deployable_service.service_id` in v0.1.x compatibility output).

MCP env changes are service-scoped and conservative by default: `set_env_vars`,
`delete_env_var`, and `bulk_delete_env_vars` save changes without redeploying unless
`defer_redeploy=false` is passed. To apply saved changes to a running container, call
`update_app`.

Run `{ action: "help" }` on any composite for the full action list.

Full reference: [[MCP Tools Reference]]

---

## Example Conversations

### Deploy a project

> "Deploy https://github.com/user/my-app to OpenLander"

Agent will: `create_deploy_plan` → `execute_deploy_plan` → `get_deploy_status`

### Check status

> "What's the status of my-app?"

Agent will: `get_deploy_status(service_id: "<Application service_id>")` when available,
or the returned `status_call` from the deploy response.

### Fix a failure

> "my-app deployment failed, can you check?"

Agent will: `get_build_log` / `get_logs` → inspect the error itself → fix → `update_app`

### Create a database

> "Create a PostgreSQL database for my-app"

Agent will: `create_service(project_id | project_name, template)` → `get_service_credentials` → `set_env_vars` → `update_app`

(`create_service` requires a `project_id` or `project_name` target — get it from
`list_projects` — and the database template provisions the database itself; there is no
separate `create_database` MCP action.)

---

## Notification Channels

Remote notifications are not part of the 0.1 UI surface. Use deployment logs,
activity feed entries, and MCP polling for operational feedback.

| Channel      | Status                  |
| ------------ | ----------------------- |
| **Email**    | Supported in 0.1 (SMTP) |
| **Slack**    | Planned for future 0.x  |
| **Discord**  | Planned for future 0.x  |
| **Telegram** | Planned for future 0.x  |
