# OpenLander 1.0 UI Redesign — Design Guides

> **Purpose**: input brief for Claude Design (producing HTML/handoff) and implementer (producing React components).
> **Authoring**: Claude Code session, 2026-04-24, based on hands-on Dokploy comparison + CCG (Codex+Gemini) review loops.
> **Target**: OpenLander 1.0 launch — 2026-05-01.

---

## How to read these

Read in order 01 → 02 → 03 → 04 → 05 for the first pass. Each builds on the previous.

| #      | Guide                                                      | What it answers                                                                                                                 | Lines |
| ------ | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----- |
| **00** | **[Capability Matrix](./GUIDE-00-capability-matrix.md)** ★ | Feature × backend-status × 1.0/1.1/skip decision for every capability the other guides reference. Backend work-list lives here. | 217   |
| 01     | [IA Principles](./GUIDE-01-IA-principles.md)               | What lives where, what's in the sidebar, what's NOT in v1.0                                                                     | 227   |
| 02     | [Page Skeleton](./GUIDE-02-page-skeleton.md)               | The repeating shape of every page (sidebar + top bar + outer card)                                                              | 329   |
| 03     | [Deploy User Journey](./GUIDE-03-deploy-user-journey.md)   | End-to-end flow from empty state to running app                                                                                 | 332   |
| 04     | [Log Streaming Spec](./GUIDE-04-log-streaming.md) ★        | Deploy log viewer — state machine, decisions, visual examples                                                                   | 310   |
| 05     | [Error Taxonomy](./GUIDE-05-error-taxonomy.md) ★           | 10 error classes + 4 UI surfaces + routing matrix                                                                               | 282   |

**Read order — design phase (now)**: **01 → 02 → 03 → 04 → 05** for product surface. **Skip GUIDE-00** for now; it's a backend roadmap that gets relevant when implementation starts. Design exploration shouldn't be blocked by backend feasibility decisions.

**Read order — implementation phase (later)**: revisit **00 first** to align scope with what's ready, then 01-05 to spec components.

### What Claude Design uses

- 5 product-surface guides (01–05)
- `../dokploy/DOKPLOY_HANDSON_UX_ANALYSIS.md` (676 lines) — visual reference for what competing PaaS UI looks like, with COPY/ADAPT/SKIP categorization

### What Claude Design ignores

- GUIDE-00 capability matrix (backend-specific; not visual)
- Backend mismatch warnings inside guides (will resolve at implementation)
- Acceptance checklists (those are for the implementation/QA pass, not design)

**★ Starred guides are the "AI can't guess these" parts** — spent extra care on state machines, decision logs, and visual examples. The other 3 are lighter scaffolding that Claude Design can flesh out with typical design judgment.

---

## Source material

Every decision in these guides is anchored in real data, not speculation:

- **Dokploy hands-on**: `../dokploy/DOKPLOY_HANDSON_UX_ANALYSIS.md` — live capture of Dokploy v0.29.1, 15 screenshots of flow, 4 deploy logs including 6 real failure modes.
- **Dokploy source-based (4/21)**: `../dokploy/DOKPLOY_*.md` (7 files) — design system primitives, typography, colors.
- **CCG reviews** (Codex + Gemini): `../../.omc/artifacts/ask/codex-openlander-ui-*.md`, `../../.omc/artifacts/ask/gemini-openlander-ui-*.md`
- **Live OpenLander production data**: MCP `list_projects` + `active_incidents` response — used for real runtime error shapes.

---

## Scope decisions (what's NOT in v1.0)

Explicitly deferred to v1.1+, intentionally absent from these guides:

- Agent-as-UI (chat box, Cmd+K command palette, agent sidebar entry)
- Schedules (no backend model yet)
- Preview deploys per branch (v1.1 feature)
- Pro-tier replicas / HA / multi-server
- Wizards / templates / gallery on project creation
- Inline compose editor
- Global search

See each guide's "what's not in v1.0" section for the specific rationale.

---

## Handoff workflow (proposed)

1. Claude Design reads these 5 guides + the Dokploy analysis doc
2. Produces:
   - Mockup set (see GUIDE-02 §12 and GUIDE-03 §7 for deliverable asks)
   - Component spec sheet
   - Clickable prototype if time permits
3. I (Claude Code) + CCG review the output against each guide's Acceptance checklist
4. 1–2 iterations to freeze
5. Implementation phase begins with design + guides as the contract

---

## Re-freshing these docs

If upstream context changes (Dokploy ships a v0.30 with a new pattern, or OpenLander backend adds a new feature), the hands-on analysis doc is the primary source to update first, then the relevant guide(s) inherit the change. Don't modify a guide without also updating the anchor data it cites.
