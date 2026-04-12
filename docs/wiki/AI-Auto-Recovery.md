# AI Auto-Recovery

OpenLander uses AI to automatically diagnose and recover from deployment failures and runtime crashes.

**Key principle**: AI handles analysis and recovery only — never makes deployment decisions autonomously. All execution is deterministic and rule-based.

---

## How It Works

```
Container crash / Build failure
    ↓
Health monitor detects event
    ↓
AI analyzes logs + error patterns
    ↓
Recipe-based fast-path OR LLM analysis
    ↓
Auto-fix (Dockerfile correction, restart, rollback)
    ↓
Redeploy + verify
```

---

## AI Features

All features are individually toggleable in Settings → AI Agent.

| Feature                    | What It Does                                             |
| -------------------------- | -------------------------------------------------------- |
| **Auto-Recovery**          | Detects container crashes, diagnoses cause, attempts fix |
| **Build Debugger**         | Analyzes build failures with recipe-based + LLM analysis |
| **Web Agent**              | Chat-based AI assistant in the dashboard                 |
| **Env Detection**          | Auto-detects required environment variables from code    |
| **Secret Scan**            | Scans for leaked secrets in code and env vars            |
| **Rollback Suggestion**    | Suggests rollback when repeated failures occur           |
| **Operational Monitoring** | Provides operational insights and recommendations        |

---

## Build Failure Recovery

When a Docker build fails:

1. **Recipe-based fast-path** — Known error patterns matched instantly (no LLM call)
2. **LLM analysis** — If no recipe matches, AI reads the build log and diagnoses the issue
3. **Dockerfile correction** — AI modifies the Dockerfile to fix the error
4. **Retry** — Rebuilds with the corrected Dockerfile

### View Analysis

#### Web Dashboard

Deployment Detail → **AI Analysis** section (appears on failure)

#### MCP

```
debug_build_error(project_name: "my-app")
```

---

## Runtime Crash Recovery

When a running container crashes:

1. **Health check** detects the crash (configurable interval, default 60s)
2. **Log analysis** — AI reads container logs to find the cause
3. **Recovery action** — One of:
   - Restart container
   - Fix and rebuild
   - Rollback to previous version
   - Alert user if unrecoverable

---

## Dual-Mode Recovery

OpenLander uses two recovery modes:

| Mode             | When                   | Speed        |
| ---------------- | ---------------------- | ------------ |
| **Programmatic** | Known error patterns   | Instant      |
| **LLM-based**    | Unknown/complex errors | 5-30 seconds |

The programmatic mode handles common issues (port conflicts, missing dependencies, permission errors) without any LLM call.

---

## Supported LLM Providers

| Provider      | Free Tier    | Recommended Model   |
| ------------- | ------------ | ------------------- |
| Google Gemini | Yes          | gemini-2.0-flash    |
| OpenRouter    | Some models  | varies              |
| Anthropic     | No           | claude-sonnet       |
| OpenAI        | No           | gpt-4o              |
| Ollama        | Free (local) | depends on hardware |

Configure in Settings → LLM.

---

## Notifications

When AI takes recovery action, get notified via:

| Channel      | Setup                                              |
| ------------ | -------------------------------------------------- |
| **Slack**    | Settings → Channels → Slack webhook URL            |
| **Discord**  | Settings → Channels → Discord webhook URL          |
| **Telegram** | Settings → Channels → Telegram bot token + chat ID |

---

## Monitoring

### Container Health

- Default interval: 60 seconds
- Inactive threshold: 14 days (auto-flagged)
- Tracks: CPU, memory, restarts, uptime

### MCP Tools for Monitoring

```
get_project_stats(project_name: "my-app")  # CPU, memory, restarts
get_system_stats()                          # Host resources
get_alerts()                                # Active alerts
get_logs(project_name: "my-app")            # Container logs
```

---

## Disabling AI

If you want purely manual deployments without AI:

In Settings → AI Agent, toggle off all features. Or in config:

```json
{
  "ai": {
    "autoRecovery": { "enabled": false },
    "buildDebugger": { "enabled": false },
    "webAgent": { "enabled": false }
  }
}
```

OpenLander will still deploy, build, and run containers — just without automatic error analysis or recovery.
