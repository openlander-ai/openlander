# GUIDE-02 — Page Skeleton

> **Audience**: Claude Design (concrete layout brief) + implementer (component skeleton).
> **Purpose**: Define the **repeating shape of every page** so cognitive load stays near zero as users move across routes. This is the visual consequence of Mechanism M2 ("Single Outer-Card Frame") in GUIDE-01.
> **Grounding**: Dokploy hands-on observation (see `DOKPLOY_HANDSON_UX_ANALYSIS.md` §3). Every single Dokploy route uses this exact skeleton — it's the main reason the product feels systematic.
> **Status**: draft — Claude Design fills in pixel-level details, types, spacing tokens.

---

## 1. The Skeleton (everything except the content body)

At any 1440×900 desktop view, the skeleton is:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [Sidebar                ]  [Top bar                                       ] │
│ [  (fixed 256px)        ]  [  toggle │ breadcrumb        │ context widget ] │
│ [                       ]  ───────────────────────────────────────────────  │
│ [   Section A           ]                                                    │
│ [   - Home              ]  ┌ Outer Card ─────────────────────────────────┐ │
│ [   - Projects (active) ]  │                                              │ │
│ [   - Deployments       ]  │  [Header: icon + Title + subtitle]   [Action]│ │
│ [   - Monitoring        ]  │                                              │ │
│ [   - Logs              ]  │  ───────────────                             │ │
│ [                       ]  │                                              │ │
│ [   Section B           ]  │  <<< CONTENT BODY >>>                        │ │
│ [   - Web Server        ]  │                                              │ │
│ [   - Profile           ]  │                                              │ │
│ [   - ...                ]  │                                              │ │
│ [                       ]  └──────────────────────────────────────────────┘ │
│ [─────────────────────  ]                                                    │
│ [  Account card         ]                                                    │
│ [  lehdqlsl@naver.com   ]                                                    │
│ [  Version v1.0.0       ]                                                    │
└────────────────────────────────────────────────────────────────────────────┘
```

All four zones (sidebar, top bar, outer card, footer anchor) appear on **every** content route. Any deviation requires a written exception in this doc.

---

## 2. Sidebar (left)

### Dimensions

- Width: **256px expanded**, **48px collapsed** (icon-only).
- Height: 100vh with internal scroll if items overflow — ideally composition stays within 768px vertical.
- Background: slightly darker than main bg (use muted panel token).

### Zones (top to bottom)

1. **Org switcher + bell** (top): dropdown ("My Organization" placeholder for v1.0 since single-org) + notification bell. Reserve slot but don't over-design.
2. **Section A — Workspace** (see GUIDE-01 §3)
3. **Section B — Settings** (see GUIDE-01 §3)
4. Small separator
5. **Account card**: avatar (letters fallback) + email + chevron (opens dropdown: switch org, sign out)
6. **Version stamp**: `v1.0.0`, tiny (11-12px), muted, centered

### Section headers

Above each section, a small-caps label (`Workspace`, `Settings`) in a muted tone at ~60% opacity. This is Dokploy's pattern and it works.

### Active item

Full-row highlight with subtle background tint + left accent bar (2px) in primary color. Icon + text remain black/foreground.

### Hover

Background tint (less strong than active) + cursor pointer. No scale transforms.

---

## 3. Top Bar

### Dimensions

- Height: 56px on desktop.
- Spans full width from sidebar edge to viewport right edge.
- Background: same as main content background (or 1 step up from it).

### Contents

| Zone        | Content                                                                                                                                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Left edge   | Sidebar toggle button (collapse/expand sidebar)                                                                                                                                                                                                                  |
| Left-center | Breadcrumb: `{Org} > {Section} > {Page}` — clickable links                                                                                                                                                                                                       |
| Right edge  | **Agent Command Center** — MCP connection indicator + last-agent-activity timestamp. One slot. See GUIDE-00 AG-3 for v1.0 scope (basic connected/disconnected + last timestamp). Do NOT show Dokploy-style "Server Time UTC" clock — low value, wastes the slot. |

### Rules

- **No** primary actions in the top bar. Actions go in the outer card header.
- **No** search bar in v1.0.
- Breadcrumb should NOT duplicate the sidebar highlight (they're in different axes of navigation — sidebar is "where," breadcrumb is "how I got here").

---

## 4. Outer Card Frame

The workhorse.

### Outer box

- Margin from top bar: 24px (desktop), 16px (mobile)
- Margin from viewport edges: 32px right+bottom (desktop), 16px (mobile)
- Border: 1px solid (use subtle border token)
- Radius: 12px (matches Dokploy's radius rhythm)
- Shadow: **none** — the border is enough visual weight
- Background: elevated panel color (1 step up from main bg)

### Inner padding

- Top + sides: 24px
- Between header and body: 24px (if there's a separator line) or 32px (without)

### Outer card header (inside the box)

Always present. Structure:

```
┌─────────────────────────────────────────────────────────────────┐
│ [icon]  Title (bold, 20px)                  [Primary Action]    │
│         Subtitle / description (muted, 14px)                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ <<<  content body  >>>                                          │
```

- **Icon**: 24px Lucide icon in primary color, optional (most pages have one)
- **Title**: 20-24px, bold, clear hierarchy over body content
- **Subtitle**: 13-14px, muted — brief description of the page's purpose (e.g., "Create and manage your projects")
- **Primary action** (right-aligned): button with primary style, always the single most-useful action for this page (e.g., `+ Create Project`)
- Optional separator line between header and body — use at designer's discretion, but be consistent across pages

### Content body (after header)

The freeform zone. But even inside, consistency rules apply:

---

## 5. Sub-Cards (inside the outer card)

For multi-section pages (typical on Settings routes, project details, service details), the body contains **stacked sub-cards** rather than one tall body.

### Sub-card dimensions

- Full width of outer card inner area
- Border: 1px subtle (same token as outer, maybe a touch lighter)
- Radius: 8px (slightly smaller than outer, hierarchy)
- Padding: 20px all sides
- Gap between sub-cards: 16px

### Sub-card header

Same triplet pattern as outer card header but slightly scaled down:

- Icon: 20px
- Title: 16-18px, semibold
- Subtitle: 12-13px, muted
- Primary action: right-aligned, maybe smaller button

### Maximum nesting

**2 levels total** (outer card → sub-card). No sub-sub-cards. If you need deeper grouping, re-think the page structure.

---

## 6. List Pages (Projects, Services within a project, Deployments history)

List pages share this sub-structure inside the outer card body:

```
[ Filter input          ] [🏷 Tags] [⇅ Newest first ▼]   ← controls row
───────────────────────────────────────────────────────── ← separator (optional)
┌ Card 1 ─────────────────────────────────────────────┐
│ [icon] Name                                     [⋯]│  ← overflow menu on right
│ Subtitle · 3 services · running                     │
└─────────────────────────────────────────────────────┘
┌ Card 2 ─────────────────────────────────────────────┐
...
```

### Controls row

- Filter input (width ~60% of row on desktop)
- Secondary filters (e.g., tags) as chips/buttons
- Sort dropdown, right-aligned

### Card grid or list view

- Grid: 1–3 columns responsive (default 2 at 1280px, 3 at 1440px+, 1 on mobile)
- Each card: icon + title + overflow menu (`...`) + 1-line subtitle + optional status pills

### Empty state

Centered vertically in the list area:

```
                [empty-state icon]

           "You don't have any projects yet"

             [+ Create Project]   ← primary
```

---

## 7. Detail Pages (Project, Service)

Inside the outer card body, a detail page has:

1. **Tabs row** (horizontal) — tabs from GUIDE-01 §4. Active tab underlined with primary color.
2. **Active tab's content** below.

Each tab's content is typically a stack of sub-cards (§5).

### Tab overflow

If tabs don't fit the width, horizontal scroll with scroll shadows. Do **not** collapse into a dropdown — users should see all tabs at once where possible.

---

## 8. Modals (for creation + destructive confirm)

Modal overlay on the full page. Not inside the outer card.

### Structure

```
┌ Modal (max-width 480px) ───────────────────────┐
│ [Title]                              [× close] │
│ Subtitle / description                         │
│                                                │
│ [form fields...]                               │
│                                                │
│                       [Cancel] [Primary Action]│
└────────────────────────────────────────────────┘
```

### Rules

- Centered on viewport, backdrop blurred/dimmed
- ESC closes modal EXCEPT for destructive confirmation dialogs (those require explicit Cancel click)
- Backdrop click closes modal (same exception)
- Primary action right-aligned in footer, Cancel secondary-styled to its left

---

## 9. Responsive Behavior

### Breakpoints

| Breakpoint  | Behavior                                                         |
| ----------- | ---------------------------------------------------------------- |
| ≥1280px     | Full layout: sidebar expanded, outer card 3-column grid on lists |
| 1024–1279px | Sidebar expanded, 2-column grid                                  |
| 768–1023px  | Sidebar collapsed to icons only, 1-column grid                   |
| <768px      | Sidebar becomes a drawer (opened by top-left menu button)        |

### Mobile specifics

- Top bar stays, with sidebar drawer toggle where the sidebar toggle was
- Outer card margin reduces (16px instead of 32px)
- Sub-cards stack normally
- Tabs: horizontal scroll with scroll shadows

---

## 10. Visual Tokens (inherited, not redefined here)

Reuse existing OpenLander design tokens:

- Colors: HSL variables (see DOKPLOY_VISUAL_PATTERNS.md from 4/21 docs)
- Typography: Inter, same scale
- Spacing: Tailwind 4px-base scale
- Radius: use existing `--radius` and derivatives
- Shadows: minimal — prefer border over shadow

Claude Design confirms/rejects these against the existing shadcn/ui setup.

---

## 11. Deliberate Exceptions (the only allowed full-bleed surfaces)

Two surfaces break the outer card rule:

1. **Log streaming viewer — full-bleed by default** (Gemini-reviewed change): when the user opens a log view (deploy log modal or Logs tab), the log stream area uses **the full viewport width minus sidebar**, with **no outer card padding around the log lines**. Only header (title + status pill + buttons) + footer (if any) get the card-frame treatment. Body is edge-to-edge.

   **Why** (Gemini §6): outer card 32px margins + 24px inner padding = ~15% horizontal real estate lost. Log lines commonly exceed 120 chars (stack traces, docker paths, Linux filenames) and wrap aggressively inside a card-constrained viewport. Wrapping a 180-char line into 4 visual rows is unreadable. Logs are the highest-value debugging surface — they deserve the space.

   A `[⇲ Focus mode]` affordance in the viewer header expands further to hide the sidebar too (emergency "I need every pixel" mode). Default viewer already gives the log full horizontal minus sidebar.

2. **Monitoring charts dashboard**: if charts need more horizontal space than the outer card allows, the Monitoring route uses a wider-than-card inner grid. Inner cards still exist, just laid out edge-to-edge.

These exceptions are built into the default layout for those routes; the user doesn't have to opt in.

---

## 12. Handoff to Claude Design

### What this guide gives you

- The 4-zone skeleton (sidebar, top bar, outer card, footer anchor)
- Padding/spacing values (approximate; designer finalizes tokens)
- Sub-card nesting rules and max depth
- List page structure
- Modal rules
- Responsive breakpoints

### What Claude Design decides

- Exact spacing tokens (agreed with implementer)
- Icon choice and weight
- Active state visual (highlight intensity, left bar thickness/color)
- Tab indicator style (underline vs pill vs tab background)
- Border and background hue exact values
- Primary color (if changing from current)

### Deliverable format

Three artifacts:

1. **Mockups**: Sidebar alone, Empty list page, Populated detail page with tabs, a Modal. At 1440×900 desktop only for v1.0.
2. **Component spec sheet**: OuterCard, SubCard, ListItemCard, Sidebar, TopBar, Modal — with dimensions annotated.
3. **Mobile sketches**: Sidebar drawer, mobile list page, mobile tab handling. Lower fidelity OK.

---

## 13. Acceptance

- [ ] Every content route in the v1.0 build renders the same sidebar + top bar + outer card skeleton
- [ ] Every outer card has the icon+title+subtitle header triplet
- [ ] Every list page has the filter/sort/tag controls row in the same position
- [ ] Nested cards never exceed 2 levels (outer → sub)
- [ ] Modals are used for creation and destructive confirm; never for editing
- [ ] Every route has a visible breadcrumb in the top bar
- [ ] No page uses a contextual (per-route) sidebar
- [ ] Mobile drawer opens from the top bar's menu button; sidebar content is identical to desktop
