# Layout, Flexbox, Responsive & Borders

## Yoga Flexbox Engine

OpenTUI uses Yoga (WASM) for layout — the same engine React Native uses. All layout is flexbox-based.

### Default Behavior

- `<box>` defaults to `flexDirection="column"` (vertical stacking)
- Children are NOT absolutely positioned by default
- No CSS Grid. No floats. No `display: block/inline`. Only flexbox.
- `overflow="hidden"` clips content (essential for scroll areas)

### Available Layout Props

```
flexDirection    "row" | "column"
flexGrow         number (how much to expand)
flexShrink       number (how much to shrink — 0 prevents shrinking)
flexWrap         "wrap" | "nowrap"
justifyContent   "flex-start" | "flex-end" | "center" | "space-between" | "space-around"
alignItems       "flex-start" | "flex-end" | "center" | "stretch"
gap              number (spacing between children)
overflow         "hidden" | "visible"
position         "absolute" | undefined
width            number | "100%" | string percentage
height           number | "100%"
minHeight        number
maxHeight        number
minWidth         number
maxWidth         number
padding          number (all sides)
paddingX         number (left + right)
paddingY         number (top + bottom)
paddingLeft      number
paddingRight     number
paddingTop       number
paddingBottom    number
margin           number (all sides)
marginTop        number
marginBottom     number
marginLeft       number
marginRight      number
```

**NOT available:** `display`, `grid`, `float`, `z-index`, `transform`, `opacity`, `animation`, `transition`, percentages on padding/margin

## Responsive Layout Pattern

### Two-Tier Responsive (Layout.tsx)

```typescript
const isWideMode = () => columns() >= 80;
const isExtraWide = () => columns() >= 120;

const leftWidth = () => {
  if (isExtraWide()) return Math.floor(columns() * 0.6); // 60:40
  if (isWideMode()) return Math.floor(columns() * 0.65); // 65:35
  return '100%'; // single panel
};
```

### Breakpoint Reference

| Terminal Width | Mode       | Left Panel         | Right Panel |
| -------------- | ---------- | ------------------ | ----------- |
| ≥120           | Extra wide | 60%                | 40%         |
| 80-119         | Wide       | 65%                | 35%         |
| <80            | Single     | 100% (active only) | hidden      |

### Single Panel Switching

In single mode, `<Show when={activePanel === 'left'}` toggles between panels:

```tsx
<Show
  when={isWideMode()}
  fallback={
    <box width="100%">
      <Show when={props.activePanel === 'left'} fallback={props.right}>
        {props.left}
      </Show>
    </box>
  }
>
  {/* wide mode: both panels side by side */}
</>
```

## Overall Page Structure

```
┌─────────────────────────────────────────────────────────┐
│  padding=1                                              │
│  ┌──────────────────────┃──────────────────────────────┐│
│  │   Left Panel         ┃   Right Panel                ││
│  │   (ChatPanel)        ┃   (StatusPanel)              ││
│  │   paddingRight=1     ┃   paddingLeft=1              ││
│  │                      ┃                              ││
│  │                      ┃   → DashboardPanel (monitor) ││
│  │                      ┃   → BuildPanel (deploy)      ││
│  │                      ┃   → ProjectInfo+Log (debug)  ││
│  │                      ┃                              ││
│  │   height=rows()-1    ┃                              ││
│  └──────────────────────┃──────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────┐│
│  │  StatusBar (height=1)   Tab Panel  / Cmds  ? Help  ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
```

Key measurements:

- Content height = `rows() - 1` (1 row reserved for StatusBar)
- StatusBar: `flexShrink={0}` (never shrinks)
- Main content: `flexGrow={1}` (fills remaining space)
- Panel divider: 1px wide box with SplitBorder

## Overlay Positioning

Overlays use `position="absolute"` to cover the entire screen:

```tsx
<Show when={showOverlay()}>
  <box position="absolute" width={columns()} height={rows()} flexDirection="column">
    <OverlayContent />
  </box>
</Show>
```

### Overlay Internal Layout

Standard overlay dialog:

```tsx
<box
  flexDirection="column"
  width={columns()}
  height={rows()}
  justifyContent="center" // vertically center the dialog
  alignItems="center" // horizontally center the dialog
  backgroundColor={theme.background} // full-screen background
>
  <box
    flexDirection="column"
    border="round" // rounded border
    borderColor={theme.borderActive} // active border color
    paddingX={2}
    paddingY={1}
    width={contentWidth} // fixed width (50-70)
    backgroundColor={theme.backgroundMenu}
  >
    {/* Header */}
    <box marginBottom={1} justifyContent="center">
      <text bold={true} fg={theme.text}>
        Title
      </text>
    </box>
    {/* Content */}
    ...
    {/* Footer hints */}
    <box marginTop={1} justifyContent="center">
      <text fg={theme.textDim}>[Esc Close]</text>
    </box>
  </box>
</box>
```

### Content Width Patterns

- HelpOverlay: `contentWidth = 50` (fixed)
- ModelOverlay: `contentWidth = 60` (fixed)
- GitOverlay: `contentWidth = 60` (fixed)
- RepoOverlay: `contentWidth = 70` (fixed)
- TunnelOverlay: `contentWidth = Math.min(70, columns() - 4)` (responsive)
- EnvOverlay: `contentWidth = Math.min(70, columns() - 4)` (responsive)

## Border Patterns

### Round Border (Overlays)

```tsx
<box border="round" borderColor={theme.borderActive}>
  {/* Dialog content */}
</box>
```

### Partial Border — Left Side Only

```tsx
<box border={['left']} borderColor="#fab283">
  {/* Content with left pipe */}
</box>
```

### SplitBorder — Panel Divider

Defined in `theme.ts`:

```typescript
export const SplitBorder = {
  border: ['left' as const],
  customBorderChars: {
    topLeft: '',
    bottomLeft: '',
    vertical: '┃',
    topRight: '',
    bottomRight: '',
    horizontal: ' ',
    bottomT: '',
    topT: '',
    cross: '',
    leftT: '',
    rightT: '',
  },
};
```

**Usage 1 — Layout panel divider:**

```tsx
<box
  width={1}
  border={['left']}
  customBorderChars={SplitBorder.customBorderChars}
  borderColor={theme.borderSubtle}
  flexShrink={0}
/>
```

**Usage 2 — Message/content left pipe:**

```tsx
<box {...SplitBorder} borderColor={theme.secondary}>
  <box paddingLeft={2}>
    <text>Content with left pipe border</text>
  </box>
</box>
```

### Custom Border Chars — Prompt Pattern

The Prompt component uses elaborate custom borders:

```typescript
// EmptyBorder base — all spaces
const EmptyBorder = {
  topLeft: ' ', topRight: ' ', bottomLeft: ' ', bottomRight: ' ',
  horizontal: ' ', vertical: ' ',
  topT: ' ', bottomT: ' ', leftT: ' ', rightT: ' ', cross: ' ',
};

// Pipe with custom cap at bottom
<box border={['left']} customBorderChars={{
  ...EmptyBorder,
  vertical: '┃',
  bottomLeft: '╹',
}} borderColor={theme.primary}>
```

### Bottom Line Decoration

```tsx
// ╹▀▀▀▀▀▀▀▀▀▀ pattern
<box height={1} border={['left']} customBorderChars={{ ...EmptyBorder, vertical: '╹' }}>
  <box height={1} border={['bottom']} customBorderChars={{ ...EmptyBorder, horizontal: '▀' }} />
</box>
```

## Height Splitting in Deploy/Debug Modes

StatusPanel splits the right panel between sub-components:

```typescript
// Deploy mode
<DashboardPanel height={Math.floor(props.height * 0.4)} compact={true} />
<BuildPanel height={Math.floor(props.height * 0.6)} />

// Debug mode
<ProjectInfo height={Math.floor(props.height * 0.35)} />
<LogViewer height={Math.floor(props.height * 0.65)} />
```

## Common Layout Recipes

### Centered content (empty state)

```tsx
<box flexGrow={1} flexDirection="column" alignItems="center">
  <box flexGrow={1} minHeight={0} /> {/* top spacer */}
  <box flexShrink={0}>{/* centered content */}</box>
  <box flexGrow={1} minHeight={0} /> {/* bottom spacer */}
</box>
```

### Row with label and value

```tsx
<box flexDirection="row" gap={1}>
  <text fg={theme.textMuted}>Label</text>
  <text fg={theme.text}>Value</text>
</box>
```

### Scrollable area

```tsx
<box flexDirection="column" height={props.height} overflow="hidden">
  <For each={items()}>{(item) => <text>{item.text}</text>}</For>
</box>
```

### Selection list with highlight

```tsx
<For each={items()}>
  {(item, index) => {
    const isSelected = () => index() === selectedIndex();
    return (
      <box>
        <text
          fg={isSelected() ? theme.secondary : theme.textMuted}
          bold={isSelected()}
          backgroundColor={isSelected() ? theme.backgroundElement : undefined}
        >
          {isSelected() ? ' ▶ ' : '   '}
          {item.name}
        </text>
      </box>
    );
  }}
</For>
```
