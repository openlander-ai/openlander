# GUIDE-01 — IA Principles

> **Audience**: Claude Design (input brief) + team reviewing structural decisions.
> **Purpose**: Define **what lives where** in the OpenLander UI — the noun hierarchy, the sidebar composition, and the rules that keep the product feeling systematic as features get added.
> **Grounding**: Empirical comparison with Dokploy v0.29.1 (see `DOKPLOY_HANDSON_UX_ANALYSIS.md` §1 + §2). The "systematic vs 번잡" gap identified by the user traces back to IA, not visuals.
> **Status**: draft — freeze after `ccg` review + Claude Design's first-pass layout trial.

---

## 1. The Three Mechanisms (non-negotiable)

These three are the **structural foundation**. Any IA proposal that violates any of them is rejected without further review.

### M1 — Persistent Shell

The left sidebar is **identical on every page**. No contextual sidebars, no drawer-over-drawer, no layout reflow during navigation. The sidebar is the user's stable anchor ("I am here") across the entire session.

**Implications**:

- Sidebar composition is chosen **once** and doesn't change per route.
- If we'd be tempted to add a contextual sidebar for a specific flow (e.g., a wizard), use a **modal dialog** instead.
- The sidebar reserves a slot for per-page breadcrumbs in the top bar, not in itself.

### M2 — Single Outer-Card Frame

Every route's content body lives inside **one outer card** with consistent margins, border, and inner padding. Inside the card, sub-content can use stacked sub-cards. But the outer frame is a constant.

**Implications**:

- Full-bleed layouts are banned except for two specific surfaces: (a) the log streaming viewer in "focus mode" and (b) monitoring dashboards that need horizontal chart space.
- Nested card-in-card-in-card patterns are also banned (no more than 2 levels of cards deep).

### M3 — Nouns-First IA

The sidebar and top-level routes are labeled with **nouns** (what the user manages): Projects, Deployments, Monitoring, Logs. Verbs (Deploy, Rollback, Connect) live **inside** the noun page as buttons/actions, not as sidebar entries.

**Implications**:

- "Deployments" is a valid top-level noun when viewed as "a record of past deploys across all projects". It is NOT a valid entry if it represents "deploy this thing" — that's a verb and belongs inside a project page.
- Ambiguity test: if you can't answer "is this a thing or an action?", it's probably in the wrong place.

---

## 2. The Three Supporting Mechanisms (added via Gemini/Codex review)

These were surfaced during CCG review of the initial 3-mechanism thesis. They're nervous-system-level — less structural than M1–M3 but equally important for the "systematic" feel.

### M4 — Predictable Feedback Loops

Every action (Save / Deploy / Delete) triggers the **same** affordance shape: button → inline loading state → toast on success/fail → surface change (navigation or content replacement). Users learn the shape once and apply it everywhere. **Do not invent new feedback patterns per feature**.

### M5 — Information Density

The card frame (M2) + the sidebar (M1) create a lot of negative space. If we fill that space with low-density content (big illustrations, empty placeholder text), users feel the product is unfinished. Pack information tightly within the frame, but **inside** the semantic groupings. Dokploy's home dashboard (4 metric cards + recent deployments in one outer card) is a good density target.

### M6 — State Persistence

The sidebar being "persistent" (M1) is a lie if the **scroll position, active tab, filter selection, and sort order** all reset on every navigation. These are the user's current working state; they must survive navigation within a session.

**Specific rules**:

- Scroll position within a scrollable sub-area restores on back-navigation.
- Active tab within a tabbed surface (e.g., a project's Deployments tab) persists in URL (so it survives page refresh).
- Filter/sort state on list pages (projects list) survives entering detail + returning.

---

## 3. Top-Level Sidebar Composition (v1.0)

Two sections, sized to fit without scroll on a 768px-tall sidebar. Total = 12 entries max.

### Section A: Workspace (Work Items)

| Entry       | Icon | Purpose                                                 |
| ----------- | ---- | ------------------------------------------------------- |
| Home        | ⌂    | Global dashboard — metrics + recent activity            |
| Projects    | 📁   | The product's primary noun                              |
| Deployments | 🚀   | Cross-project deploy history (audit view)               |
| Monitoring  | 📊   | Server + per-project resource metrics                   |
| Logs        | 📜   | Unified log stream across projects (v1.1; stub in v1.0) |

### Section B: Settings

| Entry         | Icon | Purpose                              |
| ------------- | ---- | ------------------------------------ |
| Web Server    | 📡   | Traefik / reverse proxy config       |
| Profile       | 👤   | Current user's account               |
| Users         | 👥   | Multi-user (if enabled)              |
| SSH Keys      | 🔑   | Repo access keys                     |
| Git Providers | </>  | GitHub App / PAT / SSH configuration |
| Notifications | 🔔   | Webhook / email / Slack              |
| Audit Logs    | 📋   | System-level event history           |

### Sidebar anchors (pinned at bottom, below the two sections)

- **Account card**: avatar + email + dropdown (switch org, sign out)
- **Version stamp**: small, muted, `v1.0.0`

### NOT in the sidebar for v1.0

The following Dokploy entries are **intentionally omitted**:

- **Swarm** — OpenLander doesn't use Swarm (CCG decision).
- **Docker** (raw container list) — too low-level, leaks infrastructure to users.
- **Traefik File System** — raw config browser; wrong mental model for OpenLander.
- **Requests** — Traefik request log; folded into Monitoring.
- **Schedules** — no backend model; v1.1+ only.
- **Remote Servers** — multi-server is a post-1.0 roadmap item.
- **AI / Agent** (separate tab) — OpenLander's agent is external (MCP clients); no in-product chat UI for 1.0. See `DOKPLOY_HANDSON_UX_ANALYSIS.md` §7.D1 for alternative ("agent activity as timeline").

### Agent presence — top-bar, not sidebar

Per Gemini review (and to honor the agent-native positioning without a chat box), an **Agent Command Center** indicator lives in the **top-bar right edge** (not the sidebar). Basic v1.0 state: connected / disconnected + last-agent-activity timestamp (`Last agent action: 5m ago`). Details and component spec in **GUIDE-02 §3**. Backend requirement: GUIDE-00 AG-3.

This way a user always sees "the agent is there" without a dedicated tab, and MCP trigger labels on deploy rows (GUIDE-03 §5) give the durable record of agent actions.

---

## 4. Per-Noun Inner Structure (Project / Service)

The two nouns that have depth are **Project** and **Service** (where Service = an Application / Compose / Database under a project).

### 4.1 Project page (when clicked in sidebar → Projects → specific project)

Tabs inside the project:

| Tab         | Purpose                                        |
| ----------- | ---------------------------------------------- |
| Overview    | Services in this project + aggregate status    |
| Deployments | Deploy history for services in this project    |
| Environment | Project-level env vars (inherited by services) |
| Settings    | Project metadata, tags, archive control        |

### 4.2 Service page (clicked from Project → specific service)

Tabs inside the service:

| Tab         | Purpose                                                                                 |
| ----------- | --------------------------------------------------------------------------------------- |
| General     | Source config (Git / Image / Compose), build config, trigger (Deploy button lives here) |
| Environment | Service-level env vars                                                                  |
| Domains     | Public URL + Traefik routing                                                            |
| Deployments | Per-service deploy history                                                              |
| Logs        | Live log streaming (see GUIDE-04)                                                       |
| Monitoring  | Per-service resource metrics                                                            |
| Advanced    | Runtime config (restart policy, resource limits, escape hatches)                        |

### 4.3 What's deliberately NOT a tab

- `Containers` (for compose): surface the containers as an inner list on General or Overview, not a tab. Compose being internally-multi-container is an implementation detail, not a primary user concept.
- `Patches`: if implemented, an agent-assisted feature inside Advanced — not a top-level tab.
- `Backups` / `Volume Backups`: single "Data" tab if/when implemented; not two.

---

## 5. Information Hierarchy Rules

When presenting data inside the outer card:

1. **Icon + Title + Subtitle triplet** at the top of every card (and every sub-card). Title is the noun; subtitle is a brief description or count.
2. **Primary action right-aligned** in the title row (e.g., `+ Create Project`, `Save`, `Deploy`).
3. **Secondary actions** either (a) grouped as `...` overflow on list items, or (b) as a secondary button row below the primary.
4. **List controls** (filter input + sort dropdown + tag filter) on their own row, between the title and the list body.
5. **Empty states** centered vertically within the list area: icon + one-line copy + primary CTA.

---

## 6. Navigation Patterns

### 6.1 Breadcrumbs

Top bar of every content area, left of center. Format: `{Org} > {Section} > {Current page}`. Clickable except the last.

### 6.2 Back behavior

Browser back restores scroll + tab state (M6). If a modal is open, browser back closes the modal first, THEN navigates. Never dead-ends.

### 6.3 Modal dialogs (for creation / destructive actions)

- Used for: creating resources (Project, Service), confirming destructive actions (Delete, Archive).
- NOT used for: editing (editing goes inline in the current page).
- Dismissable via ESC or backdrop click **only for non-destructive**. Destructive confirm dialogs (Delete project) require explicit Cancel click.

### 6.4 Deep-linking

Every major page state has a URL. Deploy history tab on project X → `/projects/{slug}/deployments`. No ephemeral state that can't be shared via copy-paste URL.

---

## 7. What to skip in v1.0 (roadmap parking)

These are IA-adjacent ideas to defer explicitly (so they don't drift into v1.0 scope):

- **Organization switcher** (multi-tenant selector at top of sidebar): reserve the slot but don't implement until multi-org is a real need.
- **Global command bar** (Cmd+K): considered and rejected for 1.0 — doesn't match PaaS async timescales (see `DOKPLOY_HANDSON_UX_ANALYSIS.md` §7 discussion).
- **Unified search**: no cross-entity search in v1.0. Each list has its own filter.
- **Theme customization**: single light/dark mode. No brand color picker, no custom themes.

---

## 8. Handoff to Claude Design

### What this guide gives you

- The sidebar composition (Section A + B + anchor), with exact entries
- The inner tab structure for Project and Service
- The 6 structural mechanisms (M1–M6) as constraints
- A list of what NOT to build for v1.0

### What Claude Design decides (not this guide)

- Exact icon choices (Lucide recommended for consistency with existing OpenLander stack)
- Sidebar width (Dokploy uses 256px expanded, 48px collapsed; validate)
- Breakpoint behavior for mobile (drawer vs bottom nav)
- Visual weight of each sidebar entry (active state treatment)
- Exact spacing/typography within the card frame

### Validation loop

- Claude Design produces an IA mockup (desktop at 1440×900 + mobile at 390×844)
- Claude + CCG review check the mockup against M1–M6 as a rubric
- Round-trip with specific findings; freeze after 1–2 iterations

---

## 9. Acceptance (checklist for the finished IA)

- [ ] Sidebar is the same on every route (visible, in the same position, no entries change)
- [ ] Every content route uses the outer card frame
- [ ] No sidebar entry is a verb
- [ ] Navigating from a project's Deployments tab away and back restores the tab
- [ ] A list page's filter + sort survive return navigation
- [ ] Every creation flow (Project, Service) is a modal, not a new page
- [ ] The sidebar composition fits on a 768px tall viewport without scroll
- [ ] Browser back from a modal closes the modal first
- [ ] No `Swarm`, `Docker` (raw), `Traefik File System`, `Requests`, `Schedules`, `Remote Servers`, or `AI` sidebar entries
- [ ] Bottom of sidebar has the Account card + version stamp
