# GUIDE-04 — Log Streaming Spec

> **Audience**: Claude Design (for producing the log viewer layout) + implementer (for the reducer/store behavior).
> **Why it exists**: The current OpenLander log viewer has state-management bugs — connection reset loses lines, tab-switching duplicates or drops, scroll-pause is inconsistent. This spec removes the ambiguity so both design and code can be produced without guessing.
> **Status**: draft. Freeze after one review pass with `/oh-my-claudecode:ccg`.

Anchor data: Dokploy's production log format, sampled live 2026-04-24 at `.omc/analysis/dokploy-hotdeal/deploy-log-{1,2,3}.txt` (21KB / 141KB / 240KB). Plus the 6 real failure modes in `DOKPLOY_HANDSON_UX_ANALYSIS.md` §12.

---

## 1. The Deploy Lifecycle — Phases Being Streamed

Every deploy log is a concatenation of these phases, in order. Only phases that actually run for the given deploy type appear. Each phase has a **canonical name**, a **typical duration band**, and a **user-visible chapter title** for the viewer.

| #   | Phase (internal)   | User-facing title            | Typical duration | Can skip?                      |
| --- | ------------------ | ---------------------------- | ---------------- | ------------------------------ |
| 1   | `clone`            | Cloning repository           | 2–30 s           | no (if Git source)             |
| 2   | `image_pull`       | Pulling base images          | 5 s–5 min        | if all cached                  |
| 3   | `build`            | Building image(s)            | 30 s–10 min      | if using prebuilt image source |
| 4   | `image_export`     | Saving image layers          | 2–20 s           | no (follows build)             |
| 5   | `network_prepare`  | Preparing network & volumes  | < 2 s            | no                             |
| 6   | `container_create` | Creating containers          | < 5 s            | no                             |
| 7   | `container_start`  | Starting containers          | 1–20 s           | no                             |
| 8   | `healthcheck_wait` | Waiting for health           | 5 s–2 min        | if no healthcheck              |
| 9   | `done` / `failed`  | Deployment complete / failed | instant          | no (terminal state)            |

### Phase transitions — the rules

- Phases are **strictly ordered**; phase N+1 starts only after phase N completes cleanly.
- Any phase can emit **warnings** (non-fatal) — those do not skip ahead.
- Any phase can **fail** — failure jumps directly to `failed` with the current phase recorded as `failed_phase`.
- The viewer MUST render a **phase header** each time the phase changes (see §6 "Visual Examples").

### Phase detection — how the backend signals

Current OpenLander NDJSON stream already emits `phase` field per line. If not, derive heuristically:

- `clone`: `git clone`, `Cloning into`, `Resolving deltas:`
- `image_pull`: `Pulling fs layer`, `Pull complete`, `Image X Pulled`
- `build`: `#NN [stage step N/M]`, `DONE Xs`, `CACHED`
- `container_create`: `Container X Creating/Created`
- `container_start`: `Container X Starting/Started`
- `healthcheck_wait`: `Container X Waiting`
- Terminal: `Error command failed`, or clean compose exit

Use explicit backend emission; fall back to heuristics only if absent.

---

## 2. Log Viewer State Machine — Two Orthogonal Axes

The viewer's state is **not one axis — it's two** (per Codex review). Modeling them as one produces an incomplete FSM and missing states like `BACKFILLING` and `CANCELLED`. The rewrite:

### 2.1 Axis A — Connection State (what is the stream doing?)

```
  [IDLE]
     │  user opens log view
     ▼
  [CONNECTING] — spinner, "Connecting to log stream…"
     │  1st line received
     ▼
  [LIVE] — receiving new lines from backend
     │                │                │                │
     │ backend sends  │ connection     │ user clicks    │ backend sends
     │   done/failed  │   drops        │   Kill Build   │   done with
     │                │                │   (DP-6)       │   cancelled flag
     ▼                ▼                ▼                ▼
  [ENDED]      [RECONNECTING]     [CANCELLED]      [CANCELLED]
    — Done   — "Connection lost   — "Build stopped   (same terminal)
      Failed   retrying... N/5"     by you"
               │  success → [BACKFILLING] → [LIVE]   (v1.1 only; see §4.1)
               │          OR → [LIVE]                (v1.0 degraded mode)
               │  exhausted → [ERRORED]
               ▼
             [ERRORED] — "Stream dropped. View partial logs or Re-deploy."
```

**Transition rules**:

- `IDLE → CONNECTING`: on open of log view for a running / recent deploy
- `CONNECTING → LIVE`: on first `data:` message
- `LIVE → ENDED`: backend sent terminal event (`done` or `failed`) — no further reconnect
- `LIVE → RECONNECTING`: WebSocket / SSE close without terminal event
- `LIVE → CANCELLED`: user clicked Kill Build (GUIDE-00 **DP-6**) and backend confirmed stop
- `RECONNECTING → LIVE` (v1.0 degraded): resume from fresh tail; show `⚠ Reconnected — earlier lines not recovered` notice
- `RECONNECTING → BACKFILLING → LIVE` (v1.1, GUIDE-00 **LS-3**): server returns missed lines by `since=<seq>`, then live stream resumes
- `RECONNECTING → ERRORED`: exhausted N=5 attempts with exponential backoff (1s, 2s, 4s, 8s, 16s)

### 2.2 Axis B — Viewport State (what is the user looking at?)

```
  [FOLLOWING]  ← new lines auto-scroll into view, "Live" pill shown in header
     │                               ▲
     │  any upward scroll gesture    │
     │  (wheel / touch / Page Up)    │  user clicks "Jump to latest" OR
     ▼                               │  scrolls back to bottom
  [PAUSED]     ← float at bottom-right: "↓ N new lines — Jump to latest"
```

Viewport state is **independent of connection state**. PAUSED can be entered while LIVE, RECONNECTING, BACKFILLING, or even ENDED (user can scroll within a completed log).

### 2.3 Combined-state examples

| Connection × Viewport    | UX cues shown                                                              |
| ------------------------ | -------------------------------------------------------------------------- |
| LIVE × FOLLOWING         | "Live" pill, auto-scroll, no floating indicator                            |
| LIVE × PAUSED            | "Live" pill, float `↓ N new` visible, new lines not auto-scrolled          |
| RECONNECTING × FOLLOWING | Top banner "Reconnecting... (3/5)", auto-scroll will resume on LIVE        |
| RECONNECTING × PAUSED    | Both cues — banner + float                                                 |
| ENDED × FOLLOWING        | "Done" or "Failed" pill, scroll released (no auto-scroll — stream's over)  |
| CANCELLED × FOLLOWING    | "Stopped" pill, "Build cancelled by you" inline summary                    |
| BACKFILLING × any        | Inline "Recovering N missed lines..." separator; lines prepend from cursor |

### 2.4 Why split (Codex rationale)

Before split: `STREAMING_PAUSED` conflated "connection is live" with "user is reading backwards" — which is wrong because the user can scroll around in an ENDED log too, and BACKFILLING never fit anywhere. Split axes compose cleanly and let us add CANCELLED (for Kill Build, DP-6) without a refactor.

---

## 3. Line Format & Semantics

Each log line is rendered with 3 fields: **line number** (sidebar), **semantic prefix** (color), **payload**. Optional: **BuildKit step marker**.

### Semantic prefix vocabulary (authoritative from Dokploy sample)

| Prefix    | Color intent                                                   | Usage                                                             |
| --------- | -------------------------------------------------------------- | ----------------------------------------------------------------- |
| `info`    | neutral (default text color)                                   | Default — most lines                                              |
| `success` | green (`hsl(140, 60%, 45%)` light / `hsl(140, 50%, 55%)` dark) | Lifecycle wins: `Container X Started`, `Image X Built`, `DONE Xs` |
| `warning` | amber                                                          | Non-fatal: retry attempts, deprecation notices                    |
| `error`   | red background on the whole line + red dot in left margin      | Terminal errors + mid-stream failures                             |
| `debug`   | muted (60% opacity)                                            | Internal bookkeeping; off by default, user can toggle to show     |

OpenLander's backend should emit prefix explicitly. Heuristic fallbacks if missing:

- Lines starting with `Error`, `FATAL`, `failed to`, `dependency failed` → `error`
- Lines matching `DONE Xs`, `Pull complete`, `Started` → `success`
- Lines containing `WARN`, `deprecated`, `retry` → `warning`

### BuildKit step markers

Build phase lines have a `#NN` prefix (e.g., `#12 CACHED`, `#7 DONE 0.0s`). Render these **right-aligned** or **subtly inline** next to payload to keep visual noise low. Don't strip them — users rely on them to find failing steps.

### Optional: timestamps

Show timestamps by default only in `STREAMING_PAUSED` / `ENDED` / review modes (not in live streaming — reduces visual flicker). Format: `HH:MM:SS.mmm` relative to deploy start (not wall-clock), shown in muted style.

---

## 4. Design Decisions — Authoritative Rulings

AI cannot guess these; they must be spec'd or the implementation forks on guesses and produces bugs. Each ruling is binding unless explicitly overridden. Capability-matrix refs (`GUIDE-00` IDs) in parentheses.

### 4.1 Reconnection — degraded (v1.0) → cursor-resume (v1.1)

**v1.0 rule (degraded mode — GUIDE-00 LS-1 only)**:

- On reconnect, client establishes a new raw follow from the backend's current tail.
- Client renders a persistent inline separator: `⚠ Reconnected — earlier lines between the drop and resume were not captured. Download the deploy log to see everything.`
- The `Download log` button (§4.6, DP-8 back-end work) stays available — it fetches the full server-side log, which IS complete even if the live stream gapped.

**v1.1 upgrade (GUIDE-00 LS-3)**: client sends `since=<last_line_seq>`; server returns missing lines from a rolling buffer (e.g., last 10,000 lines OR 10 MB, whichever smaller — byte cap added per Codex). On buffer miss: `resume=truncated` response → viewer shows `⚠ 47 earlier lines skipped after reconnection`. State goes through `BACKFILLING` (§2.1) before `LIVE`.

**Why split**: the cursor infrastructure needs a new log subsystem primitive (seq assignment + bounded buffer + replay query) — that's Codex's "🔥 hard" classification. Degraded mode gives users honest feedback today without the refactor; v1.1 closes the gap.

### 4.2 Buffer limit — line count + byte cap + virtualization

**Rule**:

- Client virtualizes DOM: at most 10,000 lines rendered at once via `react-virtual` or equivalent.
- Also enforce a **byte cap** (~10 MB total client-side log buffer) — some builds emit very long lines (minified stack traces) where 10,000 lines = several hundred MB.
- Overflow indicator: `…showing last 10,000 of 47,239 lines (oldest lines truncated — Download for full log)` at top of scrollable area.

**Why byte cap** (Codex): a long-tail build with 500-char lines at 10k-line cap = 5 MB; with 5-KB lines (common for stack traces) it's 50 MB, which tanks browser memory. Cap both.

### 4.3 Tab-switch grace — 120s keep-alive with single-stream-per-deploy caveat

**Rule**:

- When user leaves the log page (different tab / project / browser tab), do NOT tear down the SSE / WebSocket immediately. Keep it alive for 120s (in-memory, no rendering). Return within window → instant resume. Window expires → close connection, next visit does IDLE → CONNECTING (§2.1).
- **Single-stream-per-deploy invariant**: only ONE stream subscription per deploy may exist per browser. Opening the same log page in a second tab reuses the first tab's subscription (via `SharedWorker` or `BroadcastChannel`). This prevents Codex's socket-leak scenario where multi-tab users leak sockets each navigation.

**Why**: indie devs flip between tabs constantly. Killing the stream on nav = page jumps + lost lines. Enforcing single-stream prevents one user = N sockets as tabs accumulate.

### 4.4 ANSI + progress sequences — full parse (not raw, not strip-and-discard)

**Rule**:

- Lines with ANSI escape codes render as styled spans via `anser` (~8KB) client-side. Do NOT show raw `[31m...` characters.
- **Carriage-return progress sequences** (e.g., `\r  Downloading: 45%\r  Downloading: 67%\r Done`) must be parsed and collapsed into a SINGLE animated line in the viewer — NOT rendered as overlapping garbage or as N separate lines. Dokploy's pull-progress lines (`|  99.49MB / 106.4MiB`) are exactly this class.
- **Control character sanitization**: strip `\x00`–`\x08` and `\x0E`–`\x1F` (except `\t`, `\n`, `\r`). Prevents malicious log-injection that could confuse browsers or screen readers.

**Why**: we observed both ANSI color and CR-progress in the Dokploy build log. A viewer that misses either becomes unreadable. Sanitization is cheap insurance.

### 4.5 Auto-scroll — on by default, released on upward gesture

**Rule**:

- Connection state `LIVE`: viewport auto-scrolls to bottom on each new line (Axis B = FOLLOWING).
- On any upward scroll gesture (wheel / touch / keyboard Page-Up / Home / Ctrl-End), immediately flip Axis B to PAUSED; stop auto-scroll.
- Re-entering bottom (scroll-down-to-end OR click "Jump to latest" float) flips B back to FOLLOWING.
- Float `↓ N new lines — Jump to latest` shows in bottom-right whenever B = PAUSED AND new lines have arrived since the pause.

**Why**: users scroll up to read a specific line. Auto-scroll that yanks them back is a pathological anti-pattern (observed in current OpenLander). Cleanly separated from connection state (§2.2).

### 4.6 Copy / download — selection-preserving with explicit fallback

**Rule**:

- Client uses `react-virtual` with `overscan: 20+` to maximize native text-selection range; be aware that naive virtualization still breaks selection across virtualized page boundaries.
- Provide an **explicit `Copy visible range`** button in the viewer header as a fallback — copies all lines currently rendered in DOM (including virtualized overscan). Useful when native selection fails or user wants "everything on screen."
- `⌘C` / `Ctrl+C` copies selected lines as plain text — strip ANSI codes + semantic prefix decoration.
- `Download log` button exports full log as plain text from the **server** endpoint (GUIDE-00 LS-8: `GET /projects/:id/deployments/:id/log.txt`). Filename: `{service-name}-{deploy-id}.log`. Never the trimmed client buffer.

**Why "overscan alone is not enough"** (Codex): virtualization and native text selection are in tension. `overscan: 20` reduces, but doesn't eliminate, cross-page selection breakage. An explicit "copy visible range" button is a cheap escape hatch and a better UX than telling users to fiddle with their selection.

### 4.7 AI prompt copy — agent bridge (not in-product chat)

**New ruling for 1.0 per Dokploy comparison (GUIDE-00 LS-9 alternative)**:

- On any failed deploy's phase-end summary card (§5) include a `Copy as Claude prompt` button.
- Clicking it puts structured markdown on the clipboard: service name + error class + first N error lines + project context summary + a natural-language prompt (`"This deploy of {service} failed with {class}. Can you help diagnose?"`).
- Users paste into their MCP client (Claude Code / Cursor / Claude Desktop) which then uses the registered OpenLander MCP server to investigate deeply.

**Why not a built-in chat box**: Dokploy's pattern is "log text → LLM → text-only explanation." OpenLander's MCP agent has full environment context already — the prompt-copy path leverages that without building a redundant in-product AI surface. Aligns with OpenLander's agent-as-operator positioning.

---

## 5. Error Surfaces — Where Does Each Error Show?

Different error classes need different visual treatment. Cross-reference with `GUIDE-05-error-taxonomy.md` for the full matrix; key rules here:

- **Inline error line** (red background, red dot in margin) — for an error line that occurred mid-stream as part of the natural log (e.g., `error: failed to clone: Authentication failed`). Rendered inline, never popped to a toast.
- **Phase-end error banner** — when a phase terminates in failure, insert a separator card at the bottom of the stream with the phase name + duration + primary error reason. Example:
  ```
  ─── Build failed after 1m 40s ─────────────────────
    Failed phase: build (step 5/9 on service "web")
    Error: "/apps/web": not found
    → See docs/deploy/compose-context for fix
  ─────────────────────────────────────────────────
  ```
- **Deployment card error summary** (outside the stream, in the Deployments list) — condensed: status dot, error class name, duration, View button. This is read at-a-glance, not for debugging. Rich detail only when user opens the log.
- **Toast notifications** — **only** for connection state changes (Reconnecting / Reconnected / Connection lost permanently). Never for build errors. Never for failed deploys. Toasts are ephemeral; a failed deploy is a durable record.

---

## 6. Visual Examples (ASCII intent — Claude Design will produce actual pixels)

### 6.1 Streaming mode

```
┌ Logs · hotdeal-app · deploy #7 ───────────────────────  🟢 Live  [↓ Download] ┐
│                                                                               │
│  Cloning repository ─────────────────────────────────                         │
│    1  info  Cloning into '/etc/dokploy/compose/ht-hdapp-tlytjr/code'…         │
│    2  info  Resolving deltas: 100% (139/139), done.                           │
│    3  success   ✅ Clone complete                                             │
│                                                                               │
│  Pulling base images ────────────────────────────────                         │
│    4  info  Image postgres:16-alpine Pulling                                  │
│    5  info  Image redis:7-alpine Pulling                                      │
│   20  success   Image redis:7-alpine Pulled                                   │
│   21  success   Image postgres:16-alpine Pulled                               │
│                                                                               │
│  Building images ────────────────────────────────────                         │
│   22  info  #1 [internal] load local bake definitions               (→ #1)    │
│   23  info  #2 transferring dockerfile: 1.02kB done         (→ #2 DONE 0.0s)  │
│   ... virtualized (47 more lines) …                                           │
│  118  info  #24  99.49MB / 106.4MiB  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓░░░  93%                 │
│                                                                   (auto-scroll)│
└───────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Paused (user scrolled up)

```
┌ Logs · hotdeal-app · deploy #7 ───────────────────────  🟢 Live  [↓ Download] ┐
│                                                                               │
│   (user is reading line 47 about build step 3)                                │
│    47  info  #12 [web 5/9] COPY apps/web/ .                                   │
│    48  info  #12 CACHED                                                       │
│    …                                                                          │
│                                                                               │
│                                                                               │
│                                         ┌────────────────────────────────┐    │
│                                         │  ↓ 83 new lines — Jump to latest │   │
│                                         └────────────────────────────────┘    │
└───────────────────────────────────────────────────────────────────────────────┘
```

### 6.3 Failed deploy (terminal state)

```
┌ Logs · hotdeal-app · deploy #7 ─────────────────  🔴 Failed 1m 40s  [↓ Download] ┐
│                                                                                  │
│  Building images ────────────────────────────────                                │
│   ...                                                                            │
│  120  error  target web: failed to solve: "/apps/web": not found                 │
│                                                                                  │
│  ─── Build failed after 1m 40s ───────────────────                              │
│    Failed phase: build  (step 5/9 on service "web")                             │
│    Error class: BUILD_CONTEXT_MISMATCH                                          │
│    Likely fix: set `build.context: .` with explicit `dockerfile: Dockerfile.web` │
│    [📋 Copy error summary]  [🔁 Re-deploy (same commit)]  [📝 View compose]    │
│  ─────────────────────────────────────────────────                              │
│                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Anti-Patterns (do NOT do these — current OpenLander has some of them)

| Anti-pattern                                         | Why it's bad                                 | Correct behavior                                                  |
| ---------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| Auto-scroll pulls user back down when they scroll up | Unreadable when debugging                    | Release auto-scroll on any upward gesture until re-entered bottom |
| On reconnect, clear and restart from tail            | Lines lost silently, "where did step 12 go?" | Cursor-based resume with buffer of last 10k seq                   |
| Store every line in component state with `setState`  | Browser tab dies at 50k lines                | Virtualize rendering + slab-fetch for history                     |
| Show raw `[31m...` ANSI codes                        | Garbled text, users assume corruption        | Parse ANSI client- or server-side                                 |
| Error toasts that disappear after 5s                 | User misses the error or can't re-read       | Inline error in stream + phase-end banner                         |
| Close stream on tab switch, reopen fresh on return   | Lost context, page jumps                     | 120s grace period, resume by cursor                               |
| Emoji/spinner in every line                          | Visual noise                                 | Use emoji only in phase headers and final status pill             |
| Auto-expand wrapped lines                            | Vertical thrash on long Python tracebacks    | Soft-wrap but stable, one row per logical line                    |

---

## 8. Handoff Notes for Claude Design

**What we want from design**:

- Final palette values for the 5 semantic prefixes (use existing OpenLander theme tokens)
- Final spacing/typography for line numbers, prefix column, payload
- Phase header component (separator + title + optional duration + icon)
- "Jump to latest" floating pill — position, motion, accessible focus target
- Failure summary card (separator + content) inline in the stream
- Deploy history row (used outside the viewer, but related)

**What we do NOT want from design in v1.0**:

- Fancy waveform visualizations of deploy activity
- Per-service tabbed log switching within one viewer (keep one deploy = one stream)
- Filter UI / search within log (v1.1 — add after the primitives settle)
- Syntax-highlighted language-specific colors (ANSI color + semantic prefix is enough)

**Component inventory** (working names, design may rename):

- `<LogViewer>` — the container
- `<LogViewerHeader>` — title, status pill, Download button
- `<LogLine>` — line number + prefix + payload
- `<PhaseHeader>` — separator + title
- `<FailureSummary>` — inline card at the end of a failed stream
- `<JumpToLatestPill>` — floating affordance
- `<ReconnectionNotice>` — banner at top during RECONNECTING state

Reference frozen data: `.omc/analysis/dokploy-hotdeal/deploy-log-{1,2,3}.txt` — feed these into design mock-ups for realistic line density and failure shapes.

---

## 9. Acceptance (how we know this guide is good)

Check these against the finished implementation + design:

- [ ] The 9 phases render with a visible header change between them
- [ ] The 5 semantic prefixes are visually distinct at a glance
- [ ] A 50k-line deploy scrolls smoothly on a 3-year-old laptop
- [ ] Mid-stream reconnect renders `⚠ N lines skipped` if buffer was exhausted
- [ ] Mid-stream reconnect renders no warning if buffer was fine (user never notices)
- [ ] Scroll-up releases auto-scroll, scroll-down-to-bottom re-engages it
- [ ] Tab-switch and return within 2 min is seamless
- [ ] ANSI colors render correctly (test with a `pip install` or `npm run build` output)
- [ ] A failed deploy shows inline error line + phase-end summary + deployment card update — **three** consistent surfaces
- [ ] Select + Copy works across virtualized pages
- [ ] Download button delivers full server-side log, not the trimmed client buffer

If all 11 are ✓, ship.
