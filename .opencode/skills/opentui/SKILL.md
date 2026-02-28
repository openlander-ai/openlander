# OpenTUI Skill — OpenLander TUI Development Guide

## When to Load This Skill

Load when working on ANY file under `src/tui/`. This project uses `@opentui/solid` — a SolidJS reconciler for OpenTUI (Zig-native terminal UI). It is NOT React. It is NOT Ink. Common web/React patterns WILL break.

## Critical Rules (Memorize Before Writing Code)

### 1. JSX Intrinsic Elements

Only these elements exist: `<box>`, `<text>`, `<textarea>`, `<input>`, `<span>`

- `<box>` = `<div>` equivalent. Yoga flexbox layout. ALL layout props go here.
- `<text>` = text display. Style via `fg`, `bold`, `dim`, `underline`, `backgroundColor`.
- `<textarea>` = multiline input with `keyBindings`, `onSubmit`, `onContentChange`, `wrapMode`.
- `<input>` = single-line input with `value`, `onChange`, `onSubmit`, `focused`.
- `<span>` = inline text span with `style={{ fg, bold }}`.

**WRONG:** `<div>`, `<p>`, `<button>`, `className`, `style={{ color: 'red' }}`, `onClick`
**RIGHT:** `<box>`, `<text>`, `fg="#e06c75"`, `bold={true}`, `backgroundColor="#1e1e1e"`

### 2. Hooks — ONLY Three Available

```typescript
import { useKeyboard, useTerminalDimensions, render } from '@opentui/solid';
```

- `render()` — Mount app. Called ONCE in `src/tui/index.tsx`.
- `useKeyboard(handler)` — Register keyboard event handler. MUST wrap in try-catch.
- `useTerminalDimensions()` — Returns `Accessor<{ width, height }>`. MUST wrap in try-catch.

### 3. MANDATORY Try-Catch Pattern

```typescript
// useKeyboard — renderer may not be ready during initial Solid reactivity pass
try {
  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
    // handler code
  });
} catch {
  /* Renderer not ready during initial reactivity pass */
}

// useTerminalDimensions — same issue
let dims: ReturnType<typeof useTerminalDimensions>;
try {
  dims = useTerminalDimensions();
} catch {
  dims = (() => ({ width: 80, height: 24 })) as ReturnType<typeof useTerminalDimensions>;
}
```

**Exception:** Overlay components (HelpOverlay, ModelOverlay, etc.) that are only mounted AFTER the renderer is ready do NOT need try-catch. They use `useKeyboard` and `useTerminalDimensions` directly.

### 4. Colors — Hex Only

Use `theme.ts` for all colors. Always hex format (`#fab283`). CSS named colors have partial support — avoid them.

```typescript
import { theme } from '../theme.js';
// RIGHT: fg={theme.primary}  backgroundColor={theme.backgroundPanel}
// WRONG: fg="orange"  color="red"  style={{ color: '#fab283' }}
```

### 5. State Management — Module-Level Signals

State is NOT managed via React context or props drilling. It uses module-level SolidJS signals:

- `src/tui/state/focus.ts` — `focus()`, `toggleFocus()`, `focusChat()`, `focusStatus()`
- `src/tui/state/mode.ts` — `mode()`, `enterDeployMode()`, `enterDebugMode()`, `returnToMonitoring()`
- `src/tui/state/overlay.ts` — `overlayActive()`, `setOverlayActive()`

Import and call directly. No providers needed.

### 6. Keyboard Event Hierarchy

1. **App-level** (`App.tsx`): Global shortcuts (Tab, ?, q, Ctrl+C, Esc). Wrapped in try-catch.
2. **Component-level** (ChatPanel, DashboardPanel, ScrollableLog): Feature-specific keys. Check `overlayActive()` and `focus()` before handling.
3. **Overlay-level** (HelpOverlay, ModelOverlay, etc.): Call `evt.stopPropagation?.()` to prevent background handlers.

**Every `useKeyboard` in a non-overlay component MUST check:**

```typescript
useKeyboard((event) => {
  const evt = event as { name?: string; ctrl?: boolean };
  if (overlayActive() || !focus()) return; // ← MANDATORY guard
  // ... handle keys
});
```

### 7. Overlay Pattern

Overlays are rendered at **App level** with `position="absolute"`:

```tsx
<Show when={showOverlay()}>
  <box position="absolute" width={columns()} height={rows()} flexDirection="column">
    <MyOverlay onClose={() => setShowOverlay(false)} />
  </box>
</Show>
```

App syncs overlay state: `createEffect(() => { setOverlayActive(anyOverlayOpen()); });`

### 8. SplitBorder Pattern (Pipe Dividers)

```typescript
import { SplitBorder } from '../theme.js';

// Layout divider — 1px wide pipe between panels
<box width={1} border={['left']} customBorderChars={SplitBorder.customBorderChars} borderColor={theme.borderSubtle} />

// Message left border — spread on box
<box {...SplitBorder} borderColor={theme.secondary}>
  <box paddingLeft={2}>content</box>
</box>
```

### 9. Build Configuration

- `tsconfig.json`: `"jsxImportSource": "@opentui/solid"`
- `tsup.config.ts`: `esbuild-plugin-solid` with `generate: 'universal'`, `moduleName: '@opentui/solid'`
- Runtime: Bun. Both `@opentui/solid` and `@opentui/core` are external (loaded at runtime).
- Type declarations: `src/tui/opentui.d.ts` (custom — package doesn't ship `.d.ts`).

### 10. Import Conventions

```typescript
// SolidJS primitives
import { createSignal, createEffect, Show, For, Switch, Match, onCleanup } from 'solid-js';
import type { JSX, Accessor } from 'solid-js';

// OpenTUI hooks
import { useKeyboard, useTerminalDimensions } from '@opentui/solid';

// Project state (module-level signals)
import { focus, toggleFocus } from '../state/focus.js';
import { overlayActive } from '../state/overlay.js';
import { mode as tuiMode, enterDeployMode } from '../state/mode.js';

// Theme
import { theme, SplitBorder } from '../theme.js';

// NOTE: Always use .js extension in imports (ESM)
```

## Decision Tree — What Am I Building?

### New Component

1. Read `references/components.md` — find the closest existing component
2. Read `references/solid-patterns.md` — JSX elements, props, hooks
3. Read `references/state.md` — which signals to import
4. Read `references/layout.md` — if it involves layout, overlays, or responsive behavior
5. Read `references/gotchas.md` — **ALWAYS** read before writing code

### Modifying Existing Component

1. Read the component source file first
2. Read `references/gotchas.md` — check for pitfalls related to your change
3. Check `references/state.md` — if touching keyboard handlers or state

### New Overlay

1. Read `references/components.md` — section on overlay components
2. Follow the HelpOverlay pattern (simplest overlay reference)
3. **MUST** add `evt.stopPropagation?.()` in your keyboard handler
4. **MUST** add `<Show when={}>` wrapper in `App.tsx` with `position="absolute"` box
5. **MUST** add to `anyOverlayOpen()` check in `App.tsx`

### Layout Change

1. Read `references/layout.md` — responsive breakpoints, flexbox rules
2. Read `Layout.tsx` source — understand the split-panel structure
3. Test at both wide (≥120), medium (80-119), and narrow (<80) widths

## File Map

```
src/tui/
├── index.tsx          — Entry point, render() call
├── App.tsx            — Root component, global keyboard, overlay orchestration
├── opentui.d.ts       — Type declarations for @opentui/solid
├── theme.ts           — Color theme + SplitBorder pattern
├── state/
│   ├── focus.ts       — Panel focus signal (chat | status)
│   ├── mode.ts        — TUI mode signal (monitoring | deploying | debugging)
│   └── overlay.ts     — Overlay active state signal
├── components/
│   ├── Layout.tsx         — Split-panel layout, responsive breakpoints
│   ├── ChatPanel.tsx      — Chat with streaming, history, slash commands
│   ├── StatusPanel.tsx    — Right panel mode switcher
│   ├── DashboardPanel.tsx — System stats, projects, activity, MCP
│   ├── BuildPanel.tsx     — Deploy mode: pipeline + build logs
│   ├── LogViewer.tsx      — Debug mode: container log streaming
│   ├── ProjectInfo.tsx    — Debug mode: project metadata
│   ├── Prompt.tsx         — OpenCode-style input with pipe border
│   ├── StatusBar.tsx      — Bottom bar with mode-specific hints
│   ├── ChatMessage.tsx    — Message renderer (markdown, tools, errors)
│   ├── AgentDisplay.tsx   — Tool result displays (command, file edit, etc.)
│   ├── ScrollableLog.tsx  — Auto-scroll log viewer
│   ├── Spinner.tsx        — Animated dots spinner
│   ├── ProgressBar.tsx    — Visual progress bar
│   ├── SlashCommandPicker.tsx — Autocomplete dropdown for slash commands
│   ├── IMETextInput.tsx   — CJK text input wrapper
│   ├── HelpOverlay.tsx    — Keyboard shortcuts overlay
│   ├── ModelOverlay.tsx   — LLM model selector overlay
│   ├── GitOverlay.tsx     — Git provider connection overlay
│   ├── RepoOverlay.tsx    — Repository browser overlay
│   ├── TunnelOverlay.tsx  — Cloudflare Tunnel config overlay
│   └── EnvOverlay.tsx     — Environment variable management overlay
├── commands/          — Slash command registry
├── hooks/             — Custom hooks (useDaemon, etc.)
├── context/           — SolidJS context (exit handler)
├── onboarding/        — Setup wizard
└── dashboard-utils.ts — Utility functions for dashboard
```

## Reference Files

| File                           | When to Read                                             |
| ------------------------------ | -------------------------------------------------------- |
| `references/solid-patterns.md` | Writing ANY new JSX, hooks, or component lifecycle code  |
| `references/components.md`     | Understanding existing components, their props and roles |
| `references/layout.md`         | Layout changes, responsive behavior, overlays, borders   |
| `references/state.md`          | State management, keyboard handling, focus/mode/overlay  |
| `references/gotchas.md`        | **ALWAYS before writing code** — critical pitfalls       |
