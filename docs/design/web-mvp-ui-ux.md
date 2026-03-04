# OpenLander Web MVP — UI/UX Design Specification

## 1. Design Direction

### Aesthetic: "Cyber-Industrial Precision"

We are moving away from the generic "SaaS Dashboard" look. OpenLander is a tool for builders who want power without the pain. The aesthetic should feel like a **futuristic cockpit**—dark, high-contrast, data-dense but organized.

- **Tone:** Autonomous, Deterministic, Transparent.
- **The "Vibe":** Think _Linear_ meets _Terminal_ meets _Sci-Fi HUD_.
- **The ONE thing to remember:** The **"Living Timeline"**—a pulsing, streaming vertical feed that makes the invisible server work visible and beautiful.

### Color Palette (Dark Mode Default)

We avoid the "purple gradient AI slop". We use a strict, functional palette inspired by terminal syntax highlighting.

- **Backgrounds:**
  - `--bg-app`: `#050505` (Almost black, not grey)
  - `--bg-panel`: `#0A0A0A` (Slightly lighter for cards/sidebars)
  - `--bg-subtle`: `#171717` (Hover states, inputs)
- **Primary Accents:**
  - `--color-agent`: `#06B6D4` (Cyan-500) — Represents the AI Agent's voice/actions.
  - `--color-success`: `#22C55E` (Green-500) — Deploy success, healthy state.
  - `--color-warning`: `#F59E0B` (Amber-500) — Building, processing, attention needed.
  - `--color-error`: `#EF4444` (Red-500) — Failures.
- **Text:**
  - `--text-primary`: `#FAFAFA` (White)
  - `--text-secondary`: `#A1A1AA` (Zinc-400)
  - `--text-muted`: `#52525B` (Zinc-600)

### Typography

We avoid the "safe" choices (Inter, Roboto). We want character.

- **Display / Headers:** **Outfit** (Google Fonts). Geometric, bold, modern.
  - Use heavy weights (700/800) for project titles and major stats.
- **Body / UI:** **Manrope** (Google Fonts). Highly readable, modern, distinct from Inter.
- **Code / Data:** **JetBrains Mono**. The gold standard for developer tools.

---

## 2. Information Architecture

### Site Map

- **/** (Root) → Redirects to `/projects` or `/setup`
- **/setup** → Onboarding Wizard (LLM Key, GitHub Auth)
- **/projects** → Project Grid (Home)
- **/projects/new** → New Project Flow
- **/projects/:id** → Project Detail (The "Hero" Screen)
  - **Tab: Timeline** (Default)
  - **Tab: Logs**
  - **Tab: Configuration** (Env, Domain, Settings)
- **/settings** → Global Settings (LLM, System)

### Navigation Model

- **Sidebar (Left):**
  - **Top:** "OpenLander" Logo (Home)
  - **Middle:** Project List (Quick nav to recent projects)
  - **Bottom:** User Profile / Settings / System Stats (CPU/RAM mini-chart)
- **Command Palette (`Cmd+K`):** Global navigation and actions (Deploy, Stop, Go to Project).

---

## 3. Core Screens

### 3a. Onboarding (`/setup`)

- **Goal:** "3 steps to magic."
- **Layout:** Centered card on a dark, subtle grid background.
- **Steps:**
  1.  **Welcome:** "I am OpenLander. I control this server."
  2.  **Brain:** "I need a brain." (Select LLM Provider + Paste Key).
  3.  **Access:** "I need code." (Connect GitHub Account).
- **Micro-interaction:** When the API key is validated, the "Connect" button pulses green.

### 3b. Projects List (`/projects`)

- **Layout:** Responsive Grid (Cards).
- **Project Card:**
  - **Header:** Repo Name (e.g., `my-app`) + Status Dot (Green/Red/Amber).
  - **Body:** Live URL (clickable), Last Deploy (Time), Branch (`main`).
  - **Footer:** Mini sparkline of CPU usage (if available) or simple "Healthy" badge.
  - **Hover:** "Deploy" and "Settings" buttons appear.
- **Empty State:** A large, dashed-border card saying "Deploy your first app" with a `+` icon.

### 3c. New Project Flow (`/projects/new`)

- **Step 1: Repo Selection**
  - Searchable list of GitHub repositories (including Org repos).
  - Tabs: "My Repos", "Starred", "Search".
  - Row item: Repo Name, Language Icon (JS, Py, Go), "Select" button.
- **Step 2: The Handoff**
  - User clicks "Select".
  - Screen transitions immediately to **Project Detail (Timeline)**.
  - **Animation:** The repo card "expands" to fill the screen, and the Agent Timeline begins typing.

### 3d. Project Detail — Agent Timeline (THE HERO SCREEN)

- **Layout:**
  - **Header:** Project Name, Live URL, Status Badge, "Deploy" Button.
  - **Main Content:** A vertical timeline (The "Feed").
  - **Right Panel (Collapsible):** Chat / Agent Intervention.
- **The Timeline Feed:**
  - **Concept:** A chronological log of the Agent's "thought process" and actions.
  - **Items:**
    - **Decision:** 🧠 "Detected Next.js project. Using Node 20 adapter."
    - **Action:** 🛠️ "Generating Dockerfile..." (Click to view code).
    - **Process:** ⏳ "Building container..." (Shows progress bar + streaming logs inline).
    - **Success:** ✅ "Health check passed. App is live."
  - **Interactivity:**
    - Clicking "Building..." expands to show the raw build logs _within_ the timeline card.
    - If the Agent fails, the card turns red with a "Fix with AI" button.
- **Agent Input:**
  - If the Agent needs a variable (e.g., `DATABASE_URL`), a **Form Card** appears directly in the timeline.
  - "I need a `DATABASE_URL` to start the app." [ Input Field ] [ Submit ].
  - This keeps the user in the flow without forcing them to "Chat".

### 3e. Project Detail — Configuration

- **Env Vars:**
  - Table view. Key (bold), Value (masked `••••`).
  - "Reveal" eye icon.
  - "Paste .env" bulk import feature.
- **Domains:**
  - "Internal URL": `http://app.local:10001` (Copy button).
  - "Public URL": Toggle switch for "Expose to Internet" (Cloudflare Tunnel).
  - Custom Domain input.

### 3f. Chat Panel (Secondary)

- **Behavior:** Slide-over from the right (Sheet).
- **Trigger:** "Ask Agent" button in header OR "Fix Issue" button on a failed timeline item.
- **Content:** Standard chat interface.
- **Context:** The chat is _aware_ of the current project and the specific error selected.

### 3g. Log Viewer

- **Access:** Tab "Logs" or click "View Logs" on a running project.
- **UI:**
  - Dark terminal background (`#000`).
  - `JetBrains Mono` font.
  - "Follow" (Auto-scroll) toggle.
  - Search bar with regex support.
  - Color-coded log levels (INFO=Blue, WARN=Yellow, ERROR=Red).

---

## 4. Interaction Patterns

### The "Intervention" Pattern

1.  **Agent runs autonomously.** Timeline updates.
2.  **Blocker encountered.** (e.g., Missing Env Var).
3.  **Timeline Pauses.** A "Request" card appears at the bottom of the feed.
4.  **User Acts.** User fills the input or clicks a button.
5.  **Agent Resumes.** Timeline continues.

### Build Progress

- Instead of a spinner, show a **Progress Card** in the timeline.
- "Building Image..."
- [==================>........] 65%
- _Subtext:_ "Step 4/7: Installing dependencies..."

### Status Transitions

- **Idle:** Grey dot.
- **Deploying:** Pulsing Amber ring.
- **Live:** Solid Green dot + "Ripple" effect on change.
- **Failed:** Solid Red dot.

---

## 5. Responsive Strategy

- **Desktop (Primary):** Full 3-column layout (Sidebar, Timeline, Chat/Details).
- **Tablet:** Sidebar collapses to icons. Chat becomes a modal.
- **Mobile:**
  - **Read-only focus.**
  - Home: List of projects with status.
  - Detail: Simplified timeline (hide raw logs).
  - Actions: "Stop", "Restart" available. "Deploy" warns about screen size.

---

## 6. Component Architecture

### Key Components

- `TimelineFeed`: The scrollable container for agent events.
- `TimelineItem`: Polymorphic component (Decision, Action, Process, InputRequest).
- `LogStream`: Virtualized list for high-performance log rendering.
- `StatusBadge`: Animated indicator.
- `ProjectCard`: Dashboard grid item.

### State Management

- **Global:** User Session, System Stats (Zustand).
- **Project:** React Query (TanStack Query) for polling/SSE sync.
- **Logs:** specialized hook `useLogStream` handling WebSocket/SSE buffers.

---

## 7. Motion & Micro-interactions

- **Entry:** Timeline items slide in from the bottom with a slight fade (`y: 20 -> 0`, `opacity: 0 -> 1`).
- **Streaming:** Text appears character-by-character (fast) for Agent messages to simulate "thinking".
- **Success:** When a deploy finishes, a subtle "confetti" or green glow emanates from the status badge.
- **Hover:** Cards lift slightly (`scale: 1.01`) and border brightens.

---

# Implementation Plan (Next Steps)

1.  **Setup Theme:** Configure Tailwind v4 with the new color palette and fonts.
2.  **Layout Refactor:** Move `ChatPanel` to a sidebar/sheet and build the `ProjectDetail` skeleton.
3.  **Timeline Component:** Build the `TimelineFeed` and `TimelineItem` components.
4.  **Connect Data:** Wire up the timeline to the existing SSE stream.
