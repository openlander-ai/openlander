# v0.2 Verified Failure Ticket Contract

This document locks the v0.2 product contract. It is not a broad AI Ops PRD.

## Definition

OpenLander turns runtime failures into MCP-readable tickets. A coding agent can
read the ticket, diagnose the service, make an explicit fix through existing MCP
actions, and then ask OpenLander for a deterministic recovery receipt. The web
dashboard is the human inbox, audit, and fallback surface; it is not the primary
agent execution surface.

## Terms

- **Failure Ticket**: a persisted `ai_ops_briefings` row. Agents discover it via
  `openlander_monitor.list_ai_ops_briefings` and read details via
  `openlander_monitor.get_ai_ops_briefing`.
- **Recovery Receipt**: the `recovery_receipt` returned by
  `openlander_monitor.diagnose_service` when called with `briefing_id`.
- **Verified**: a deterministic verification signal from the receipt.
- **Resolved**: a human workflow action on the ticket. `verified` never
  automatically changes ticket status to `resolved`.

## Safety Contract

- [shipped] OpenLander does not run an internal agent loop.
- [shipped] `RecoveryCoordinator`, `OpsAgent`, and built-in chat/agent runtime
  wiring remain dormant.
- [shipped] Detect, handoff, and verify are deterministic and do not call an LLM.
- [shipped] The only LLM call site in this flow is optional briefing summary.
- [shipped] LLM failure or missing provider does not block deterministic ticket
  creation.
- [shipped] No automatic restart, redeploy, rollback, env edit, or auto-resolve.
- [shipped] User-owned external env values can enter a
  `USER_INPUT_REQUIRED` MCP mutation gate instead of letting agents guess.

## Shipped In The 0.2 RC Line

- [shipped] MCP-readable ticket list:
  `openlander_monitor.list_ai_ops_briefings`.
- [shipped] MCP-readable ticket detail:
  `openlander_monitor.get_ai_ops_briefing`.
- [shipped] Status filtering for `open`, `acknowledged`, `resolved`, and
  `unresolved` views.
- [shipped] Ticket-first list `diagnostic_call` that points agents at
  `openlander_monitor.diagnose_service`.
- [shipped] Capped, redacted evidence on detail reads with
  `evidence_metadata`.
- [shipped] `diagnose_service(briefing_id)` recovery receipt with:
  `verified`, `needs_attention`, `unknown`, or `unavailable`.
- [shipped] Receipt checks for `route_health`, `container_status`,
  `restart_stability`, and `latest_deploy`.
- [shipped] Receipt readability fields: `summary`, `report_to_user`,
  `next_action`, `can_resolve`, `primary_check`, `passed_checks`,
  `failed_checks`, `unknown_checks`, and `check_summary`.
- [shipped] Home AI Ops Inbox and Project AI Ops tab.
- [shipped] Token-free Open in Agent prompt as a convenience entry point.
- [shipped] Manual `acknowledge` / `resolve`; receipt verification is not an
  automatic state transition.

## Gaps To Validate Or Polish

- [shipped] Agent-primary acceptance: an instance/default-token agent can start
  with `list_ai_ops_briefings(status="open", limit=10)` without opening the web
  UI.
- [shipped] Agent-primary verification: after a fix, the agent calls
  `diagnose_service({ service_id, briefing_id })` and reports
  `recovery_receipt.status`, `summary`, and failed/unknown checks.
- [shipped] List response economy: list responses stay tiny triage payloads with
  no evidence, LLM telemetry, dedupe fields, or duplicate call links. Full
  evidence remains in detail reads.
- [shipped] Receipt readability: `latest_deploy` is the most visible receipt
  signal when it is failing or unknown.
- [shipped] Receipt wording: route 200 alone does not imply that a fix is
  verified.
- [gap] Release QA still needs a live agent-primary run against the rc build.

## Deferred Work

- [defer] Persisted recovery receipt table.
- [defer] Shareable receipt URL.
- [defer] Internal agent loop.
- [defer] Auto-remediation.
- [defer] New MCP tool expansion for this flow.
- [defer] AI gateway/provider product.
- [defer] Coolify/Dokploy attach/adoption positioning until that mode exists.

## Acceptance Scenarios

Agent-primary path:

1. Agent calls `list_ai_ops_briefings(status="open", limit=10)`.
2. Agent calls `get_ai_ops_briefing` for the selected ticket.
3. Agent calls the returned `diagnostic_call`.
4. Agent makes an explicit fix through an existing MCP action when safe.
5. Agent calls `diagnose_service` again with the original `briefing_id`.
6. Agent reports `recovery_receipt.status` and failed checks before telling the
   user the issue is fixed.

Provider missing:

1. Project AI Ops is enabled.
2. No LLM provider is configured.
3. Deterministic ticket still exists.
4. LLM summary is `skipped` or deterministic fallback, not a blocker.

Safety:

1. No internal agent loop starts.
2. No repeated LLM loop starts.
3. No automatic redeploy, rollback, env edit, or resolve occurs.
4. Cold-storage tests remain the enforcement reference for dormant internal
   agent components.
