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

```json
{
  "mcpServers": {
    "openlander": {
      "type": "http",
      "url": "http://YOUR_SERVER:10114/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_OPENLANDER_TOKEN"
      }
    }
  }
}
```

Get your token from OpenLander Settings → MCP.

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
    "openlander": {
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
    "openlander": {
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
    "openlander": {
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
    "openlander": {
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
    "openlander": {
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

- Web UI: Settings → Security
- CLI: `openlander config` (shows masked)

### No Auth (Local)

Local stdio connections (Claude Desktop, Cursor, Windsurf) don't need tokens — they run as a child process.

---

## Available Tools

Once connected, AI agents get 82 tools. Key ones:

| Task     | Tool                | Description                  |
| -------- | ------------------- | ---------------------------- |
| Deploy   | `deploy`            | One-call deploy from Git URL |
| Status   | `get_deploy_status` | Check deployment status      |
| List     | `list_projects`     | Show all projects            |
| Logs     | `get_logs`          | Container logs               |
| Env Vars | `set_env_vars`      | Set environment variables    |
| Rollback | `rollback_project`  | Revert to previous version   |
| Share    | `share_project`     | Generate public URL          |
| Service  | `create_service`    | Create database/cache        |

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

Agent will: `get_build_log` → `debug_build_error` → fix → `redeploy_project`

### Create a database

> "Create a PostgreSQL database for my-app"

Agent will: `create_service` → `create_database` → `get_service_credentials` → `set_env_vars`

---

## Notification Channels

For remote monitoring, connect notification channels:

| Channel      | What You Need       |
| ------------ | ------------------- |
| **Slack**    | Webhook URL         |
| **Discord**  | Webhook URL         |
| **Telegram** | Bot token + Chat ID |

Configure in Settings → Channels (web UI) or in `config.json` under `channels`.
