# v0.2 Verified Failure Ticket Contract

This document is a release scope lock, not a feature wishlist.

OpenLander turns runtime failures into MCP-readable tickets. A coding agent can
discover the ticket, inspect evidence, apply a fix through existing MCP actions,
and then ask OpenLander for a deterministic recovery receipt. The web UI is a
human inbox, audit, and fallback surface; it is not the primary execution path.

The `[shipped]`, `[gap]`, and `[defer]` labels below are based on the rc.16
code and MCP schema contracts, not roadmap intent. If rc.16 only supports a
scoped Project/service read, that limitation is marked as a gap instead of being
papered over as a global agent path.

## Product Contract

- OpenLander does not run the agent.
- Detection, handoff, and verification call zero models.
- The only LLM call site in this flow is the optional briefing summary. It is
  default-off through Project policy, budget-capped, and falls back to the
  deterministic summary.
- `verified` is a recovery signal. `resolved` is a human state transition.
- No auto-remediation, no auto-retry loop, and no auto-resolve.

The dormant-agent invariant is enforced by the AI Ops cold-storage tests:
`RecoveryCoordinator`, `OpsAgent`, `AgentPool`, and built-in chat remain off
unless a separate product decision re-enables them with tests and docs.

## Terms

- **Failure Ticket:** a persisted AI Ops briefing row. Agents discover it with
  `openlander_monitor.list_ai_ops_briefings` for a Project or service and
  inspect it with `openlander_monitor.get_ai_ops_briefing`.
- **Recovery Receipt:** the deterministic before/after result returned by
  `openlander_monitor.diagnose_service` when called with `briefing_id`.
- **Agent Handoff:** a credential-free prompt or MCP instruction path that tells
  an external agent which ticket to read and which verification call to run.

## Shipped / Gap / Defer Matrix

- `[shipped]` MCP-readable failure tickets for scoped reads:
  `list_ai_ops_briefings({ project_id | service_id })`,
  `get_ai_ops_briefing`, status filtering, deterministic summary, suggested
  call, and capped/redacted evidence on detail reads.
- `[shipped]` Recovery receipt:
  `diagnose_service({ service_id, briefing_id })` returns
  `recovery_receipt.status` as `verified`, `needs_attention`, `unknown`, or
  `unavailable`, with route, container, restart, and deploy checks.
- `[shipped]` Web fallback:
  Home AI Ops Inbox, Project AI Ops tab, credential-free Open in Agent prompt,
  and manual acknowledge/resolve.
- `[gap]` Agent-primary global triage:
  the ideal path starts with the user asking their agent what needs attention
  across OpenLander. In rc.16, MCP ticket listing is scoped to `project_id` or
  `service_id`; a direct global `list_ai_ops_briefings(status=open)` is not
  shipped.
- `[gap]` Receipt readability:
  the receipt should make deploy/serving-version mismatch the money signal.
  Route 200 alone must not be presented as proof that the intended version is
  serving.
- `[defer]` Larger product surfaces:
  persistent receipt table, shareable receipt URL, internal agent loop,
  auto-remediation, new low-level MCP tools, AI gateway/provider product, and
  Coolify/Dokploy attach or no-migration positioning.

## Agent-Primary Scenario

1. User asks the coding agent: "Is there anything in OpenLander that needs
   attention?"
2. Today, agent first identifies the Project/service target, then calls
   `openlander_monitor.list_ai_ops_briefings({ project_id, status: "open", limit: 10 })`.
   The future gap is direct global open-ticket discovery.
3. Agent chooses a ticket and calls
   `openlander_monitor.get_ai_ops_briefing({ briefing_id })`.
4. Agent follows the ticket's `suggested_call` and may mutate only through
   existing MCP actions and approval gates.
5. After the fix attempt, agent calls
   `openlander_monitor.diagnose_service({ service_id, briefing_id })`.
6. Agent reports `recovery_receipt.status` and checks to the user. It must not
   claim the incident is fixed unless the receipt is `verified`.

Web entry points such as Open in Agent are convenience paths into the same MCP
flow. They are not required for the happy path.

## Acceptance Checks

Use the public Agent Operability Product Gate in
[`docs/evals/agent-operability.md`](../evals/agent-operability.md) as the
runtime oracle instead of inventing a separate QA definition. For the verified
failure-ticket path, the relevant checks are the same: route health, app
read/write behavior, advertised URL behavior, bad-runtime honesty, and whether
the previous good version remains serving when a candidate fails.

- List responses stay tiny: id, Project/service identity, severity,
  classification, short summary, status, and suggested call. Evidence belongs in
  `get_ai_ops_briefing`.
- Detail responses include capped/redacted evidence and freshness metadata.
- Recovery receipts are deterministic and do not call an LLM.
- `needs_attention` is returned when any receipt check fails.
- `unknown` is returned when OpenLander lacks enough signal to prove recovery.
- Manual Resolve remains separate from `recovery_receipt.status`.
- No OpenLander path runs an agent, repeats model calls, or performs automatic
  redeploy/rollback/env edit.
