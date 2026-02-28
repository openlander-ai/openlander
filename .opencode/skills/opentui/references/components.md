# OpenLander Component Catalog — 22 Components

## Architecture Overview

```
App.tsx (root)
├── Onboarding/          (setup mode)
└── Layout.tsx           (dashboard mode)
    ├── ChatPanel.tsx    (left panel)
    │   ├── ChatMessage.tsx → AgentDisplay.tsx
    │   ├── Prompt.tsx
    │   ├── SlashCommandPicker.tsx
    │   └── Spinner.tsx
    ├── StatusPanel.tsx  (right panel — mode switcher)
    │   ├── DashboardPanel.tsx  (monitoring mode)
    │   │   ├── SystemSection, ProjectsSection, ActivitySection, McpClientsSection
    │   │   ├── ProgressBar.tsx
    │   │   └── Spinner.tsx
    │   ├── BuildPanel.tsx      (deploying mode)
    │   │   └── ScrollableLog.tsx
    │   ├── ProjectInfo.tsx     (debugging mode)
    │   └── LogViewer.tsx       (debugging mode)
    │       └── ScrollableLog.tsx
    └── StatusBar.tsx    (footer)

Overlays (rendered at App level, position="absolute"):
├── OverlayContainer.tsx  (shared wrapper — title, footer, backdrop)
├── HelpOverlay.tsx
├── ModelOverlay.tsx
├── GitOverlay.tsx
├── RepoOverlay.tsx
├── TunnelOverlay.tsx
└── EnvOverlay.tsx
```

## Core Components

### App.tsx (668 lines)

**Role:** Root component. Manages app mode (setup/dashboard), all overlay state, global keyboard shortcuts, deploy workflow, daemon connection.

**Key patterns:**

- `useTerminalDimensions()` wrapped in try-catch with dummy fallback
- `useKeyboard()` wrapped in try-catch for global shortcuts
- Overlays rendered at App level with `<Show when={}>` + `position="absolute"` boxes
- `anyOverlayOpen()` derived signal gates panel keyboard handlers
- `createEffect` syncs `setOverlayActive(anyOverlayOpen())`
- Overlay state: 6 separate `createSignal<boolean>` for each overlay

**Props:** `{ ctx: AppContext }`

### Layout.tsx (90 lines)

**Role:** Split-panel layout with responsive breakpoints.

**Breakpoints:**

- `≥120 columns` → 60:40 split
- `80-119 columns` → 65:35 split
- `<80 columns` → single panel (shows active panel only)

**Props:**

```typescript
interface LayoutProps {
  left: JSX.Element;
  right: JSX.Element;
  statusBar: JSX.Element;
  activePanel?: 'left' | 'right';
  columns: number;
  rows: number;
}
```

**Key patterns:**

- SplitBorder pipe divider between panels (1px wide)
- `<Show when={isWideMode()} fallback={singlePanel}>` for responsive switching
- Content area has `paddingLeft={1} paddingRight={1}` for edge spacing
- `contentHeight = rows() - 1` reserves 1 row for status bar

### StatusBar.tsx (147 lines)

**Role:** Bottom footer bar. Mode-aware keybind hints + status indicators.

**Mode-specific content:**

- Monitoring: `Tab Panel` `/ Commands` `? Help` `^C Exit` + project count + CPU
- Deploying: `^C Cancel` `Enter Close` + build name + CPU
- Debugging: `Esc Back` `r Redeploy` `s Stop` `d Domain` + project name + CPU

**Key patterns:**

- Uses `<Switch><Match>` for mode-based rendering
- `KeyHint` helper component: `<text backgroundColor={bg}> key </text><text fg={muted}> label</text>`
- Single mode shows panel indicator: `Chat │ Status` with active highlighted

## Panel Components

### ChatPanel.tsx (805 lines)

**Role:** Left panel. Chat with LLM streaming, message history, slash commands.

**Features:**

- Message list with smart auto-scroll
- Prompt with textarea (1-6 lines)
- Chat history navigation (↑↓)
- Slash command autocomplete (`/` trigger)
- Context compaction (`/compact`)
- External message injection (deploy progress)

**Props:**

```typescript
interface ChatPanelProps {
  client: OpenLanderClient | null;
  height: number;
  focus: boolean;
  onModal?: (modal: string) => void;
  externalMessages?: DisplayMessage[];
}
```

**Key patterns:**

- `useKeyboard` checks `overlayActive()` and `focus()` before handling
- Ctrl+L clears messages, Ctrl+J jumps to bottom, PageUp/PageDown scrolls
- `handlePromptKeyDown` intercepts keys before textarea processes them
- Two render modes: empty state (centered logo + prompt) and active state (messages + bottom prompt)

### StatusPanel.tsx (79 lines)

**Role:** Right panel mode switcher. Routes to the correct sub-panel based on TUI mode.

**Mode routing:**

- `monitoring` → `<DashboardPanel />` (full)
- `deploying` → `<DashboardPanel compact />` (40%) + `<BuildPanel />` (60%)
- `debugging` → `<ProjectInfo />` (35%) + `<LogViewer />` (65%)

### DashboardPanel.tsx (430 lines)

**Role:** System monitoring dashboard. Shows system stats, projects, activity, MCP.

**Sub-components (exported):**

- `SectionHeader` — "▸ Title" format
- `SystemSection` — CPU/MEM/DSK bars + Docker count + uptime
- `ProjectsSection` — Project list with status icons, selection, memory usage
- `ActivitySection` — Recent 5 events with timestamps
- `McpClientsSection` — MCP server status

**Key patterns:**

- Polls every 5 seconds via `setInterval` + `onCleanup`
- Deduplicates updates via `displayKey` comparison (avoids unnecessary rerenders)
- `useKeyboard` for ↑↓/j/k navigation + Enter for debug mode
- Calls `props.onStatsUpdate` to bubble CPU/project data to StatusBar
- `compact` prop hides Activity + MCP sections (used in deploy mode)

### BuildPanel.tsx (297 lines)

**Role:** Deploy mode build progress. Pipeline visualization + log streaming.

**Features:**

- Pipeline stages: `Clone ✅ → Build ◐ → Run ○ → Expose ○`
- Real-time log streaming via IPC `streamBuildProgress()`
- Elapsed time counter
- Multi-build session indicator (`1/3 ←→`)

**Key patterns:**

- Infers pipeline stage from log message content (keyword matching)
- Uses `ScrollableLog` for auto-scroll log viewer
- `AbortController` for stream cleanup on unmount

### LogViewer.tsx (94 lines)

**Role:** Debug mode container log streaming. Wraps `ScrollableLog`.

**Key patterns:**

- Streams via IPC `streamLogs()`
- Formats timestamps as HH:MM:SS
- stderr lines get `theme.error` color

### ProjectInfo.tsx (173 lines)

**Role:** Debug mode project metadata display.

**Shows:** Status, port, URL, repo, CPU%, memory usage.

**Key patterns:**

- Polls every 3 seconds for live stats
- `PROJECT_STATUS_ICON` and `PROJECT_STATUS_COLOR` from dashboard-utils

## Input Components

### Prompt.tsx (163 lines)

**Role:** OpenCode-style chat prompt with pipe border decoration.

**Visual structure:**

```
┃  [multiline textarea]
┃  Agent  model  provider
╹▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀
```

**Props:**

```typescript
interface PromptProps {
  visible?: boolean;
  focused?: boolean;
  placeholder?: string;
  agentName?: string;
  modelName?: string;
  providerName?: string;
  isStreaming?: boolean;
  onSubmit?: () => void;
  onContentChange?: (text: string) => void;
  onKeyDown?: (event: unknown) => void;
  textareaRef?: (ref: unknown) => void;
  cursorColor?: string;
}
```

**Key patterns:**

- Custom border chars: `vertical: '┃'`, `bottomLeft: '╹'`
- `EmptyBorder` base object spread with overrides
- textarea `keyBindings`: Enter=submit, Shift+Enter=newline
- Bottom decoration: `╹` left cap + `▀` fill line

### SlashCommandPicker.tsx (119 lines)

**Role:** Autocomplete dropdown for slash commands. Renders above the prompt.

**Key patterns:**

- Left pipe border (`┃`) matching prompt style
- Highlighted selection row with `backgroundColor={theme.primary}`
- `filterCommands(prefix)` from commands/registry
- Exported helpers: `getMatchCount()`, `getMatchAt()`

### IMETextInput.tsx (33 lines)

**Role:** CJK (Chinese/Japanese/Korean) text input wrapper.

**Key patterns:**

- Wraps `<input>` with controlled and uncontrolled variants
- `IMETextInput` (controlled) + `UncontrolledIMETextInput` (with internal signal)

## Display Components

### ChatMessage.tsx (380 lines)

**Role:** Renders a single chat message. Handles multiple display types.

**DisplayMessage types:**

- `text` — Markdown-rendered assistant/system messages
- `error` — Red pipe border error messages
- `tool_start` — Spinner + tool name
- `tool_result` — Success/error icon + tool name + duration
- `command` → delegates to `CommandDisplay`
- `file_edit` → delegates to `FileEditDisplay`
- `thinking` → delegates to `ThinkingDisplay`
- `todo` → delegates to `TodoListDisplay`
- `build_result` → delegates to `BuildResultDisplay`
- `orchestration` → delegates to `OrchestrationDisplay`
- `progress` — ProgressBar display
- `url` — Underlined link
- `warning` — Yellow triangle warning

**Key patterns:**

- User messages get blue (`theme.secondary`) pipe border + background panel
- Assistant text messages are parsed as Markdown (headings, code blocks, lists, bold, inline code)
- `SplitBorder` spread for left pipe borders on various message types

### AgentDisplay.tsx (364 lines)

**Role:** Specialized tool result renderers for the chat.

**Components:**

1. `ThinkingDisplay` — Spinner + dim label with subtle pipe border
2. `CommandDisplay` — `$ Bash` header + command + collapsible output (max 10 lines)
3. `FileEditDisplay` — File path + collapsible diff with color (+ green, - red)
4. `TodoListDisplay` — Checklist with ▣/spinner/○ icons
5. `BuildResultDisplay` — Success/fail status + collapsible output
6. `OrchestrationDisplay` — Numbered step list with pipe border

**Common pattern:** All use `SplitBorder` spread + collapsible sections with `createSignal(false)` toggle.

### ScrollableLog.tsx (178 lines)

**Role:** Reusable auto-scrolling log viewer.

**Features:**

- Auto-scroll mode (follows new lines)
- Manual mode (↑↓/j/k pauses auto-scroll)
- Resume: `f` or `End` key
- Status indicator: `[AUTO-SCROLL]` or `[PAUSED — press f to follow]`
- Line position: `1-20 of 150 lines`

**Props:**

```typescript
interface ScrollableLogProps {
  lines: LogLine[];
  height: number;
  focus: boolean;
  title?: string;
  statusText?: string;
}
```

### Spinner.tsx (23 lines)

**Role:** Animated braille dots spinner (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`).

**Usage:** `<Spinner color={theme.textMuted} />`

**Key patterns:** `setInterval` at 80ms + `onCleanup` clears interval. Uses `<span>`.

### ProgressBar.tsx (60 lines)

**Role:** Visual progress bar (`████████████░░░░░░ 67%`).

**Props:** `percent`, `width?` (default 20), `label?`, `color?`

## Overlay Components

All 6 overlays use the shared `OverlayContainer` wrapper. Each overlay only defines:

1. `useKeyboard()` handler with `evt.stopPropagation?.()`
2. State signals and business logic
3. Content JSX (passed as `children` to OverlayContainer)

### OverlayContainer.tsx (65 lines)

**Role:** Shared wrapper for all overlays. Renders full-screen backdrop, centered bordered dialog, title header, and optional footer.

**Props:**

```typescript
interface OverlayContainerProps {
  title: string; // Reactive — supports dynamic titles via SolidJS props
  width?: number; // Fixed content width (default: 60)
  responsive?: boolean; // Use min(width, terminal_cols - 4) (default: false)
  footer?: string; // Reactive — empty string or undefined = no footer
  children: JSX.Element;
}
```

**Key patterns:**

- Wraps `useTerminalDimensions()` internally — children only need their own if they compute `contentHeight`
- `paddingX={2} paddingY={1}` on inner dialog, `border="round"`, `borderColor={theme.borderActive}`
- `backgroundColor={theme.backgroundMenu}` for dialog, `theme.background` for backdrop
- Footer renders only when `props.footer` is truthy (empty string = hidden)

**Usage:**

```tsx
// Simple (fixed title/footer)
<OverlayContainer title="Help" footer="[Esc] Close">
  <box>...content...</box>
</OverlayContainer>;

// Complex (dynamic title/footer via reactive signals)
const title = () => (view() === 'a' ? 'View A' : 'View B');
const footer = () => (state() === 'editing' ? '[Enter Save]' : '[↑↓ Navigate]');
<OverlayContainer title={title()} width={70} responsive={true} footer={footer()}>
  <box>...content...</box>
</OverlayContainer>;
```

### HelpOverlay.tsx (59 lines)

**Role:** Keyboard shortcuts reference. Simplest overlay — use as template for new overlays.

### ModelOverlay.tsx (165 lines)

**Role:** LLM model/provider selector. Grouped list with provider headers.

**Key patterns:**

- `createMemo` for grouped model list + flat render items
- Current model indicator (●)
- Clean text provider labels (no icons)

### GitOverlay.tsx (201 lines)

**Role:** GitHub token connection (GitHub-only).

**Key patterns:**

- State machine: `connected-status → enter-token → validating → result`
- Dynamic footer via `footerText()` reactive function
- `pendingSubmitText` pattern for textarea submit timing (see gotcha #12)
- `onDisconnect` callback to App.tsx

### RepoOverlay.tsx (132 lines)

**Role:** Repository browser for deployment.

**Key patterns:**

- Scrolling window with `visibleRange` + `createMemo`
- Private/public icons (`●`/`○`)
- Dynamic footer based on `repos.length > 0`
- `contentWidth = 70` kept locally for truncation calculations

### TunnelOverlay.tsx (168 lines)

**Role:** Cloudflare Tunnel public exposure toggle.

**Key patterns:**

- `width={70} responsive={true}` — OverlayContainer's responsive mode
- Still imports `useTerminalDimensions` for `contentHeight` calculation
- `●`/`○` icons for public/internal (no emoji)

### EnvOverlay.tsx (451 lines)

**Role:** Environment variable CRUD management. Most complex overlay.

**Key patterns:**

- Dynamic `title={overlayTitle()}` — changes between project list and env detail
- Dynamic `footer={footerText()}` — changes per view and editor state
- Two views: `projects` list → `envvars` detail (Esc goes back)
- Editor state machine: `viewing → adding | editing` (Esc cancels)
- Keys: `a` add (KEY=VALUE format), `e`/Enter edit, `d` delete, `v` toggle values
- Sensitive key detection + value masking
- `pendingSubmitText` pattern for textarea submit timing (see gotcha #12)
- `client.setProjectEnv(id, fullRecord)` replaces ALL vars (not incremental)
