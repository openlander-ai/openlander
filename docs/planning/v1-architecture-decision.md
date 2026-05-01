# v1.0.0 Architecture Decision — Web UI & Agent Interaction Model

> **⚠ Historical — frozen 2026-04-23 (pre-1.0 launch).**
> This file records a pre-launch architecture decision; the shipped 1.0 may have evolved beyond what is described here.
> Current state: `docs/RELEASE-NOTES-1.0.md`, `docs/design/calm-ops-refresh.md`, `docs/planning/context/decision-log.md`.
> Kept in place because `docs/planning/ai-architecture-vision.md` still links here.

**Date**: 2026-03-22
**Status**: Confirmed
**Participants**: Human + Oracle + Metis + Momus + Gemini + Claude

---

## Core Principle

> **"Everything works without AI. Everything works better with AI."**

AI enhances but never gates. Every feature has a manual path.

---

## Decision

### Interaction Model (by type, not tier number)

| Type       | LLM Required?    | Interaction                                  | Examples                                                            |
| ---------- | ---------------- | -------------------------------------------- | ------------------------------------------------------------------- |
| **BUTTON** | No               | Click → instant result (~100ms)              | Stop, Start, Restart, Redeploy, Delete, Share (tunnel)              |
| **FORM**   | No (AI optional) | Wizard/form → structured input → execute     | New deploy, Domain mapping, Env vars, Rollback, Blue-green          |
| **AGENT**  | Yes              | Free-form conversation → AI reasons and acts | Diagnostics, Optimization, Monorepo orchestration, Failure recovery |

#### BUTTON — Deterministic actions

```
Stop, Start, Restart, Redeploy, Delete, Share (tunnel)

Button -> REST API -> immediate result (~100ms)
Works identically with or without LLM.

Why Redeploy is BUTTON not FORM:
  Redeploy = "same config, rebuild" — no judgment, no choices needed.
  User expects: click → build starts. Not: click → form → confirm → build.
  (Initially proposed as FORM/Tier 2. Moved to BUTTON per Oracle + Metis consensus.)
```

#### FORM — Structured configuration

```
New deploy:       Wizard (Select repo → Detect stack → Configure → Deploy)
Domain mapping:   Form (domain input → project select → apply)
Environment vars: Key-value editor with validation
Rollback:         Version selector + confirm dialog (or Split-Decision Modal)
Blue-green:       Config form + confirm

With LLM:    AI pre-fills forms, adds suggestions via Split-Decision Modal
Without LLM: Manual input, standard confirmation. Fully functional.
```

#### AGENT — Ambiguous, complex, multi-step judgment

```
Diagnostics:   "Why did this crash? Fix it."
Optimization:  "This is slow, make it faster."
Monorepo:      Complex multi-service orchestration with dependency resolution
Recovery:      AI-assisted failure analysis + auto-fix (Dockerfile patching, env inference)

Only accessible via Agent Chat.
These genuinely require AI reasoning — no deterministic form can replace them.
```

---

### Escalation Path (failure → agent)

When a BUTTON or FORM action fails:

1. Show failure inline (toast/error banner with details)
2. Display **"Diagnose with Agent"** button next to the error
3. On click: opens Agent Chat side panel with **auto-injected context**:
   - Error code and message
   - Deploy ID and project name
   - Last 10 log lines
   - Failed step identifier
4. User does NOT need to explain from scratch — agent starts with full context

```
Example:

  ┌─ DEPLOY FAILED ─────────────────────────────────────────────────────┐
  │ ❌ Build failed: Exit code 137 (OOM killed)                        │
  │                                                                     │
  │ Deploy #43 · 2m 34s · Branch: main · Commit: ad4c23b               │
  │                                                                     │
  │ [ View Logs ]   [ Retry ]   [ ✨ Diagnose with Agent ]              │
  └─────────────────────────────────────────────────────────────────────┘

  Clicking "Diagnose with Agent" opens Agent Chat with:
  "Deploy #43 for project hotdeal-api failed with OOM (Exit 137).
   Last logs: [auto-attached]. Analyze and suggest a fix."
```

---

### Split-Decision Modal (FORM + AI suggestion)

For actions where AI can add decision value (Rollback, Blue-green):

```
Without LLM:                    With LLM:
┌────────────────────────┐      ┌────────────────────────┬──────────────────────┐
│ Rollback to #43        │      │ YOUR ACTION            │ AI INSIGHT           │
│                        │      │                        │                      │
│ Previous deploy: #43   │      │ Rollback to #43        │ 💡 Deploy #43 had   │
│ Created: 2h ago        │      │                        │ OOM errors after     │
│                        │      │ Previous deploy: #43   │ 15 min runtime.      │
│ [ Cancel ] [ Proceed ] │      │ Created: 2h ago        │                      │
└────────────────────────┘      │                        │ Recommend #42        │
                                │ [ Proceed ]            │ (last stable, 3d)    │
                                │ (outline button)       │                      │
                                │                        │ [ Rollback to #42 ]  │
                                │                        │ (solid, primary)     │
                                └────────────────────────┴──────────────────────┘
```

- LLM not connected: right panel doesn't render. Natural fallback to standard confirm.
- LLM connected but slow: left panel renders immediately, right panel shows skeleton then fills.
- User can always click left-side "Proceed" without waiting for AI.

---

### LLM Modes

```
LLM not connected ("Manual Piloting Mode"):
  ✅ All BUTTON actions work (Stop, Start, Restart, Redeploy, Delete, Share)
  ✅ All FORM actions work (New deploy wizard, Domain form, Env editor, Rollback, Blue-green)
  ✅ Full monitoring (status, logs, metrics, deploy history, timeline)
  ❌ Agent Chat disabled
  ❌ Split-Decision Modal AI panel hidden
  ❌ "Diagnose with Agent" buttons hidden
  ❌ AGENT-type tasks unavailable (diagnostics, optimization, recovery)
  = Coolify/Vercel equivalent. Fully functional PaaS.

LLM connected ("Autopilot Mode"):
  ✅ Everything above
  ✅ Agent Chat activated (problem solving, optimization, power user shortcut)
  ✅ Split-Decision Modal shows AI suggestions
  ✅ "Diagnose with Agent" escalation buttons visible
  ✅ AGENT-type tasks available
  ✅ AI auto-recovery on build failures (existing buildDebugger)
  = Full PaaS + AI operations assistant
```

---

### Web Dashboard = Control Tower

```
Cockpit (Vercel, Coolify):    Human directly operates everything
Control Tower (OpenLander):   Human monitors + intervenes when needed, AI handles routine ops

Control Tower behavior:
  Normal:    Watch dashboards. Green lights. AI auto-deploys, auto-recovers.
  Anomaly:   Red light → immediate manual intervention via BUTTON. No AI delay.
  Complex:   Agent Chat for diagnosis. "Why did this fail? Fix it."
```

---

## Agent Chat Role

Agent Chat is NOT a button replacement. NOT a form replacement. It serves:

1. **Problem solver**: "Why did this crash? Fix it." — ambiguous, multi-step reasoning
2. **Optimization**: "Make this faster / use less memory" — analysis + judgment
3. **Escalation target**: BUTTON/FORM failure → "Diagnose with Agent" → auto-context injection
4. **Power user shortcut**: Experienced users can do anything via chat (deploy, share, configure), but it's a choice, not a requirement. Forms/buttons always exist as alternatives.

### Agent Chat as Side Panel

- Currently: Agent Chat is a separate page (`/agent`)
- v1.0.0: Agent Chat is a **side panel** openable from any page
- Triggered by: "Diagnose with Agent" buttons, sidebar chat icon, or keyboard shortcut
- Can be open alongside project detail, deployment logs, etc.

---

## Feature × Interaction Matrix (comprehensive)

| Feature                  | BUTTON                    | FORM                  | AGENT           | LLM needed?              |
| ------------------------ | ------------------------- | --------------------- | --------------- | ------------------------ |
| Stop project             | ✅ Primary                | -                     | Can do via chat | No                       |
| Start project            | ✅ Primary                | -                     | Can do via chat | No                       |
| Restart project          | ✅ Primary                | -                     | Can do via chat | No                       |
| Redeploy (same config)   | ✅ Primary                | -                     | Can do via chat | No                       |
| Delete project           | ✅ Primary (with confirm) | -                     | Can do via chat | No                       |
| Share (tunnel)           | ✅ Primary                | -                     | Can do via chat | No                       |
| New deploy               | -                         | ✅ Primary (wizard)   | Can do via chat | No                       |
| Domain mapping           | -                         | ✅ Primary (form)     | Can do via chat | No                       |
| Environment vars         | -                         | ✅ Primary (editor)   | Can do via chat | No                       |
| Rollback                 | -                         | ✅ Primary (selector) | Can do via chat | No                       |
| Blue-green               | -                         | ✅ Primary (config)   | Can do via chat | No                       |
| Failure diagnosis        | -                         | -                     | ✅ Primary      | Yes                      |
| Performance optimization | -                         | -                     | ✅ Primary      | Yes                      |
| Monorepo orchestration   | -                         | ✅ Partial (form)     | ✅ Primary      | No (basic) / Yes (smart) |
| "Why did X happen?"      | -                         | -                     | ✅ Only         | Yes                      |

**Key**: "Can do via chat" = power user shortcut, not primary path.

---

## Implementation Surfaces (file references)

### Current BUTTON handlers (already direct REST, keep as-is)

| Action         | Frontend handler                    | Backend endpoint                                       | Status            |
| -------------- | ----------------------------------- | ------------------------------------------------------ | ----------------- |
| Stop           | `ProjectDetail.tsx:handleStop`      | `POST /projects/:id/stop` → `pipeline.stop()`          | ✅ Already direct |
| Start          | `ProjectDetail.tsx:handleStart`     | `POST /projects/:id/start` → `pipeline.start()`        | ✅ Already direct |
| Redeploy       | `ProjectDetail.tsx:handleRedeploy`  | `POST /projects/:id/redeploy` → `pipeline.redeploy()`  | ✅ Already direct |
| Delete         | `ProjectDetail.tsx:handleDelete`    | `DELETE /projects/:id` → `pipeline.remove()`           | ✅ Already direct |
| Share          | `ShareDialog.tsx:handleShare`       | `POST /projects/:id/share` → `pipeline.exposeTunnel()` | ✅ Already direct |
| Rollback       | `ProjectDetail.tsx:handleRollback`  | `POST /projects/:id/rollback` → `pipeline.rollback()`  | ✅ Already direct |
| Blue-green     | `ProjectDetail.tsx:handleBlueGreen` | `POST /projects/:id/blue-green` → `blueGreen.deploy()` | ✅ Already direct |
| Quick redeploy | `ProjectsGrid.tsx:handleRedeploy`   | Same as Redeploy                                       | ✅ Already direct |

### FORM pages (exist or need creation)

| Feature           | Current state                                    | v1.0.0 need                                            |
| ----------------- | ------------------------------------------------ | ------------------------------------------------------ |
| New deploy wizard | `NewProjectFlow.tsx` exists                      | ✅ Already exists. Add AI pre-fill when LLM available. |
| Domain mapping    | `DomainsPanel.tsx` exists                        | ✅ Already exists as settings form.                    |
| Environment vars  | Env editor exists in Settings                    | ✅ Already exists.                                     |
| Rollback          | Currently just a button with no version selector | 🔧 Need version selector form + Split-Decision Modal   |
| Blue-green        | Currently just a button                          | 🔧 Need config form                                    |

### AGENT surfaces (exist or need creation)

| Feature                | Current state                      | v1.0.0 need                                                 |
| ---------------------- | ---------------------------------- | ----------------------------------------------------------- |
| Agent Chat page        | `AgentPage.tsx` exists at `/agent` | 🔧 Convert to side panel, openable from anywhere            |
| Escalation button      | Does not exist                     | 🔧 Add "Diagnose with Agent" to error states                |
| Auto-context injection | Does not exist                     | 🔧 Build structured message injection into chat             |
| AI form pre-fill       | Does not exist                     | 🔧 LLM call to suggest form values (optional, non-blocking) |

### Backend changes needed

| Change                             | File                           | Description                                                   |
| ---------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| ~~trigger default 'chat' → 'api'~~ | `deploy-core.ts`, `compose.ts` | ✅ Done in this session                                       |
| ~~env scan unification~~           | `deploy-failure-handler.ts`    | ✅ Done in this session (env-parser.ts based)                 |
| ~~optional env filter~~            | `deploy-failure-handler.ts`    | ✅ Done in this session                                       |
| ~~chat session SQL fix~~           | `chat.repo.ts`                 | ✅ Done in this session                                       |
| Missing MCP tools                  | `src/tools/defs/`              | 🔧 Need: `start_project`, `redeploy_project`, `share_project` |
| MCP tool audit                     | All 112 tools                  | 🔧 Full correctness/completeness review                       |

---

## Decision History (chronological)

### Round 1: Initial proposal — "All buttons → agent"

- **Proposed**: Every action button delegates to AI agent. LLM not connected = monitoring only.
- **Rejected by**: Oracle (unanimously), Metis (strongly), Momus (rejected as non-executable plan)
- **Key reasons**: Stop button problem, single agent bottleneck, latency regression, hallucination risk, README principle violation, competitive regression

### Round 2: 3-Tier hybrid

- **Proposed**: Tier 1 (direct), Tier 2 (AI-enhanced), Tier 3 (AI-driven/chat-only)
- **Feedback**: Redeploy should be Tier 1 not Tier 2 (Oracle, Metis, Claude consensus). Accepted.
- **Critical warning**: Tier 3 "chat-only" for new deploys breaks the slogan. New deploy is user's FIRST action — can't require chat.

### Round 3: Final — Interaction type model

- **Proposed**: BUTTON / FORM / AGENT. All features have manual path. AI enhances, never gates.
- **Key changes from Round 2**:
  - Dropped numbered tiers. Interaction type is more intuitive.
  - "Chat-only" eliminated. New deploy gets a wizard. Domain mapping gets a form.
  - Added Split-Decision Modal pattern for FORM + AI hybrid.
  - Added escalation path with auto-context injection.
  - Redeploy confirmed as BUTTON (deterministic, no judgment needed).
- **Status**: Confirmed by all participants.

### Bugs fixed during this discussion session

| Bug                                                 | Root cause                                                                         | Fix                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------- |
| Manual deploy shown as "Agent Deploy"               | `config.trigger ?? 'chat'` default in 5 places                                     | Changed to `'api'`                                 |
| Env scan divergence (web ≠ MCP)                     | Two scanners: `env-scan.ts` (regex) vs `env-parser.ts` (file-based)                | Web endpoint now uses `env-parser.ts`              |
| Optional env vars trigger dialog                    | `newVars` filter didn't exclude optional vars                                      | Added `&& !v.optional` filter                      |
| Chat session titles all "New conversation"          | Drizzle SQL correlated subquery self-comparing (`ch2."session_id" = "session_id"`) | Raw SQL with explicit table reference              |
| Chat sessions not syncing between Sidebar/AgentPage | `useChatSessions()` hook called independently (two useState instances)             | Migrated to React Context (`ChatSessionsProvider`) |

---

## v1.0.0 Scope Summary

```
Already done (this session):
  ✅ Agent Chat UI polish (bubbles, code blocks, thinking indicator)
  ✅ Deployments list compact redesign
  ✅ Chat session Context migration
  ✅ trigger default fix
  ✅ env scan unification
  ✅ chat session SQL fix

Still needed:
  🔧 MCP tool audit (112 tools × 5 audit criteria)
  🔧 Missing MCP tools (start_project, redeploy_project, share_project)
  🔧 Rollback version selector form + Split-Decision Modal
  🔧 Blue-green config form
  🔧 Agent Chat → side panel conversion
  🔧 "Diagnose with Agent" escalation buttons
  🔧 Auto-context injection for escalation
  🔧 AI form pre-fill for New Deploy wizard (optional enhancement)
  🔧 Quality hardening + testing
```

---

## References

- **Oracle review**: Global concurrency lock analysis, 5-second fallback pattern, three-tier → interaction-type recommendation, "button → agent is not industry standard"
- **Metis analysis**: 560 checkpoint audit scope, missing tools inventory, README principle contradiction, "chat-only Tier 3 breaks slogan"
- **Momus review**: Plan needs concrete tasks with file references and QA scenarios
- **External review (Gemini)**: "Control Tower" metaphor, "LLM not connected = manual piloting mode", Split-Decision Modal pattern
- **Claude synthesis**: Redeploy is BUTTON not FORM, MCP tool quality is the real v1.0.0 differentiator

---

## Design Principles (for future reference)

1. **Buttons are buttons.** Click → thing happens. No chat panel, no AI narration.
2. **Forms are forms.** Input → validate → execute. AI can suggest, never block.
3. **Agent is for the ambiguous.** "Why?" and "How?" — not "Stop" and "Start."
4. **Manual first, AI second.** Every feature works manually. AI makes it better.
5. **Escalation, not replacement.** Simple fails → offer agent. Don't force agent from the start.
6. **Emergency brake always works.** LLM down? Buttons still work. Always.
7. **MCP tools are agent UX.** Web UI is human UX. Both are first-class citizens.
