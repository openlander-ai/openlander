# Dokploy Hands-On UX Analysis (v0.29.1)

> **Captured**: 2026-04-24 on Lima VM, authenticated admin session via Playwright
> **Method**: 16 full-page screenshots of live instance, not source-code inference
> **Complements**: prior 4/21 docs (source-code based)

---

## 0. Why This Doc

The earlier 4/21 documents (INDEX / COMPARISON / DESIGN_SUMMARY / UI_ANALYSIS / VISUAL_PATTERNS) were written by reading Dokploy's GitHub source at commit `6fb4a13` (v0.28.8). They capture **design system primitives** (colors, spacing, components) but miss the **end-to-end UX flow feel**. This file documents what you see when you actually click through.

Version captured: **v0.29.1**. Differences vs source-analysis baseline are noted inline.

Screenshot inventory: [`.omc/analysis/dokploy-screenshots/`](../../../.omc/analysis/dokploy-screenshots/)

---

## 1. What Makes Dokploy Feel "Systematic"

The end-user sensation (per hands-on comparison) is **"systematic, not scattered"**. Three concrete mechanisms produce this:

### 1.1 Persistent Shell (sidebar never changes)

The left sidebar is **identical on every page**. Two sections (`Home` / `Settings`) with ~18 total entries. Users never lose their place; the active item is always highlighted. No contextual sidebars, no drawers-on-drawers, no layout reflow when navigating.

### 1.2 Single Outer-Card Content Frame

Every page content (excluding modals) is wrapped in **one outer card** with a subtle border + rounded corners. Inside that card: icon + title + description at top, content body, optional footer action. **Every page has the same skeleton**. The result: cognitive mapping is free — users don't re-parse layout per screen.

### 1.3 Nouns-First, Verbs-In-Context

Navigation labels are all **nouns** (Projects, Deployments, Monitoring, Docker, Swarm, Git). Actions (`Create Project`, `Add AI`, `Enable 2FA`) live **inside** the noun-page, contextually. User thinks "where is X?" not "what can I do?".

OpenLander today mixes these axes — some top-level items are nouns (Projects) and some are verbs/views (Deployments as top-level when conceptually it's "a project's deployments"). This is one of the biggest contributors to the "scattered" feeling.

---

## 2. IA Extracted From Sidebar

```
My Organization ▼           [🔔]
───── Home ─────
 ⌂ Home                (= global dashboard)
 📁 Projects            (primary IA entry)
 🚀 Deployments         (cross-project history)
 📊 Monitoring          (server-level CPU/MEM/Disk)
 🕐 Schedules
 🧾 Traefik File System
 📦 Docker              (all containers on host)
 🔗 Swarm               (Swarm overview + manage)
 → Requests             (Traefik request log)

───── Settings ─────
 📡 Web Server
 👤 Profile
 🖥  Remote Servers
 👥 Users
 📋 Audit Logs
 🔑 SSH Keys
 🤖 AI
 🏷  Tags
 </> Git Providers
─────────────────
 [DL]  Account
       lehdqlsl@naver.com
       Version v0.29.1
```

**Observations**:

- Org switcher at top (multi-tenant aware) — OpenLander likely doesn't need yet, but reserve space
- 2 sections, 9 + 9 items. Reasonably flat, no nesting
- Account + version pinned at bottom (stable anchor)
- No search in sidebar — everything reachable in ≤1 click

---

## 3. Screen-by-Screen Findings

### 3.1 `/dashboard/home` — Global Dashboard

**Screenshot**: [02-after-login.png](../../../.omc/analysis/dokploy-screenshots/02-after-login.png)

Structure: `Welcome back, {firstName}` + `Go to projects →` button → 4 metric cards (Projects / Services / Deploys7D / Status) → Recent deployments list.

Metric-card pattern worth copying:

```
PROJECTS           ← uppercase tiny label
1                  ← big number
1 environment      ← small descriptor
```

Status card uses **color-coded dot + count + word**: `● 0 running / ● 1 errored / ● 0 idle`. Clean, scannable.

Recent deployments row shows: status dot · name · subtitle · provider badge · status word · relative time · `logs →` link. Dense but readable because of consistent horizontal alignment.

### 3.2 `/dashboard/projects` — Projects List

**Screenshot**: [03-projects-list.png](../../../.omc/analysis/dokploy-screenshots/03-projects-list.png)

Card grid (3 columns at 1440px), each card = name + ... menu + created-at + `N service(s)` pill. Filter input + `Tags` button + `Newest first` sort on top. `+ Create Project` black button top-right.

Empty-state is implicit: if zero cards, you'd see the filter row with nothing below it. (Not captured — user has 1 project.)

### 3.3 Create Project Dialog

**Screenshot**: [04-create-project-dialog.png](../../../.omc/analysis/dokploy-screenshots/04-create-project-dialog.png)

Modal: `Add a project` / `The home of something big!` (friendly subtitle). Three fields: Name (placeholder `Vandelay Industries` — a joke), Description, Tags. `Create` button bottom-right of modal. Escape closes.

**Copy this exactly**: dialog UX is tighter than a full-page form for simple resources.

### 3.4 `/dashboard/settings/profile` — Settings Detail Page

**Screenshot**: [09-settings-profile.png](../../../.omc/analysis/dokploy-screenshots/09-settings-profile.png)

Multi-section settings: `Account` card (profile fields + avatar picker with cartoon presets), below it another `API/CLI Keys` card (cropped). Each card has icon + title + description + `Enable 2FA`/`Save` action top-right or bottom-right.

**Pattern**: **vertically stacked sub-cards within the outer frame**. Each card is a logical unit (Account / API Keys / Preferences). This is a stronger pattern than tabbed settings.

### 3.5 `/dashboard/settings/git-providers` — Git Providers

**Screenshot**: [11-settings-git-providers.png](../../../.omc/analysis/dokploy-screenshots/11-settings-git-providers.png)

Empty state: centered `</>` icon, `Create your first Git Provider` heading, then **4 colored brand buttons** (Github / GitLab / Bitbucket / Gitea) horizontally.

**Design insight**: the branded buttons feel more like "pick your adventure" than a generic form. Colors match each provider's brand (GitLab purple, Bitbucket blue, Gitea green). Useful pattern for OpenLander's multi-trigger deployment page.

### 3.6 `/dashboard/monitoring` — Server Metrics

**Screenshot**: [17-monitoring.png](../../../.omc/analysis/dokploy-screenshots/17-monitoring.png)

2×2 grid of metric cards: CPU Usage / Memory Usage / Disk Space / Docker Disk Usage. Each card has:

- Header: metric name + current value (Used: 6.92 GB / Limit: 28.02 GB)
- Mini progress bar (black fill, gray track)
- Full chart below (line chart for time series, donut chart for categorical split)
- Teal (CPU), orange (memory), black+gradient (disk), multi-color donut (docker disk split by images/containers/volumes)

Charts are **Recharts**-based, minimal axis labels, no legend unless multi-series. Font size on axis is small but readable.

### 3.7 `/dashboard/swarm` — Swarm Overview

**Screenshot**: [19-swarm.png](../../../.omc/analysis/dokploy-screenshots/19-swarm.png)

Tabs at top: `Overview` / `Containers`. Outer card title `Docker Swarm Overview` + `Manage Cluster` button top-right.

3 metric cards across (Total Nodes / Active Nodes / Manager Nodes), then `Node Status` sub-card showing node name with Leader badge, TLS Status chip (green), Availability chip (blue), then 4 inline facts (Engine Version / CPU / Memory / IP Address), then 2 action buttons (Config / Services).

**Skip this page for OpenLander** — Swarm-specific, and per earlier CCG review we're not going Swarm. But note the **chip/badge design** (green = "Ready", blue = "Active") is worth copying for general status chips.

### 3.8 `/dashboard/settings/ai` — AI Settings + Log Analysis integration

**Screenshots**: [13-settings-ai.png](../../../.omc/analysis/dokploy-screenshots/13-settings-ai.png) (empty state), [step23-ai-form.png](../../../.omc/analysis/dokploy-hotdeal/step23-ai-form.png) (Add AI form), [step23-log-modal-with-ai.png](../../../.omc/analysis/dokploy-hotdeal/step23-log-modal-with-ai.png) (AI button on deploy log), [step23-ai-analysis-clicked.png](../../../.omc/analysis/dokploy-hotdeal/step23-ai-analysis-clicked.png) (log analysis panel).

Empty state (first visit): robot icon + `You don't have any AI configurations` + `+ Add AI` button. But this is only the **configuration surface**. The actual AI touch-points appear elsewhere once configured.

#### Add AI form (6 fields + 2 action buttons)

- **Provider** — preset dropdown (OpenAI / Anthropic / Ollama / Custom) that quick-fills Name + API URL
- **Name** — free text identifier (e.g., `gpt-4o-config`)
- **API URL** — base URL (e.g., `https://api.openai.com/v1`)
- **API Key** — password input with visibility toggle
- **Model** — free text, autocomplete-style (e.g., `gpt-4o`, `claude-3-5-sonnet`, `llama3.1`)
- **Enable AI Features** — on/off toggle
- Footer: `Test Connection` (dry-run) + `Create` (save)

Multi-config supported — a user can register several AI providers and select per-usage.

#### Where AI actually shows up (once configured)

**Deploy log modal header** now renders an `AI` toggle button (alongside Copy). Clicking reveals an analysis panel:

```
┌ Log Analysis ─────────────┐
│ Select a provider… ▼      │   ← which configured AI to use
│ [ Analyze 318 lines ]     │   ← explicit action; line count shown upfront
└───────────────────────────┘
```

Three UX observations worth calling out:

1. **Explicit action, never automatic** — users opt in per analysis. Prevents surprise costs + privacy leaks.
2. **Line count shown upfront** — "Analyze 318 lines" primes the user on context budget. Honest design.
3. **Provider selection at use-time** — mix-and-match per analysis ("cheap model for quick diag, expensive model for hard failure").

#### The bigger picture — what Dokploy's AI actually is

Dokploy's AI is a **narrow plug-in for two jobs**: (a) generate docker-compose templates from natural language, (b) explain a deploy log after failure. That's it. It does NOT:

- Execute actions (no restart, no redeploy, no env var change)
- Retain memory across analyses
- See the broader environment (other services, metrics, recent deploys)

It is a **log-to-text translator with an LLM inside**, bolted onto an otherwise traditional UI.

#### Competitive insight for OpenLander

| Axis         | Dokploy AI                 | OpenLander MCP agent (existing in prod)                      |
| ------------ | -------------------------- | ------------------------------------------------------------ |
| Role         | Log analyzer plug-in       | Operator (full env context)                                  |
| Trigger      | UI button per log          | Editor conversation (Claude Code / Cursor)                   |
| Can execute? | No — read-only explanation | Yes (via MCP tool calls: redeploy, env set, service create…) |
| Memory       | Per-click                  | Per-session + OpenLander backend state                       |
| Provider     | BYOK (user pays)           | Hosted by user's editor subscription                         |
| Scope        | One log at a time          | Whole PaaS                                                   |

**Design implication for v1.0** — three honest choices, not obvious which is right:

- **Ignore** Dokploy's pattern: bet entirely on MCP clients. Users without Claude Code / Cursor have no in-product AI at all.
- **Mirror, narrowly**: add "Copy as AI prompt" button on log modal → user pastes into their own tool. No backend AI integration.
- **Mirror, fully**: OpenLander ships BYOK AI config + log analyze button. Backend work non-trivial (new settings area + provider calls).

Decision deferred — user's call. The observation itself belongs in the analysis doc, not as a prescribed guide.

### 3.9 `/dashboard/docker` — Docker Containers (host-level container console)

**Screenshots**: [18-docker.png](../../../.omc/analysis/dokploy-screenshots/18-docker.png) (empty), [step24-docker-list.png](../../../.omc/analysis/dokploy-hotdeal/step24-docker-list.png) (5 running), [step25-docker-row-menu.png](../../../.omc/analysis/dokploy-hotdeal/step25-docker-row-menu.png) (⋯ menu).

Table view with filter-by-name, Columns dropdown (column visibility toggle), columns: Name / State / Status / Image. Each row has a `⋯` trigger revealing a **7-action menu**:

| Action               | Behavior                                       |
| -------------------- | ---------------------------------------------- |
| View Logs            | opens log modal (same component as deploy log) |
| View Config          | `docker inspect`-style read-only JSON view     |
| View Mounts          | volume mounts listing                          |
| View Networks        | attached networks list                         |
| Terminal             | opens `docker exec -it` in a web terminal      |
| Upload File          | file upload into container                     |
| **Remove Container** | destructive (red); confirm dialog              |

**Effectively a lightweight Portainer inside Dokploy.** This surface is what power-users reach for when something's broken and the per-service UI doesn't expose enough detail.

#### OpenLander implication

Don't copy this as a top-level sidebar entry — it leaks host-level detail and breaks the "operator works for you" framing. But the **⋯ menu actions are valuable**, and they already have natural homes in the per-service view (Logs → service Logs tab, Terminal → Open Terminal button on General tab, Config → Advanced tab "Runtime" sub-card). A consolidated "host containers" view may make sense as an **Admin-only** secondary route in v1.1 for debugging.

### 3.10 `/dashboard/schedules` — Scheduled tasks (cron-as-a-service)

**Screenshots**: [step25-schedule-create-dialog.png](../../../.omc/analysis/dokploy-hotdeal/step25-schedule-create-dialog.png).

"Create Schedule" dialog:

- **Task Name** (text, e.g. "Daily Database Backup")
- **Schedule**: predefined dropdown ("Every hour" / "Daily" / ...) OR custom cron expression (`0 0 * * *`)
- **Timezone** (UTC default)
- **Script**: CodeMirror code editor, with line numbers. Placeholder shows:
  ```
  # This is a comment
  echo "Hello, world!"
  ```

The Script field accepts **arbitrary shell**. Dokploy runs these on the host (or in a dedicated scheduler container). Execution history is stored per schedule.

#### Use cases (worth the feature value)

- DB backup (`pg_dump | gzip > /backups/...`) on nightly cron
- Old image/log cleanup
- Periodic HTTP-POST to an external metrics endpoint
- Custom crawler triggers (hotdeal-tracker would use this if their worker wasn't already handling it)

#### Risk surface

Arbitrary shell script execution ≈ RCE by design. Acceptable if the user owns the host; unacceptable for multi-tenant deployments. Dokploy's scope (self-hosted single-owner) makes this OK.

#### OpenLander implication — three framings

- **Defer to v1.1+** as a Pro-tier feature (honest; Codex already flagged OpenLander has no backend model)
- **Narrow version**: `Scheduled Backups` tied specifically to DB services (backup preset runs on cron). Lower risk, narrower surface, ~3 days instead of ~1 week.
- **Agent-first alternative**: no UI for schedules; instead the MCP agent manages crontab on the host. User says "Claude, back up hotdeal's DB nightly at 2am" → agent registers the job via an OpenLander MCP tool. **Consistent with agent-as-operator positioning.**

Recommendation: agent-first for v1.0 (no UI), evaluate Narrow version for v1.1 if users ask for non-backup scheduled tasks.

### 3.11 `/dashboard/settings/server` — Web Server (server admin console)

**Screenshot**: [survey-B-webserver.png](../../../.omc/analysis/dokploy-hotdeal/survey-B-webserver.png).

A single outer card with **3 stacked sub-cards** — textbook M2 "stacked sub-cards" pattern:

1. **Server Domain** sub-card — configures the server's own admin domain (for Dokploy UI itself):
   - Domain input (placeholder `dokploy.com`)
   - Let's Encrypt Email input
   - `HTTPS` toggle ("Automatically provision SSL Certificate")
   - `Save` button scoped to this sub-card
2. **Web Server** sub-card — server-level actions:
   - `Server` / `Traefik` / `Space` / `Check for updates` — 4 action buttons
   - Server IP + Version displayed below
   - `Daily Docker Cleanup` toggle (automated image prune)
3. **Backups** sub-card (partially visible) — "Add backups to your database to save the data to a different provider."

**For OpenLander**: most of this is server-admin concerns that OpenLander may or may not surface; keep it behind a `/settings/server` route and follow the same stacked-sub-cards layout for multi-section pages. The key UX lesson is that when one page has several unrelated concerns (domain + admin actions + backup), **don't tab them** — stack sub-cards. Users see everything at once, Ctrl-F works, no hidden tabs.

### 3.12 `/dashboard/deployments` — Cross-project deployment history + Queue

**Screenshot**: [survey-A-deployments.png](../../../.omc/analysis/dokploy-hotdeal/survey-A-deployments.png).

Two tabs at top of content: **`Deployments`** (history) + **`Queue`** (in-flight / waiting).

Filter row:

- Search input ("Search by name, project, environment, serve…")
- `All statuses ▼` filter
- `All types ▼` filter

Table columns: **Service** / **Project** / **Environment** / **Server** / **Title** / **Status** / **Created**. Each row has a status pill (`done` green / `error` red) and the commit message as Title.

This is the "audit view" — read for "what happened across all my projects". Particularly useful for team environments. OpenLander's current home dashboard covers recent deployments but not a filterable history view. **Worth copying in v1.0** (already on the sidebar in GUIDE-01 so aligned).

**Queue tab** (unexplored content in empty state) is for concurrent deploy coordination. OpenLander 1.0 deferred queue to keep flow simple (GUIDE-03 §4.3); Dokploy's presence here confirms the UX pattern exists and is standard. Re-visit if users ask for it.

### 3.13 `/dashboard/requests` — Traefik request log (opt-in)

**Screenshot**: [survey-A-requests.png](../../../.omc/analysis/dokploy-hotdeal/survey-A-requests.png).

Page is **opt-in activated**. Default empty state:

- `Log Cleanup Schedule` input (cron, e.g., `0 0 * * *`) + `Update Schedule` / `Activate` buttons
- Text: `Requests are not activated`
- Explanation: `Activate requests to see incoming traffic statistics and monitor your application's usage. After activation, you'll need to reload Traefik for the changes to take effect.`

**UX pattern worth copying** — surfaces required prerequisite + activation step up-front, doesn't pretend to show empty data. Opt-in gating with explicit activation cost is better than silently collecting.

**For OpenLander**: consider exposing Traefik request log as a privacy-conscious opt-in feature only, matching Dokploy's approach. More importantly, the **"activate before data"** pattern is a good primitive for other expensive telemetry features.

### 3.14 `/dashboard/settings/users` — Users + Invitations

**Screenshot**: [survey-B-users.png](../../../.omc/analysis/dokploy-hotdeal/survey-B-users.png).

Two stacked sub-cards:

1. **Users** table — columns: Email / Role / 2FA / Created At / Actions. Current owner row labeled `(You)` with black `owner` badge, 2FA status (`Disabled`), timestamp.
2. **Invitations** sub-card — empty state + `+ Add Invitation` button.

Standard multi-user admin. OpenLander 1.0 is single-user; reserve this pattern for v1.1+ multi-user work. Pattern worth noting: **current user's row flagged with `(You)`** so audit is easy.

### 3.15 `/dashboard/settings/audit-logs` — PAYWALL (Enterprise)

**Screenshot**: [survey-B-audit-logs.png](../../../.omc/analysis/dokploy-hotdeal/survey-B-audit-logs.png).

Lock icon + `Audit Logs` title + copy: `Get full visibility into every action performed across your organization. Audit logs are available as part of Dokploy Enterprise.` + `Manage License` button.

**Notable product insight**: Dokploy has an **Enterprise paywall tier**. This is one of the gated features. For OpenLander: audit logs could be an open-source primitive (since the tech is trivial) or a premium feature. Decision depends on monetization strategy, not UX.

### 3.16 `/dashboard/settings/notifications` — Notifications providers

**Screenshot**: [survey-B-notifications.png](../../../.omc/analysis/dokploy-hotdeal/survey-B-notifications.png).

Empty state with bell icon. Copy: `Add your providers to receive notifications, like **Discord, Slack, Telegram, Teams, Email, Resend, Lark**.` + `+ Add Notification` button.

**7 notification providers supported**. Comprehensive. For OpenLander this is a backlog item — start with Discord / Slack / Email for v1.x and expand from there based on demand.

### 3.17 `/dashboard/settings/tags` — Project organization

**Screenshot**: [survey-B-tags.png](../../../.omc/analysis/dokploy-hotdeal/survey-B-tags.png).

Simple empty state: `No tags yet. Create your first tag to start organizing projects.` + `+ Create Tag` button. Mirrors the Create Project dialog's tag-select field.

Tags are a good OpenLander candidate for v1.1 — cheap to implement, useful at >5 projects.

### 3.18 `/dashboard/settings/remote-servers` — 400 error (requires setup or paywall)

**Screenshot**: [survey-B-remote-servers.png](../../../.omc/analysis/dokploy-hotdeal/survey-B-remote-servers.png).

Returns `400 Oops, something went wrong.` on my single-user local install. Likely either:

- Requires Enterprise license (like Audit Logs), or
- Requires a second server registered first (feature not available on single-host local).

Either way, confirms the feature exists but isn't accessible in local/community tier. **For OpenLander**: multi-server is explicitly out of scope for v1.0 (GUIDE-01 §7).

### 3.19 Service-level tab inventory — what each of the 12 tabs shows (empty vs live)

Compose service exposes 12 tabs (see §11.2). Empty-state / live-state of each:

| Tab                | Empty state                                                                                             | Live state                                                             | Key observations                                                                             |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **General**        | Source picker shows unconfigured tabs (GitHub/GitLab/Bitbucket/Gitea/Git/Raw); placeholder fields       | Source config filled, Deploy button active                             | One of the densest forms in the product; candidate for Wizard per GUIDE-03 review            |
| **Environment**    | CodeMirror editor with `NODE_ENV=production` placeholder dots                                           | Live env values shown, mask by default                                 | Single textarea, not key-value rows. Pro: bulk-paste. Con: no validation UI                  |
| **Domains**        | Globe icon + "To access the application it is required to set at least 1 domain" + `Add Domain`         | List of configured domains with HTTPS toggles                          | Requires explicit setup — no auto-domain. Compare with OpenLander's sslip.io auto-generation |
| **Deployments**    | Empty list with webhook URL shown                                                                       | N rows of past deploys (done/error) + `Clear/Kill/Cancel` actions      | `Webhook URL` always shown at top — cleverly teaches the feature                             |
| **Containers**     | "No containers found. Deploy the compose to see containers here."                                       | Table with per-container status + ⋯ menu (same as `/dashboard/docker`) | Exposes compose-internal containers for individual control                                   |
| **Backups**        | DB icon + "To create a backup it is required to set at least 1 provider. Please, go to S3 Destinations" | Scheduled backup list                                                  | Gated on S3 Destinations setup elsewhere — link-out pattern                                  |
| **Schedules**      | Clock icon + "No scheduled tasks" + `Add Schedule`                                                      | List of scheduled shell tasks                                          | Same model as global Schedules page but scoped to this service                               |
| **Volume Backups** | Cylinder icon + "No volume backups" + `Add Volume Backup` / `Restore Volume Backup`                     | Schedule list                                                          | Separate from DB backups — volume-level, not logical                                         |
| **Logs**           | (only meaningful while live)                                                                            | Live NDJSON stream modal                                               | Covered in §3.9 Dockerized container logs                                                    |
| **Patches**        | File-plus icon + "No patches yet" + `Create Patch`                                                      | Patch list with apply order                                            | See §3.10 for feature explanation                                                            |
| **Monitoring**     | Empty charts                                                                                            | **Per-container dropdown** + CPU/Memory/Disk charts + `Restart` button | Each compose-internal container monitored separately — good UX for multi-container services  |
| **Advanced**       | Default Run Command + empty Volumes + empty Resource Limits                                             | Custom command saved + volumes/limits configured                       | Escape hatch sub-cards stacked — matches the stacked-sub-cards pattern                       |

**Pattern observations across tabs**:

- Every empty state follows the same skeleton: **icon + one-line copy + primary CTA**
- "Link-out to prerequisite" (Backups → S3 Destinations) is a **dependency chain teaching tool** — worth copying when a feature requires multi-step setup
- Run Command (Advanced) shows the default command above the input so users know what they're overriding — **good transparency**

### 3.20 "+ Create Service" dropdown — 5 service types

**Screenshot**: [survey-create-service-dropdown.png](../../../.omc/analysis/dokploy-hotdeal/survey-create-service-dropdown.png).

Clicking `Create Service` on a project page opens a dropdown with 5 options:

1. **Application** — Git repo → Dockerfile/Nixpacks build
2. **Database** — Postgres/Redis/MySQL/MongoDB preset
3. **Compose** — docker-compose.yml multi-container stack
4. **Template** — (unexplored) likely 1-click app gallery (Wordpress, Ghost, etc.)
5. **AI Assistant** — (unexplored) presumably creates an AI-backed service using the configured AI

The `AI Assistant` entry as a **service type** is separate from the AI Settings (§3.8 which is global provider config). Suggests Dokploy is experimenting with "AI as a deployable service" — possibly spawns an Ollama container or wraps an OpenAI-compatible endpoint. Worth investigating if our AI direction competes with this.

**For OpenLander 1.0**: the Application / Database / Compose / Docker Image typology matches our IA (GUIDE-01 §4.2). `Template` deferred to v1.1+ as a gallery of curated stacks (Wordpress, n8n, Umami, etc.). `AI Assistant` as-a-service-type is not our direction (OpenLander's AI is the agent operating the whole PaaS, not a service you deploy).

---

## 4. COPY List (직접 채택)

These are patterns to lift straight into `ui-redesign-1.0` with no significant modification:

| #   | Pattern                                                                  | Source screens |
| --- | ------------------------------------------------------------------------ | -------------- |
| C1  | **Two-section sidebar** (Work / Settings) with persistent shell          | all            |
| C2  | **Outer-card content frame** wrapping every page body                    | all            |
| C3  | **Card header triplet**: icon + bold title + muted subtitle              | all            |
| C4  | **Top bar**: sidebar toggle + breadcrumb (left) + context widget (right) | all            |
| C5  | **4 metric cards row** on home dashboard                                 | 02             |
| C6  | **Color-coded status dots**: green=ok, red=error, gray=idle              | 02, 19         |
| C7  | **Empty state = centered icon + 1-line copy + primary CTA**              | 11, 13         |
| C8  | **Creation = modal dialog**, not full page                               | 04             |
| C9  | **Friendly placeholder text** in forms (e.g., "Vandelay Industries")     | 04             |
| C10 | **Card grid with filter + sort + tags row** on list pages                | 03             |
| C11 | **`...` overflow menu** on cards for secondary actions                   | 03             |
| C12 | **Stacked sub-cards within outer frame** for multi-section pages         | 09             |
| C13 | **Account card pinned at sidebar bottom** with avatar + email            | all            |
| C14 | **Version string** tiny at the very bottom of sidebar                    | all            |
| C15 | **Status chips** (green "Ready" / blue "Active" etc.)                    | 19             |
| C16 | **Recharts for time-series monitoring**, minimal axis chrome             | 17             |

---

## 5. ADAPT List (변형 채택)

Concepts to borrow but change shape for OpenLander's different value proposition:

| #   | Dokploy                                                         | OpenLander adaptation                                                                                                             |
| --- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A1  | "My Organization" top switcher                                  | Keep slot but use "Workspace" or make optional                                                                                    |
| A2  | Server Time UTC clock top-right                                 | Replace with **Agent/MCP status indicator** (connected/disconnected)                                                              |
| A3  | 9 Settings entries flat                                         | Consolidate to 5-6 groups (Account / Server / Integrations / Security / Advanced)                                                 |
| A4  | `Deployments` and `Schedules` as sidebar siblings of `Projects` | Push these into Project detail (tabs) for clearer nouns-first IA                                                                  |
| A5  | AI buried in Settings                                           | Make AI/Agent a **top-level sidebar entry** — it's the core of the product                                                        |
| A6  | Git Providers colored brand buttons                             | Copy but add **trigger-type selector first**: `GitHub App / PAT / SSH` → then brand — shows localhost-friendly options by default |
| A7  | "Welcome back, {firstName}"                                     | Keep the personalization; could add **last agent action** ("Last deploy by Claude @ 14:32")                                       |
| A8  | `Create your first X` empty state                               | Copy + add **"Ask the agent"** as secondary CTA ("Or let Claude set it up for you")                                               |

---

## 6. SKIP List (채택 불가/불필요)

| #   | What                               | Why skip                                                                      |
| --- | ---------------------------------- | ----------------------------------------------------------------------------- |
| S1  | **`Swarm` page**                   | OpenLander not using Docker Swarm (per CCG decision). Entire section N/A.     |
| S2  | **`Traefik File System`** page     | Raw Traefik config browser. Low-level, debug only. OpenLander abstracts this. |
| S3  | **`Docker` containers listing**    | Host-level container introspection. Leaks orchestrator internals.             |
| S4  | **`Requests` page** (Traefik logs) | Merge into a general Monitoring/Logs stream instead of a separate tab         |
| S5  | **`Audit Logs`** as dedicated page | Fold into Monitoring → Events tab                                             |
| S6  | **`Remote Servers`**               | Multi-server is a Pro/Cluster roadmap item, not 1.0 IA                        |
| S7  | **"Add AI" as BYOK key form**      | OpenLander's AI is native (MCP); user doesn't paste OpenAI keys               |

---

## 7. OpenLander Distinctive Additions

Things Dokploy **doesn't have** that OpenLander should add to express its agent-native / transparency positioning (per Gemini/Codex CCG review):

### D1. Agent / Conversation sidebar entry

First-class surface. One-click into "Deploy this project" dialog with agent context pre-loaded. Alternative: persistent floating MCP console (like a terminal drawer).

### D2. "View Docker Command" button on deploys

Every deployment row has a subtle `view command` link → shows the exact `docker run` / `docker compose` invocation used. Gemini's recommendation for the "transparent" positioning.

### D3. Deployment Triggers page (per project)

Shows active triggers: `🤖 Agent (MCP) · ⏱ Git poll · 🪝 Webhook (public URL required) · 🧰 Self-hosted runner`. User toggles which are active. This IS the Dokploy-missing differentiation.

### D4. Live log streaming as a first-class affordance

Dokploy buries logs in a `logs →` link at end of rows. OpenLander should elevate this: each project card shows live stderr tail (last 3 lines), click to expand to full pane. Matches "debuggability" Gemini insight.

### D5. Empty-state agent prompts

Every empty state has "Or ask the agent" secondary CTA. e.g. AI config empty → "Claude, configure my AI key". Reinforces agent-as-interface.

---

## 8. Priority for `ui-redesign-1.0` Sprint

Ranked by (high-impact, low-cost) first:

1. **[C1, C2, C3]** Adopt persistent sidebar + outer-card + title-triplet. This alone fixes 60% of "scattered" feeling. → 2-3 days.
2. **[A4]** Move Deployments/Schedules **into Project detail**. This aligns noun-first IA. → 1 day.
3. **[C8, C9]** Convert project/resource creation flows to modals. → 1-2 days.
4. **[C5, C6]** Home dashboard = 4 metric cards + recent deploys list. → 1-2 days.
5. **[A5]** Elevate Agent/MCP to sidebar top-level. → 0.5 day (just IA move).
6. **[D2]** "View Docker Command" button on deploys. → 1 day.
7. **[D3]** Deployment Triggers page. → 2-3 days (new feature).
8. **[A6]** Git Provider chooser with PAT/SSH first-class (not behind Advanced). → 0.5 day.
9. **[D4]** Live log stream on project cards. → 2 days.

**Total 1.0 scope**: ~12-15 engineer-days for the IA+UX restructure alone. Add backend wiring for D3/D4 separately.

---

## 9. Visual Language Summary (confirmed from live instance)

- **Primary color**: near-black (`#000` or `hsl(0 0% ~5%)`)
- **Background**: very light gray (`~#F5F5F5`)
- **Card background**: white (`#FFFFFF`), subtle border `1px solid hsl(0 0% ~90%)`, radius `~12px`
- **Accent**: teal (CPU chart `~#0AA`), orange (memory `~#F08`), blue (informational chips)
- **Semantic**: green `● running`, red `● errored`, gray `● idle`
- **Typography**: Inter (matches existing analysis), body 14px, titles 16–24px, uppercase tiny labels for metric cards
- **Spacing**: generous (`py-6 px-8` on cards, ~24–32px between card sections)
- **Icons**: Lucide, 16–20px in sidebar, 20–24px in card headers
- **Animation**: minimal — focus rings, subtle hover color shifts, no motion decoration

---

## 10. Screenshot Reference Index

All paths relative to repo root:

| #   | File                                                              | Purpose                              |
| --- | ----------------------------------------------------------------- | ------------------------------------ |
| 01  | `.omc/analysis/dokploy-screenshots/01-login-filled.png`           | Login screen pre-submit              |
| 02  | `.omc/analysis/dokploy-screenshots/02-after-login.png`            | Global dashboard (home)              |
| 03  | `.omc/analysis/dokploy-screenshots/03-projects-list.png`          | Projects list with one card          |
| 04  | `.omc/analysis/dokploy-screenshots/04-create-project-dialog.png`  | Create project modal                 |
| 09  | `.omc/analysis/dokploy-screenshots/09-settings-profile.png`       | Profile settings (stacked sub-cards) |
| 10  | `.omc/analysis/dokploy-screenshots/10-settings-server.png`        | Web Server settings                  |
| 11  | `.omc/analysis/dokploy-screenshots/11-settings-git-providers.png` | Git Providers empty state            |
| 12  | `.omc/analysis/dokploy-screenshots/12-settings-ssh-keys.png`      | SSH Keys                             |
| 13  | `.omc/analysis/dokploy-screenshots/13-settings-ai.png`            | AI BYOK config empty state           |
| 14  | `.omc/analysis/dokploy-screenshots/14-settings-users.png`         | Users / invites                      |
| 15  | `.omc/analysis/dokploy-screenshots/15-settings-notifications.png` | Notifications                        |
| 17  | `.omc/analysis/dokploy-screenshots/17-monitoring.png`             | Server monitoring (CPU/Mem/Disk)     |
| 18  | `.omc/analysis/dokploy-screenshots/18-docker.png`                 | Docker containers table              |
| 19  | `.omc/analysis/dokploy-screenshots/19-swarm.png`                  | Swarm cluster overview               |
| 20  | `.omc/analysis/dokploy-screenshots/20-requests.png`               | Traefik requests log                 |

---

## 11. Real-World Deploy Case Study — `hotdeal-tracker`

Second wave of hands-on: actually deploying a private multi-service monorepo (FastAPI + Next.js + arq worker + Postgres + Redis) via Dokploy Compose mode. Screenshots: [`.omc/analysis/dokploy-hotdeal/`](../../../.omc/analysis/dokploy-hotdeal/).

### 11.1 Setup Flow Observed

1. **Git Provider**: Dokploy v0.29.1's GitHub provider dialog only exposes the "Create GitHub App" manifest flow — **no PAT field**. Locally unusable without a public webhook URL. Workaround: Dokploy's own SSH Key generator + GitHub Deploy Keys (automated via `gh api repos/.../keys`).
2. **Project/Service creation**: 2-level — Project "hotdeal-tracker" → Compose service "hotdeal-app". Same "outer card + icon+title+description" skeleton reused.
3. **Compose configuration (Git tab)**: Repository URL + Branch + Compose Path + Watch Paths + Enable Submodules + SSH Key dropdown. Clean form.
4. **Deploy trigger**: `Deploy` button → modal **"Are you sure?"** → `Confirm` → **automatic tab transition to Deployments** (zero extra click to see progress). This is the cleanest small UX win observed.
5. **Log surface**: Deployments row has `View` button → **full-screen modal overlay** with line numbers + semantic prefix + scrollable text. Modal dismissable without killing build.

### 11.2 Dokploy Compose Service Tab Inventory

Observed live (as opposed to what the earlier source-based docs guessed):

```
General | Environment | Domains | Deployments | Containers | Backups | Schedules | Volume Backups | Logs | Patches | Monitoring | Advanced
```

12 tabs. Noteworthy:

- **Containers** tab: "Inspect each container in this compose and run basic lifecycle actions." — this is how Dokploy exposes the N inner services of a compose deploy. Empty-state when not yet deployed.
- **Patches** tab: "Apply code patches to your repository during build. Patches are applied after cloning the repository and before building." — novel feature. Lets you mutate repo state without forking. Potential OpenLander parity target if agent-assisted repo patching becomes a feature.
- **Advanced** tab: allows overriding the base `docker compose ...` command. The UI explicitly states "the command starts with **docker**" — a footgun I hit personally (see §12).

### 11.3 Live Streaming Log Format (authoritative sample)

Extracted from `.omc/analysis/dokploy-hotdeal/deploy-log-2.txt` (141KB build log):

```
info   # default-level output, no color highlight
success Container hotdeal-api Started           # green highlight (lifecycle transitions)
debug  [api] exporting to image                 # lower contrast, non-essential
error  dependency failed to start: ...          # red background + red dot in history
```

BuildKit step markers appear as `#12 CACHED`, `#9 DONE 0.1s`. Pull progress bars are text (`| 80% of 106.4 MiB`) — no animated GIFs or complex UI. Container lifecycle events ("Container X Creating / Created / Starting / Started / Waiting / Error") form the true state machine.

**→ GUIDE-04 (Log Streaming) gets its authoritative phase list + prefix vocabulary from this sample.**

---

## 12. Error Taxonomy — 6 Failure Modes Observed (Live)

Each row = one deploy attempt on this session. All data sourced from actual Dokploy logs under `.omc/analysis/dokploy-hotdeal/`.

| #   | Dokploy log error                                                                   | Root cause                                                                                                                                                    | Fix committed to `dokploy-compat` branch                                                      | UI reaction observed                                                                            |
| --- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 1   | `target web: failed to solve: "/apps/web": not found`                               | `compose.web.build.context: ./apps/web` + Dockerfile does `COPY apps/web/...` (root-relative)                                                                 | `context: .` + explicit `dockerfile: Dockerfile.web`                                          | Deploy history card · Error (red dot) · **9s** duration                                         |
| 2   | `dependency failed to start: container hotdeal-api is unhealthy`                    | Build OK; runtime DB missing (postgres gated by `profiles: ["infra"]`)                                                                                        | Enable `--profile infra` in Advanced → Run Command + add `DATABASE_URL`, `REDIS_URL` env vars | Deploy card · Error · **1m 40s** (longer = built but runtime-failed)                            |
| 3   | `unknown shorthand flag: 'p' in -p`                                                 | My custom command started with `docker compose ...` but Dokploy auto-prepends `docker ` → `docker docker compose`                                             | Drop leading `docker` — write `compose -p ... up -d`                                          | **2s** fail in log header before build even starts                                              |
| 4   | `SEED_SITE is required` (crash loop)                                                | Dockerfile.api has 3 stages (`api`/`worker`/`seed`). Compose didn't specify `target` → default picks **last stage** (`seed`) whose entrypoint needs SEED_SITE | Explicit `build.target: api` / `target: worker`                                               | Container status: "Restarting (1)" repeated in `docker ps` + `docker logs` shows repeated error |
| 5   | `extension "vector" is not available. [SQL: CREATE EXTENSION IF NOT EXISTS vector]` | alembic migration requires pgvector; `postgres:16-alpine` image lacks it                                                                                      | Replace `postgres:16-alpine` with `pgvector/pgvector:pg16` + `docker volume rm` old data      | app container healthy until migration phase; Dokploy log highlights `error` on SQL line         |
| 6   | `Bind for 0.0.0.0:3000 failed: port is already allocated`                           | compose `web.ports: "3000:3000"` conflicts with Dokploy UI itself (also on host:3000)                                                                         | Switch `ports:` to `expose:` (internal-network only)                                          | `docker start` fails at compose layer; web container stuck at "Created" never "Starting"        |

### 12.1 Mapping to UI Reaction Categories (input for GUIDE-05)

Each row above maps to a UI-reaction category OpenLander should formalize:

| Category                 | Dokploy's treatment                           | OpenLander 1.0 opportunity                                                            |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------- |
| `BUILD_CONTEXT_MISMATCH` | Error highlighted inside log modal            | Inline card with **"this path was expected here"** diff + suggest `dockerfile:` field |
| `DEPENDENCY_UNHEALTHY`   | Generic "dependency failed to start"          | Show **which** dep failed + link to that service's logs                               |
| `CLI_OVERRIDE_SYNTAX`    | Raw `unknown shorthand flag` from docker      | Validate custom command **on save** with dry-run                                      |
| `IMAGE_WRONG_STAGE`      | Confusing infinite restart w/ SEED_SITE error | Inspect image layers, detect multi-stage, **warn on ambiguous target** at config time |
| `DB_EXTENSION_MISSING`   | Generic SQL error surfaced                    | DB preset knowledge base: **"Your migrations use X extension — switch to image Y?"**  |
| `PORT_CONFLICT_HOST`     | "port is already allocated" (system error)    | **Auto-detect** busy host port + suggest free one, OR default to Traefik-internal     |

This is the core input for `GUIDE-05-error-taxonomy.md` — each category becomes a row: trigger → expected UI reaction → surface level (toast / inline card / banner / dialog).

---

## 13. OpenLander MCP vs Dokploy Compose — Side-by-Side (same repo, same branches)

Verified directly via MCP call to OpenLander's production VPS and via Playwright+Lima Dokploy session within the same day.

### 13.1 Repository parity

- **OpenLander side**: `hotdeal-api` / `hotdeal-web` / `hotdeal-worker` all `running` on branch **develop** (verified via `openlander_project.list_projects`)
- **Dokploy side**: Compose service on branch **dokploy-compat** (a minimal fix of develop's compose). 5/5 containers Up after 6 iterations. api/worker/postgres/redis fully healthy, web container runs but Next.js port binding has a Lima-VZ-specific networking quirk (unresolved, not in scope).

### 13.2 What each approach required from the user

| Dimension             | OpenLander (MCP agent)                               | Dokploy (Compose + UI)                                                            |
| --------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| Entry point           | Conversational: "Deploy hotdeal-tracker"             | 3 tab areas of config (Git, Environment, Advanced) + 6 commit+redeploy iterations |
| Dockerfile picking    | Agent infers from repo root (`Dockerfile.{api,web}`) | Manual `dockerfile: X` per service                                                |
| Multi-stage target    | Auto (separate Application services per role)        | Manual `build.target: api/worker`                                                 |
| DB/Redis provisioning | `openlander_service.create_service` preset           | Compose profile flag + volume mgmt                                                |
| Network topology      | `ol-{project-name}` DNS auto-allocated               | compose project prefix naming + manual env wiring                                 |
| Port allocation       | Host port auto-picked from 10000+ pool               | Manual conflict resolution                                                        |
| Failed attempts       | 0 (first try green)                                  | **6 iterations** to functional state                                              |
| Wall-clock to green   | minutes (agent dialog)                               | **~2 hours** including debug iterations                                           |

### 13.3 Implication for OpenLander 1.0 positioning

The stack of bugs I hit on Dokploy is not Dokploy-specific — those are just the six natural ways a monorepo compose deploy can fail. OpenLander's agent didn't _avoid_ those complications; it **absorbed them**:

- It inferred `Dockerfile.X` from repo (avoided bug #1)
- It picked the correct build target per service (avoided bug #4)
- It provisioned pgvector Postgres as a managed service (avoided bug #5)
- It auto-allocated host ports (avoided bug #6)
- It never dealt with a docker-compose-custom-command footgun (avoided bug #3)
- It wired DB env vars via its own preset credentials flow (avoided bug #2)

**Narrative for 1.0 positioning** (informs marketing + landing copy):

> Deploying a real monorepo isn't hard because any single step is complex. It's hard because there are ~6 places where a small mismatch silently breaks runtime. Traditional compose-based PaaS exposes every one of them to the user. OpenLander absorbs them in the agent layer.

This is the honest version of the positioning Gemini drafted earlier ("Orchestrator who works for you"). Now backed by real data.

### 13.4 What we do NOT gain from the agent (for balance)

- No visible dashboard in 1.0 — relies entirely on MCP client (Claude Code, Cursor). Users without those lack visibility.
- Debugging a black-box agent is harder than debugging a textbox in a dashboard. Empty error states become "agent didn't respond as expected".
- Runtime monitoring still needs a UI surface (even if deploy is agent-driven). That's where OpenLander 1.0 UI redesign work focuses: **"operator-less deploy, operator-grade observability"**.

---

## 14. Caveats

- Captured against **one user's single-project instance**. Project detail and service detail screens were not captured in the first wave (user had no projects at capture time; later created `test`). Second-wave (hotdeal) covers those thoroughly.
- VM is arm64 (Apple Silicon via Lima vz backend) — one Lima-specific quirk surfaced: Next.js 14 standalone web container shows "Ready" but inbound connections time out. Not reproduced on bare Linux; treat as a Lima/VZ bridge issue, not a Dokploy or hotdeal-tracker bug.
- UI strings are v0.29.1. Dokploy iterates fast — expect string drift within months, UI structure more stable.
- `dokploy-compat` branch on `hotdeal-tracker` (5 commits on top of `develop`) is the functional fix trail. Useful as a test case; merge to `develop` only after judging whether plain `docker compose up` compatibility is actually desired (vs keeping the OpenLander-only Dockerfile.X setup).

---

## 15. Re-run Instructions

### First-wave screenshots (UI tour)

```bash
limactl list                       # dokploy must be Running
node .omc/analysis/dokploy-capture.mjs
# → writes to .omc/analysis/dokploy-screenshots/
```

### Second-wave deploy case study (hotdeal-tracker)

```bash
# Interactive step-based (recommended for debugging):
cd /Users/idongbin/project/OpenLander
node .omc/analysis/dokploy-hotdeal/step-<N>.mjs   # each step persists via storageState.json

# Clean teardown (when experiment is done):
limactl stop dokploy && limactl delete dokploy
gh api -X DELETE repos/lehdqlsl/hotdeal-tracker/keys/149512023   # deploy key cleanup
```

### OpenLander MCP side

```bash
# The MCP server is already registered in Claude Code:
# /Users/idongbin/.claude.json — "openlander": { url: http://100.75.249.124:10114/mcp }
# Restart Claude Code session to pick up tool schemas, OR call directly:
./call.sh openlander_project list_projects '{}'
# (helper at .omc/analysis/openlander-mcp/call.sh)
```

If Dokploy login path changes, update the `/` URL and `#login-form` selectors in the script.
