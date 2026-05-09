# AI Auto-Recovery

> Archived future-design note.

Built-in LLM provider setup, web-agent chat, token usage tracking, and automatic
AI remediation are disabled in OpenLander 0.1.

The supported 0.1 workflow is MCP-first:

1. OpenLander records deployment status, build logs, runtime logs, health checks,
   and activity events.
2. An external MCP-capable agent reads `get_build_log`, `get_logs`, and
   `get_deploy_status`.
3. The external agent decides what to change in the repo or configuration.
4. The external agent explicitly calls `deploy_service` / `rollback_service` /
   other MCP actions.

Future releases may reintroduce internal AI Ops behind an explicit product
decision. This page remains as a placeholder so old links resolve, but it is not
part of the 0.1 feature surface.
