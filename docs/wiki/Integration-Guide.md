# Integration Guide

OpenLander runs as an MCP (Model Context Protocol) server, allowing AI coding agents to deploy and manage projects directly.

---

## Supported Clients

| Client             | Protocol              | Setup                      |
| ------------------ | --------------------- | -------------------------- |
| **OpenClaw**       | MCP over HTTP         | Config file                |
| **OpenCode**       | MCP (local or remote) | opencode.json              |
| **Claude Desktop** | MCP (stdio)           | claude_desktop_config.json |
| **Cursor**         | MCP (stdio)           | .cursor/mcp.json           |
| **Windsurf**       | MCP (stdio)           | mcp_config.json            |

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
      "url": "http://YOUR_SERVER:10114/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_OPENLANDER_TOKEN"
      }
    }
  }
}
```

Get an org-wide token from OpenLander Settings → MCP, or a project-scoped token
from a project's MCP tab.

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
      "url": "http://YOUR_SERVER:10114/mcp",
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

Get the token from:

- Web UI: Settings → MCP for org-wide access
- Web UI: Project → MCP for project-scoped access
- CLI: `openlander config` (shows masked)

Project-scoped tokens are the safer default for daily agent work. They can only act
inside the project group where they were issued. Org-wide tokens follow the active
MCP scope selector in the OpenLander UI.

### No Auth (Local)

Local stdio connections (Claude Desktop, Cursor, Windsurf) don't need tokens — they run as a child process.

---

## Available Tools

Once connected, AI agents see **5 composite MCP tools** covering **66 unique default operations** (80 routed composite actions, plus 13 optional platform tools with `config.mcp.platformTools: true`; the default is `false`). Each composite takes `{ action, params }`:

| Composite                    | Actions | Purpose                                               |
| ---------------------------- | ------- | ----------------------------------------------------- |
| `openlander_deploy`          | 16      | Deploy lifecycle: plans, execution, rollback, build   |
| `openlander_project`         | 14      | Project groups: metadata, secrets, exposure           |
| `openlander_service`         | 19      | Deployable app/worker lifecycle, config, domains      |
| `openlander_managed_service` | 21      | Databases, caches, credentials, backups, volumes      |
| `openlander_monitor`         | 10      | Monitoring & ops: logs, alerts, stats, host diagnosis |

Sample actions (accessible via `{ action: "<name>", params: {...} }`):

| Task     | Composite → action                              | Description                          |
| -------- | ----------------------------------------------- | ------------------------------------ |
| Deploy   | `openlander_deploy` → `deploy_app`              | App deploy front door                |
| Status   | `openlander_deploy` → `get_deploy_status`       | Check deployment status              |
| List     | `openlander_project` → `list_projects`          | Show all projects                    |
| Logs     | `openlander_monitor` → `get_logs`               | Container logs                       |
| Env Vars | `openlander_service` → `set_env_vars`           | Save service environment variables   |
| Rollback | `openlander_deploy` → `rollback_service`        | Revert to previous Docker image only |
| Share    | `openlander_project` → `expose_public`          | Generate temporary share URL         |
| Service  | `openlander_managed_service` → `create_service` | Create database/cache                |

MCP env changes target deployable services. Use `service_id` or `service_name`;
`project_name` works only for groups with exactly one deployable service.
Monitoring actions such as `get_logs` and `get_project_stats` follow the same
targeting rule; prefer the `deployable_service.service_id` returned by
`list_projects`.

MCP env changes are service-scoped and conservative by default: `set_env_vars`,
`delete_env_var`, and `bulk_delete_env_vars` save changes without redeploying unless
`defer_redeploy=false` is passed. To apply saved changes to a running container, call
`redeploy_app`.

Run `{ action: "help" }` on any composite for the full action list.

Full reference: [[MCP Tools Reference]]

---

## Example Conversations

### Deploy a project

> "Deploy https://github.com/user/my-app to OpenLander"

Agent will: `create_deploy_plan` → `execute_deploy_plan` → `get_deploy_status`

### Check status

> "What's the status of my-app?"

Agent will: `get_deploy_status(project_name: "my-app")`

### Fix a failure

> "my-app deployment failed, can you check?"

Agent will: `get_build_log` / `get_logs` → inspect the error itself → fix → `redeploy_app`

### Create a database

> "Create a PostgreSQL database for my-app"

Agent will: `create_service` → `create_database` → `get_service_credentials` → `set_env_vars` → `redeploy_app`

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
