# State Management, Keyboard Hierarchy & Focus

## Architecture: Module-Level Signals

OpenLander uses module-level SolidJS signals for global state — NOT React context, NOT stores, NOT providers. Each state module exports signals and transition functions that any component can import directly.

```
src/tui/state/
├── focus.ts    — Which panel has keyboard focus
├── mode.ts     — Which TUI operational mode is active
└── overlay.ts  — Whether any overlay is currently open
```

## focus.ts — Panel Focus

Controls which panel receives keyboard input.

```typescript
// State
type PanelFocus = 'chat' | 'status';
const [focus, setFocus] = createSignal<PanelFocus>('chat');

// Exports
focus(); // read current focus: 'chat' | 'status'
toggleFocus(); // switch between chat and status
focusChat(); // explicitly focus chat panel
focusStatus(); // explicitly focus status panel
```

**Usage in components:**

```typescript
import { focus, toggleFocus } from '../state/focus.js';

// In App.tsx global keyboard
if (evt.name === 'tab') {
  toggleFocus();
  return;
}

// In ChatPanel/DashboardPanel — guard keyboard handlers
useKeyboard((event) => {
  if (!focus()) return; // ← wrong, focus() returns 'chat'|'status'
  // Correct:
  if (overlayActive() || !props.focus) return; // use the focus prop passed by parent
});
```

**How focus flows:**

1. `App.tsx` reads `focus()` → maps to `'left'`/`'right'` for Layout
2. `App.tsx` passes `focus={focus() === 'chat' && !anyOverlayOpen()}` to ChatPanel
3. `App.tsx` passes `focus={focus() === 'status' && !anyOverlayOpen()}` to StatusPanel
4. Components check their `props.focus` boolean, NOT the global `focus()` signal directly

## mode.ts — TUI Operational Mode

Controls what the right panel displays and which keyboard shortcuts are active.

```typescript
// State
type TuiMode = 'monitoring' | 'deploying' | 'debugging';
const [mode, setMode] = createSignal<TuiMode>('monitoring');

// Deploy state
interface DeployingState {
  projectId: string;
  projectName: string;
}
const [deployingState, setDeployingState] = createSignal<DeployingState | null>(null);

// Debug state
interface DebuggingState {
  projectId: string;
  projectName: string;
}
const [debuggingState, setDebuggingState] = createSignal<DebuggingState | null>(null);

// Multi-build session tracking
const [buildSessions, setBuildSessions] = createSignal<DeployingState[]>([]);
const [selectedBuildIndex, setSelectedBuildIndex] = createSignal(0);
```

**Transition functions:**

```typescript
enterDeployMode(projectId, projectName); // → deploying mode + adds build session
enterDebugMode(projectId, projectName); // → debugging mode
returnToMonitoring(); // → monitoring mode + clears all state
scheduleDeployReturn((delaySec = 3)); // auto-return to monitoring after deploy
cancelDeployReturn(); // cancel pending auto-return
nextBuildSession() / prevBuildSession(); // navigate concurrent builds
```

**Mode effects on UI:**
| Mode | Right Panel | StatusBar Hints | Keyboard |
|---|---|---|---|
| monitoring | DashboardPanel (full) | Tab/Commands/Help/Exit | ↑↓ project nav, Enter=debug |
| deploying | DashboardPanel (compact) + BuildPanel | Cancel/Close | ←→ build switch |
| debugging | ProjectInfo + LogViewer | Back/Redeploy/Stop/Domain | r/s/d shortcuts |

## overlay.ts — Overlay State

Centralized signal indicating whether ANY overlay is open. Components check this to gate keyboard handlers.

```typescript
const [overlayActive, setOverlayActive] = createSignal(false);
```

**How it works:**

1. `App.tsx` defines `anyOverlayOpen()` combining all 6 overlay signals
2. `createEffect` syncs: `setOverlayActive(anyOverlayOpen())`
3. Non-overlay components import `overlayActive()` to skip keyboard handling

```typescript
// App.tsx
const anyOverlayOpen = () =>
  showHelp() || showModelSelector() || showGit() || showRepo() || showTunnel() || showEnv();

createEffect(() => {
  setOverlayActive(anyOverlayOpen());
});

// DashboardPanel.tsx, ChatPanel.tsx, ScrollableLog.tsx — import and check
import { overlayActive } from '../state/overlay.js';

useKeyboard((event) => {
  if (overlayActive() || !props.focus) return; // ← MANDATORY
});
```

## Keyboard Event Hierarchy

### Event Flow

```
Terminal keypress
  ↓
OpenTUI core captures raw input
  ↓
Dispatches to all useKeyboard handlers (innermost first)
  ↓
If stopPropagation() called → stops here
  ↓
Otherwise → continues to next handler
```

### Three Layers

#### Layer 1: App-Level Global Shortcuts (App.tsx)

Wrapped in try-catch. Handles:

- Setup mode gate: `if (appMode() === 'setup') return`
- Overlay escape: `if (anyOverlayOpen() && evt.name === 'escape') { closeAll(); return; }`
- Ctrl+C: Cancel active work → double-tap to quit
- Esc: Return from deploying/debugging to monitoring
- Tab: Toggle panel focus
- ?: Help overlay
- q: Quit (only when status panel focused)
- Deploy mode: ←→ to switch builds
- Debug mode: r/s/d shortcuts

```typescript
try {
  useKeyboard((event) => {
    const evt = event as { name?: string; ctrl?: boolean };
    if (appMode() === 'setup') return;

    // Overlay escape — checked first
    if (showHelp() || showModelSelector() || /* ... */) {
      if (evt.name === 'escape') { /* close all overlays */ }
      return;  // ← when overlay open, RETURN without handling other keys
    }

    // Global shortcuts follow...
  });
} catch { /* renderer not ready */ }
```

#### Layer 2: Component-Level Handlers

Each panel component has its own `useKeyboard`. MUST guard with:

```typescript
useKeyboard((event) => {
  const evt = event as { name?: string; ctrl?: boolean };
  if (overlayActive() || !props.focus) return; // ← MANDATORY GUARD
  // Handle component-specific keys
});
```

Examples:

- **ChatPanel**: Ctrl+L (clear), Ctrl+J (scroll bottom), PageUp/PageDown
- **DashboardPanel**: ↑↓/j/k (navigate), Enter (debug mode)
- **ScrollableLog**: ↑↓/j/k (scroll), f/End (auto-scroll), Home (top), PageUp/PageDown

#### Layer 3: Overlay Handlers

Overlays call `evt.stopPropagation?.()` to prevent ANY background handler from firing:

```typescript
useKeyboard((event) => {
  const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
  evt.stopPropagation?.(); // ← ALWAYS call this in overlays

  if (evt.name === 'escape') {
    props.onClose();
  }
  if (evt.name === 'up' || evt.name === 'k') {
    /* navigate */
  }
  if (evt.name === 'down' || evt.name === 'j') {
    /* navigate */
  }
  if (evt.name === 'enter') {
    /* select */
  }
});
```

### Adding a New Keyboard Handler — Checklist

1. Is this in an overlay? → Call `stopPropagation()` on EVERY event
2. Is this in a panel component? → Guard with `overlayActive() || !props.focus`
3. Is this a global shortcut? → Add to App.tsx, wrap in try-catch
4. Does it conflict with textarea input? → Check if chat panel is focused
5. Does it only apply in certain modes? → Check `tuiMode()` before handling

## Common Patterns

### Signal-Based Timer with Cleanup

```typescript
createEffect(() => {
  if (!client()) return;
  const c = client()!;

  const fetchData = async () => {
    /* ... */
  };
  void fetchData();

  const timer = setInterval(() => {
    void fetchData();
  }, 5000);
  onCleanup(() => {
    clearInterval(timer);
  });
});
```

### Async Stream with AbortController

```typescript
let abortController: AbortController | null = null;

createEffect(() => {
  if (!props.projectId || !props.client) return;

  abortController = new AbortController();

  void (async () => {
    try {
      for await (const event of client.streamData(id, abortController.signal)) {
        processEvent(event);
      }
    } catch {
      // Stream ended or aborted — normal
    }
  })();
});

onCleanup(() => {
  abortController?.abort();
});
```

### Overlay Show/Hide State in App.tsx

When adding a new overlay:

```typescript
// 1. Add signal
const [showMyOverlay, setShowMyOverlay] = createSignal(false);

// 2. Add to anyOverlayOpen
const anyOverlayOpen = () =>
  showHelp() || showModelSelector() || /* existing */ || showMyOverlay();

// 3. Add escape handling in global keyboard
if (showMyOverlay()) {
  if (evt.name === 'escape') { setShowMyOverlay(false); }
  return;
}

// 4. Add <Show> wrapper in render
<Show when={showMyOverlay()}>
  <box position="absolute" width={columns()} height={rows()} flexDirection="column">
    <MyOverlay onClose={() => setShowMyOverlay(false)} />
  </box>
</Show>
```

### Props Pattern for Focus Passthrough

```typescript
// App.tsx
<ChatPanel
  focus={focus() === 'chat' && !anyOverlayOpen()}
  // ...
/>

// ChatPanel.tsx
export function ChatPanel(props: ChatPanelProps) {
  const focus = () => props.focus;

  // Use focus() in keyboard guard
  useKeyboard((event) => {
    if (overlayActive() || !focus()) return;
  });

  // Pass to child
  <Prompt focused={focus()} />
}
```
