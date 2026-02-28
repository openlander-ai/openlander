# @opentui/solid Patterns — OpenLander Style

## JSX Intrinsic Elements

OpenTUI provides 5 JSX intrinsic elements. These are terminal-native — NOT HTML/DOM.

### `<box>` — Layout Container

The primary layout element. Uses Yoga (WASM) flexbox engine.

```tsx
<box
  // Layout
  flexDirection="column"        // "row" | "column" (default: "column")
  flexGrow={1}                  // number
  flexShrink={0}                // number
  flexWrap="wrap"               // "wrap" | "nowrap"
  justifyContent="center"       // "flex-start" | "flex-end" | "center" | "space-between" | "space-around"
  alignItems="center"           // "flex-start" | "flex-end" | "center" | "stretch"
  overflow="hidden"             // "hidden" | "visible"
  gap={1}                       // number (gap between children)

  // Sizing
  width={60}                    // number | "100%" | string
  height={24}                   // number
  minHeight={1}                 // number
  maxHeight={6}                 // number
  maxWidth={75}                 // number

  // Spacing
  padding={1}                   // number (all sides)
  paddingX={2}                  // number (left + right)
  paddingY={1}                  // number (top + bottom)
  paddingLeft={2}               // number
  paddingRight={1}              // number
  paddingTop={1}                // number
  paddingBottom={2}             // number
  margin={1}                    // number (all sides)
  marginTop={1}                 // number
  marginBottom={1}              // number
  marginLeft={1}                // number

  // Position
  position="absolute"           // "absolute" | undefined (for overlays)

  // Visual
  backgroundColor="#0a0a0a"     // hex color string
  border="round"                // "round" | "single" | "double" | border side array
  border={['left']}             // partial border — array of sides
  borderColor="#484848"          // hex color string
  customBorderChars={{...}}     // custom character map for borders

  // Visibility
  visible={true}                // boolean
/>
```

### `<text>` — Text Display

Renders text content. Style props are terminal-native.

```tsx
<text
  fg="#eeeeee" // foreground color (hex)
  bold={true} // boolean
  dim={true} // boolean — reduced brightness
  underline={true} // boolean
  backgroundColor="#1e1e1e" // background color (hex)
  paddingLeft={2} // text elements support padding too
  wrapMode="word" // "word" | "none" — text wrapping behavior
  flexShrink={0} // layout props work on text too
>
  Hello world
</text>
```

**NOT available:** `color`, `className`, `style`, `onClick` (except on agent display components), `fontSize`, `fontFamily`, `lineHeight`

### `<textarea>` — Multiline Input

Used for the chat prompt. Has unique props not found in web.

```tsx
<textarea
  // Content
  placeholder="Ask anything..."
  textColor="#eeeeee" // text color
  focusedTextColor="#eeeeee" // text color when focused
  // Size
  minHeight={1} // minimum rows
  maxHeight={6} // maximum rows (grows automatically)
  width={50} // character width
  // Focus
  focused={true} // boolean — receives keyboard input
  // Key bindings — UNIQUE to OpenTUI textarea
  keyBindings={[
    { name: 'enter', action: 'submit' },
    { name: 'enter', shift: true, action: 'newline' },
  ]}
  // Events
  onSubmit={() => {}} // fired when 'submit' action triggered
  onContentChange={() => {}} // fired on any content change
  onKeyDown={(e) => {}} // fired before textarea processes key
  // Ref — access plainText, clear(), setText(), replaceText()
  ref={(r) => {
    textareaRef = r;
  }}
  // Visual
  backgroundColor="#1e1e1e"
  focusedBackgroundColor="#1e1e1e"
  cursorColor="#eeeeee"
  wrapMode="word" // "word" | "none"
/>
```

**Textarea ref interface:**

```typescript
interface TextareaRef {
  readonly plainText: string;
  clear(): void;
  setText(text: string): void;
  replaceText(text: string): void;
}
```

### `<input>` — Single-Line Input

Used for simple text inputs (e.g., token entry in GitOverlay).

```tsx
<input
  value={value()} // controlled value
  onChange={(val: string) => {}} // change handler
  onSubmit={(val: string) => {}} // submit handler
  placeholder="Enter token..."
  focused={true} // receives keyboard input
/>
```

### `<span>` — Inline Text Span

Used inside `<text>` for inline styling.

```tsx
<text>
  <span style={{ fg: theme.success }}>●</span> Running
  <span style={{ fg: theme.textMuted, bold: true }}> (healthy)</span>
</text>
```

**`<span>` uses `style` object** (unlike `<text>` which uses direct props). This is the ONE place where `style={{}}` is valid.

## Hooks

### `useKeyboard(handler)`

Registers a keyboard event handler. Events propagate from innermost to outermost handler.

```typescript
import { useKeyboard } from '@opentui/solid';

useKeyboard((event) => {
  // Cast to get typed access — the runtime type doesn't match the d.ts perfectly
  const evt = event as {
    name?: string; // 'enter', 'escape', 'up', 'down', 'tab', 'a', 'pageup', etc.
    char?: string; // raw character if printable
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
    alt?: boolean;
    stopPropagation?: () => void;
    preventDefault?: () => void;
  };

  // Common patterns:
  if (evt.name === 'escape') {
    /* close overlay */
  }
  if (evt.name === 'up' || evt.name === 'k') {
    /* vim-style up */
  }
  if (evt.name === 'down' || evt.name === 'j') {
    /* vim-style down */
  }
  if (evt.ctrl && evt.name === 'c') {
    /* quit */
  }
  if (evt.name === 'tab') {
    /* switch focus */
  }
  if (evt.name === 'enter') {
    /* select/submit */
  }
  if (evt.name === 'pageup') {
    /* scroll up */
  }
});
```

**Key name reference:** `enter`, `escape`, `tab`, `up`, `down`, `left`, `right`, `home`, `end`, `pageup`, `pagedown`, `space`, `backspace`, `delete`, plus any printable character as its name (e.g., `?`, `q`, `/`, `f`).

### `useTerminalDimensions()`

Returns a reactive accessor for terminal width/height.

```typescript
import { useTerminalDimensions } from '@opentui/solid';

const dims = useTerminalDimensions();
const columns = () => dims().width;
const rows = () => dims().height;
const isWideMode = () => columns() >= 80;
```

### `render(element)`

Mount the app. Called exactly once.

```typescript
import { render } from '@opentui/solid';

render(() => <App />);
```

## SolidJS Patterns Used in This Project

### Reactive Primitives

```typescript
import { createSignal, createEffect, createMemo, onCleanup } from 'solid-js';

// Signal — reactive value
const [value, setValue] = createSignal(0);
const current = value(); // read
setValue(42); // write
setValue((prev) => prev + 1); // update

// Effect — run side effects when dependencies change
createEffect(() => {
  console.log(value()); // re-runs when value() changes
});

// Memo — derived computation
const doubled = createMemo(() => value() * 2);

// Cleanup — run on unmount or before effect re-runs
onCleanup(() => {
  clearInterval(timer);
});
```

### Control Flow Components

```tsx
import { Show, For, Switch, Match } from 'solid-js';

// Conditional rendering
<Show when={isVisible()} fallback={<text>Hidden</text>}>
  <text>Visible</text>
</Show>

// List rendering
<For each={items()}>
  {(item, index) => <text>{item.name} ({index()})</text>}
</For>

// Multi-branch conditional
<Switch>
  <Match when={mode() === 'monitoring'}>
    <DashboardPanel />
  </Match>
  <Match when={mode() === 'deploying'}>
    <BuildPanel />
  </Match>
</Switch>
```

### Component Pattern

```tsx
import type { JSX } from 'solid-js';
import { theme } from '../theme.js';

interface MyComponentProps {
  title: string;
  onClose: () => void;
  children?: JSX.Element;
}

export function MyComponent(props: MyComponentProps): JSX.Element {
  // Access props via props.xxx (NOT destructured — SolidJS reactivity requires it)
  const title = () => props.title; // wrap in accessor for reactive updates

  return (
    <box flexDirection="column">
      <text bold={true} fg={theme.text}>
        {title()}
      </text>
      {props.children}
    </box>
  );
}
```

**CRITICAL:** Never destructure props in SolidJS. Use `props.xxx` directly or wrap in accessors.

### Async Pattern with Signals

```typescript
const [data, setData] = createSignal<Data | null>(null);
const [loading, setLoading] = createSignal(true);

createEffect(() => {
  const client = props.client;
  if (!client) return;

  void (async () => {
    try {
      const result = await client.fetchData();
      setData(result);
    } catch {
      // Handle error
    }
    setLoading(false);
  })();
});
```

### Timer with Cleanup

```typescript
createEffect(() => {
  if (!client()) return;

  const fetchAll = async () => {
    /* ... */
  };
  void fetchAll();

  const timer = setInterval(() => {
    void fetchAll();
  }, 5000);
  onCleanup(() => {
    clearInterval(timer);
  });
});
```

## Type Declarations

The project has custom type declarations at `src/tui/opentui.d.ts`:

```typescript
declare module '@opentui/solid' {
  import type { Accessor } from 'solid-js';

  export interface KeyboardEvent {
    name: string;
    char: string;
    ctrl: boolean;
    shift: boolean;
    meta: boolean;
    alt: boolean;
    stopPropagation?: () => void;
  }

  export function useKeyboard(handler: (evt: KeyboardEvent) => void): void;
  export function useTerminalDimensions(): Accessor<{ width: number; height: number }>;
  export function render(element: () => unknown): void;
}
```

If you need to add new OpenTUI types, extend this file.
