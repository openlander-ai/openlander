# Critical Gotchas for AI Agents

These are the top mistakes AI agents make when modifying OpenLander's TUI. Read ALL of them before writing code.

## 1. NOT React — JSX Intrinsics Are Different

**Mistake:** Using React/HTML/Ink elements or attributes.

```tsx
// WRONG ❌
<div className="container">
  <p style={{ color: 'red', fontSize: '14px' }}>Error</p>
  <button onClick={handler}>Click</button>
</div>

// RIGHT ✅
<box flexDirection="column">
  <text fg="#e06c75" bold={true}>Error</text>
</box>
```

**Available elements:** `<box>`, `<text>`, `<textarea>`, `<input>`, `<span>` — nothing else.

**NOT available:** `<div>`, `<p>`, `<h1>`, `<button>`, `<ul>`, `<li>`, `<img>`, `<a>`, `className`, `style` (except on `<span>`), `onClick` (limited), `fontSize`, `fontFamily`, `lineHeight`, `cursor`, `zIndex`, `opacity`.

## 2. useKeyboard Must Be Wrapped in Try-Catch (App Level)

**Mistake:** Using `useKeyboard` without try-catch in the root component.

```tsx
// WRONG ❌ — App.tsx will crash during initial Solid reactivity pass
export function App() {
  useKeyboard((event) => {
    /* ... */
  });
  return <Layout />;
}

// RIGHT ✅
export function App() {
  try {
    useKeyboard((event) => {
      /* ... */
    });
  } catch {
    /* Renderer not ready during initial reactivity pass */
  }
  return <Layout />;
}
```

**Why:** During SolidJS's initial reactivity setup, the OpenTUI renderer may not be mounted yet. `useKeyboard` tries to access the renderer and throws.

**Exception:** Overlay components (HelpOverlay, ModelOverlay, etc.) are mounted AFTER the renderer is ready via `<Show when={}>`, so they do NOT need try-catch.

## 3. useTerminalDimensions Also Needs Try-Catch + Fallback (App Level)

**Mistake:** Using `useTerminalDimensions` without error handling at the root level.

```tsx
// WRONG ❌
const dims = useTerminalDimensions();

// RIGHT ✅
let dims: ReturnType<typeof useTerminalDimensions>;
try {
  dims = useTerminalDimensions();
} catch {
  dims = (() => ({ width: 80, height: 24 })) as ReturnType<typeof useTerminalDimensions>;
}
const columns = () => dims().width;
const rows = () => dims().height;
```

**Same exception:** Overlay components can call `useTerminalDimensions()` directly.

## 4. Overlays MUST stopPropagation

**Mistake:** Creating an overlay keyboard handler without `stopPropagation()`.

```tsx
// WRONG ❌ — background components will ALSO receive these key events
useKeyboard((event) => {
  if (event.name === 'escape') props.onClose();
  if (event.name === 'up') moveSelection(-1);
});

// RIGHT ✅
useKeyboard((event) => {
  const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
  evt.stopPropagation?.(); // ← MUST be called on EVERY event

  if (evt.name === 'escape') props.onClose();
  if (evt.name === 'up' || evt.name === 'k') moveSelection(-1);
});
```

**Why:** Without `stopPropagation`, pressing `q` in an overlay will quit the app (App.tsx handles `q`). Pressing `Tab` will switch panels. Arrows will navigate the project list behind the overlay.

## 5. Panel Keyboard Handlers MUST Guard

**Mistake:** Handling keyboard events without checking overlay state and focus.

```tsx
// WRONG ❌ — will process keys even when overlay is open or panel is unfocused
useKeyboard((event) => {
  if (event.name === 'up') navigate(-1);
});

// RIGHT ✅
useKeyboard((event) => {
  const evt = event as { name?: string; ctrl?: boolean };
  if (overlayActive() || !props.focus) return; // ← MANDATORY
  if (evt.name === 'up' || evt.name === 'k') navigate(-1);
});
```

**Why:** Without this guard, ALL registered `useKeyboard` handlers fire on every keypress. The DashboardPanel will scroll its project list while the user is typing in chat. The ChatPanel will try to handle keys while an overlay is open.

## 6. Colors Must Be Hex — Use theme.ts

**Mistake:** Using CSS named colors or inline color strings.

```tsx
// WRONG ❌
<text fg="red">Error</text>
<text fg="green">Success</text>
<box backgroundColor="darkgray">

// RIGHT ✅
import { theme } from '../theme.js';
<text fg={theme.error}>Error</text>
<text fg={theme.success}>Success</text>
<box backgroundColor={theme.backgroundPanel}>
```

**Why:** CSS named colors have inconsistent support in OpenTUI. Some work, some don't. Hex colors are reliable. The `theme.ts` file provides a complete, consistent color palette.

**Color reference:**

```typescript
theme.primary; // '#fab283' — orange, assistant accent
theme.secondary; // '#5c9cf5' — blue, user accent
theme.accent; // '#9d7cd8' — purple
theme.text; // '#eeeeee' — primary text
theme.textMuted; // '#808080' — de-emphasized
theme.textDim; // '#555555' — very subtle
theme.background; // '#0a0a0a' — root background
theme.backgroundPanel; // '#141414' — panel backgrounds
theme.backgroundElement; // '#1e1e1e' — interactive elements
theme.backgroundMenu; // '#1e1e1e' — overlay backgrounds
theme.border; // '#484848' — default borders
theme.borderActive; // '#606060' — active borders
theme.borderSubtle; // '#3c3c3c' — subtle separators
theme.success; // '#7fd88f' — green
theme.warning; // '#f5a742' — orange
theme.error; // '#e06c75' — red
theme.info; // '#56b6c2' — cyan
```

## 7. Textarea Has Unique Props — Not Web Standard

**Mistake:** Using web-standard textarea attributes.

```tsx
// WRONG ❌
<textarea
  rows={3}
  cols={50}
  value={text}
  onChange={(e) => setText(e.target.value)}
  onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
/>

// RIGHT ✅
<textarea
  minHeight={1}
  maxHeight={6}
  focused={props.focused}
  textColor={theme.text}
  focusedTextColor={theme.text}
  backgroundColor={theme.backgroundElement}
  focusedBackgroundColor={theme.backgroundElement}
  cursorColor={theme.text}
  wrapMode="word"
  keyBindings={[
    { name: 'enter', action: 'submit' },
    { name: 'enter', shift: true, action: 'newline' },
  ]}
  onSubmit={() => handleSubmit()}
  onContentChange={() => { /* read from ref */ }}
  onKeyDown={(e) => handleKeyDown(e)}
  ref={(r) => { textareaRef = r; }}
/>
```

**Key differences:**

- No `value` prop — read content via `ref.plainText`
- No `onChange` — use `onContentChange` (no event parameter, read from ref)
- `keyBindings` array defines which keys trigger which actions
- `focused` boolean (not `autoFocus`)
- `textColor`/`focusedTextColor` (not `color`/`style`)

## 8. SolidJS Props — Never Destructure

**Mistake:** Destructuring props (React habit).

```tsx
// WRONG ❌ — loses reactivity, values won't update
export function MyComponent({ title, onClose, focus }: Props) {
  return <text>{title}</text>; // static, never updates
}

// RIGHT ✅
export function MyComponent(props: Props) {
  return <text>{props.title}</text>; // reactive, updates on change
}

// ALSO RIGHT ✅ — wrap in accessor for derived values
export function MyComponent(props: Props) {
  const title = () => props.title;
  const isActive = () => props.focus && !props.disabled;
  return <text>{title()}</text>;
}
```

**Why:** SolidJS tracks reactivity through property access on the `props` object. Destructuring breaks the proxy and the values become static snapshots.

## 9. New Overlays — Use OverlayContainer + App-Level Rendering

**Mistake:** Building overlay boilerplate from scratch or rendering inside a panel.

```tsx
// WRONG ❌ — manual boilerplate + rendered inside panel
export function MyOverlay(props: Props) {
  const dims = useTerminalDimensions();
  return (
    <box width={dims().width} height={dims().height} justifyContent="center" alignItems="center">
      <box border="round" borderColor={theme.borderActive} paddingX={2} paddingY={1}>
        <text>Title</text>
        {/* content */}
        <text>[Esc] Close</text>
      </box>
    </box>
  );
}

// RIGHT ✅ — use OverlayContainer for consistent layout
import { OverlayContainer } from './OverlayContainer.js';

export function MyOverlay(props: Props) {
  useKeyboard((event) => {
    const evt = event as { name?: string; stopPropagation?: () => void };
    if (evt.name === 'escape') props.onClose();
    evt.stopPropagation?.();
  });

  return (
    <OverlayContainer title="My Overlay" footer="[Esc] Close">
      {/* content only — no backdrop/border/header/footer boilerplate */}
      <box flexDirection="column">
        <text fg={theme.text}>Content here</text>
      </box>
    </OverlayContainer>
  );
}
```

**OverlayContainer handles:** Full-screen backdrop, centered dialog, round border, borderColor, paddingX/Y, backgroundMenu, title header, optional footer.

**You handle:** `useKeyboard` with `stopPropagation`, state signals, content JSX.

**For dynamic title/footer** (e.g. changes per state):

```tsx
const title = () => state() === 'a' ? 'Title A' : 'Title B';
const footer = () => state() === 'editing' ? '[Enter Save]' : '[↑↓ Navigate]';
<OverlayContainer title={title()} footer={footer()}>
```

**Checklist for adding a new overlay:**

1. Create overlay component using `<OverlayContainer>` wrapper
2. Add `useKeyboard` handler with `evt.stopPropagation?.()` on EVERY event
3. In App.tsx: add `const [showMyOverlay, setShowMyOverlay] = createSignal(false)`
4. In App.tsx: add to `anyOverlayOpen()` check
5. In App.tsx: add `<Show when={}>` wrapper with `position="absolute"` box
6. Trigger via `onModal` callback or direct signal setter

## 10. Import Extensions — Always .js

**Mistake:** Omitting file extensions in imports.

```typescript
// WRONG ❌
import { theme } from '../theme';
import { focus } from '../state/focus';

// RIGHT ✅
import { theme } from '../theme.js';
import { focus } from '../state/focus.js';
```

**Why:** This project uses ESM with TypeScript. The `.js` extension is required because TypeScript resolves `.js` imports to `.ts` files at compile time, and the output is ESM which requires explicit extensions.

## Bonus: Common Patterns That Look Wrong But Are Correct

### Event Type Casting

```typescript
// This looks wrong but is the established pattern in this codebase
const evt = event as { name?: string; ctrl?: boolean; stopPropagation?: () => void };
```

The `useKeyboard` callback receives a runtime type that's more permissive than the `.d.ts` declaration. The cast ensures safe access to commonly-used properties.

### `void` Before Async IIFE

```typescript
// This is intentional — explicitly marks the promise as unhandled
void (async () => {
  // ... async work
})();
```

The `void` operator explicitly tells the linter/compiler that we intentionally don't await this promise.

### Module-Level Signals (Not Inside Components)

```typescript
// focus.ts — this is at MODULE level, NOT inside a component
const [focus, setFocus] = createSignal<PanelFocus>('chat');
```

This is intentional. Module-level signals are shared across all components that import them. This is the SolidJS equivalent of a global store.

## 11. Mouse Events — Use onMouseDown, NOT onClick

**Mistake:** Using `onClick` for mouse interaction.

```tsx
// WRONG ❌ — onClick is NOT a synthesized event in OpenTUI
<box onClick={() => handleSelect()}>
  <text>Click me</text>
</box>

// RIGHT ✅ — use onMouseDown with button check
<box
  onMouseDown={(e: unknown) => {
    const me = e as { button?: number; stopPropagation?: () => void };
    if (me.button === 0) { // Left click only
      me.stopPropagation?.();
      handleSelect();
    }
  }}
>
  <text>Click me</text>
</box>
```

**Why:** OpenTUI does NOT synthesize `onClick`. It provides raw mouse events: `onMouseDown`, `onMouseUp`, `onMouseMove`, `onMouseOver`, `onMouseOut`, `onMouseScroll`, `onMouseDrag`, `onMouseDragEnd`, `onMouseDrop`.

**MouseEvent object:**

```typescript
interface MouseEvent {
  type: string; // 'down', 'up', 'move', 'scroll', etc.
  button: number; // 0=left, 1=middle, 2=right
  x: number; // terminal column
  y: number; // terminal row
  modifiers: { shift: boolean; alt: boolean; ctrl: boolean };
  stopPropagation(): void;
}
```

**Note:** `<text>` elements in AgentDisplay.tsx use `onClick` — this works because OpenTUI's `<text>` has special handling. For `<box>` elements, always use `onMouseDown`.

## 12. Textarea Submit Clears Content Before onSubmit

**Mistake:** Reading `inputValue()` in `onSubmit` handler after textarea's submit keyBinding fires.

```tsx
// WRONG ❌ — text may already be '' by the time handleSubmit runs
const handleSubmit = () => {
  const text = inputValue(); // '' — textarea already cleared!
  if (!text.trim()) return; // exits early, command lost
};

// RIGHT ✅ — capture text in onKeyDown before textarea processes it
let pendingSubmitText: string | null = null;

const handleKeyDown = (event: unknown) => {
  const evt = event as { name?: string };
  if (evt.name === 'enter' || evt.name === 'return') {
    pendingSubmitText = inputValue(); // capture before clear
  }
};

const handleSubmit = () => {
  const text = pendingSubmitText ?? inputValue();
  pendingSubmitText = null;
  if (!text.trim()) return;
  // ... process text
};
```

**Why:** OpenTUI's `<textarea>` with `keyBindings: [{ name: 'enter', action: 'submit' }]` may clear its internal content as part of the submit action. `onContentChange('')` fires before `onSubmit`, resetting any signal that tracks the input value.
