# Internal AI Ops And Recovery

> Internal automation is still disabled in OpenLander 0.1. The supported
> production path is deterministic recovery through MCP actions.

Built-in LLM provider setup, web-agent chat, token usage tracking, and automatic
AI remediation are disabled in OpenLander 0.1.

In the 0.2 AI Ops Briefing Beta, "AI Ops" is still not auto-remediation.
OpenLander can persist a read-only failure ticket from runtime evidence,
optionally add LLM summary text, and let an external agent inspect that ticket
through MCP. The agent or human still chooses every mutation. After a fix
attempt, `diagnose_service(briefing_id)` returns a deterministic recovery
receipt so the agent can report whether OpenLander verified the runtime state.

## Supported 0.1 Workflow

The supported workflow is MCP-first:

1. OpenLander records deployment status, build logs, runtime logs, health checks,
   and activity events.
2. An external MCP-capable agent reads `get_build_log`, `get_logs`,
   `get_deploy_status`, and `diagnose_service`.
3. `diagnose_service` returns raw evidence and, only for high-confidence
   patterns, a deterministic `diagnosis` plus a top-level `suggested_call`.
4. The external agent explicitly calls the suggested MCP action or chooses a
   different action after reading the raw evidence.
5. The agent reads the action result's verification field before deciding
   whether another step is needed.

## Current Recovery Contract

OpenLander's recovery loop is intentionally action-oriented:

- Port mismatches should prefer `apply_route_config` instead of a full redeploy.
- Runtime-only env fixes can use `set_env_vars` with immediate same-image apply
  when a previous runtime image exists.
- Build-time env fixes and missing runtime images fall back to full redeploy.
- Route changes report `route_verification`; runtime env apply reports
  `runtime_apply`.
- Verification can be `verified`, `skipped`, `failed`, or rolled back. Agents
  should not treat `skipped` as proof of recovery.

Route verification waits for the managed Traefik HTTP-provider poll window
before accepting a public 2xx. This prevents a stale route from being mistaken
for a successful cutover immediately after a target change.

## Before Internal AI Ops Returns

Internal AI Ops should not be re-enabled as a separate chat-first automation
path. It should be built on the same deterministic contracts external agents use:

- high-confidence diagnosis codes with raw evidence preserved,
- reversible or rollback-verified hot-path actions,
- explicit action result verification,
- approval gates for destructive operations,
- release-gated dogfood/live coverage for each automated recovery path.

Future releases may reintroduce internal AI Ops behind an explicit product
decision. Until then, OpenLander does not autonomously remediate production
incidents; agents and humans call MCP actions explicitly.

## 0.2 Failure Ticket And Receipt Direction

The 0.2 surface is intentionally narrower than an incident-management product:

1. Detect a runtime failure from existing monitor signals.
2. Persist a deterministic failure ticket with capped/redacted evidence.
3. Let an external agent discover that ticket through
   `list_ai_ops_briefings`, inspect it with `get_ai_ops_briefing`, and act
   through existing MCP actions.
4. Re-read runtime signals with `diagnose_service(briefing_id)` after the fix
   and return a conservative recovery receipt.

`verified` is a receipt signal, not an automatic state transition. A person
still acknowledges or resolves the ticket. If OpenLander cannot prove the
runtime is healthy, it should report `unknown` or `needs_attention` instead of
implying recovery.
