# Dokploy UI/UX Design Summary

**Quick Reference for OpenLander Design Decisions**

---

## 🎨 Design System at a Glance

### Stack

- **Framework**: Next.js 16 + React 18
- **Styling**: Tailwind CSS v3 + HSL variables
- **Components**: shadcn/ui (Radix UI primitives)
- **Icons**: Lucide React
- **Forms**: React Hook Form + Zod
- **Data**: tRPC + React Query
- **Notifications**: Sonner (toast)

### Color Philosophy

- **Neutral palette**: Grays + single primary color
- **HSL variables**: Full theming support
- **Light mode**: White background, dark text
- **Dark mode**: Black background, light text
- **Status colors**: Red for destructive, green for success

### Layout Pattern

- **Collapsible sidebar**: 256px expanded, 48px collapsed
- **Mobile drawer**: Sidebar becomes sheet on mobile
- **Nested cards**: Outer card (sidebar bg) → Inner card (background)
- **Max-width constraint**: `max-w-8xl` for readability

---

## 🧩 Key UI Patterns

### 1. Dashboard Page

```
DashboardLayout
  └── Page Component (ShowProjects, ShowDeployments, etc.)
      └── Card (outer: bg-sidebar)
          └── Card (inner: bg-background)
              └── Content
```

### 2. Search + Filter + Sort

```
Input (search)
Select (sort)
TagFilter (tags)
→ Filters saved to localStorage
```

### 3. Tabbed Content

```
Tabs
  ├── TabsList (tab buttons)
  └── TabsContent (content per tab)
```

### 4. Form Pattern

```
Form (React Hook Form)
  └── FormField (per input)
      ├── FormLabel
      ├── FormControl (Input/Select/etc)
      └── FormMessage (errors)
```

### 5. Data Table

```
Table
  ├── Header (sortable columns)
  ├── Body (rows with actions)
  └── Pagination
```

---

## 🎯 Design Principles

| Principle          | Implementation                  |
| ------------------ | ------------------------------- |
| **Minimalism**     | No decorations, functional only |
| **Consistency**    | Unified component library       |
| **Clarity**        | Clear hierarchy, obvious CTAs   |
| **Accessibility**  | Semantic HTML, keyboard nav     |
| **Responsiveness** | Mobile-first, flexible layouts  |
| **Performance**    | Code splitting, lazy loading    |

---

## 📐 Spacing & Sizing

### Tailwind Scale

- `gap-2`: 8px
- `gap-4`: 16px
- `gap-6`: 24px
- `p-6`: 24px padding
- `rounded-lg`: 8px border radius

### Custom Sizes

- Sidebar expanded: 256px
- Sidebar collapsed: 48px
- Sidebar mobile: 288px
- Max content width: 85rem (1360px)

---

## 🎨 Component Variants

### Button

- **Variants**: default, destructive, outline, secondary, ghost, link
- **Sizes**: default (h-10), sm (h-9), lg (h-11), icon (h-10 w-10)
- **Loading**: Built-in spinner via `isLoading` prop
- **Interaction**: `active:hover:scale-[0.98]` for tactile feedback

### Card

- **Shadow**: `shadow-sm` (minimal)
- **Border**: Subtle, uses CSS variable
- **Rounded**: `rounded-lg` (8px)
- **Composable**: Header, Title, Description, Content, Footer

### Input

- **Border**: `border border-input`
- **Focus**: `focus-visible:ring-2 focus-visible:ring-ring`
- **Placeholder**: `placeholder-muted-foreground`

---

## 🌙 Dark Mode

**Implementation**:

- CSS custom properties (HSL)
- `.dark` class on root
- `next-themes` for persistence
- System preference detection

**Color Inversion**:

- Light: White bg, dark text
- Dark: Black bg, light text
- Sidebar: Light gray (light) → Dark gray (dark)

---

## ♿ Accessibility

### Keyboard Shortcuts

- `Cmd+B`: Toggle sidebar
- `Cmd+K`: Open command palette

### Focus Management

- Focus visible rings on all interactive elements
- Proper ARIA labels
- Semantic HTML (buttons, links, forms)
- Color contrast compliance

---

## 📱 Responsive Breakpoints

```
Mobile: < 640px
  └── Sidebar → Drawer
  └── Flex column layouts
  └── Full-width inputs

Tablet: 640px - 1024px
  └── Sidebar visible
  └── Flex row layouts
  └── Constrained widths

Desktop: > 1024px
  └── Sidebar expanded
  └── Multi-column layouts
  └── Max-width constraints
```

---

## 🔄 Data Flow

```
Page Component
  ├── useQuery (fetch data)
  ├── useState (local state)
  ├── useMutation (mutations)
  └── Render UI
      └── On change → Mutation
          └── Invalidate cache
              └── Refetch data
```

---

## 📋 Form Validation

```
Zod Schema
  ↓
React Hook Form
  ├── Validation on blur
  ├── Error display
  └── Submit handling
      ↓
      Mutation
      ↓
      Toast notification
```

---

## 🎬 Animations

**Minimal, functional only**:

- Button hover: `hover:bg-primary/90`
- Button active: `active:hover:scale-[0.98]`
- Accordion: Smooth expand/collapse
- Sidebar: Smooth collapse animation
- Toast: Slide in/out

**No decorative animations** (no spinning icons, no bouncing, etc.)

---

## 📊 Charts & Monitoring

**Recharts Integration**:

- Line charts for time-series
- Bar charts for comparisons
- Responsive containers
- Custom tooltips
- Legend support

**Chart Colors** (HSL):

- Chart 1: Teal (173 58% 39%)
- Chart 2: Orange (12 76% 61%)
- Chart 3: Blue (197 37% 24%)
- Chart 4: Yellow (43 74% 66%)
- Chart 5: Red-orange (27 87% 67%)

---

## 🖥️ Terminal & Code Editor

### Terminal (xterm.js)

- Full terminal emulation
- Copy/paste support
- Custom scrollbar styling
- Real-time log streaming

### Code Editor (CodeMirror)

- Syntax highlighting
- Auto-completion
- Search & replace
- Custom themes
- Line numbers

---

## 🚀 Performance Optimizations

1. **Code Splitting**: Dynamic imports for large components
2. **Image Optimization**: Next.js Image component
3. **Lazy Loading**: Intersection Observer for off-screen content
4. **Data Caching**: React Query deduplication
5. **Prefetching**: Server-side helpers for SSR

---

## 📚 Component Organization

```
components/
├── ui/                    # Primitives (30+ files)
├── dashboard/             # Features (22 directories)
├── layouts/               # Layout wrappers
├── shared/                # Shared utilities
├── proprietary/           # Enterprise features
└── icons/                 # Custom icons
```

---

## 🎓 Key Takeaways for OpenLander

1. ✅ **Use HSL variables** for theming flexibility
2. ✅ **Keep shadcn/ui** for consistency
3. ✅ **Adopt collapsible sidebar** for navigation
4. ✅ **Minimize animations** (functional only)
5. ✅ **Use consistent spacing** (Tailwind scale)
6. ✅ **Implement clear hierarchy** (titles, descriptions)
7. ✅ **Ensure keyboard accessibility** (shortcuts, focus)
8. ✅ **Use icons consistently** (Lucide React)

---

## 📖 Full Analysis

See `DOKPLOY_UI_ANALYSIS.md` for detailed breakdown with code examples and GitHub permalinks.

---

**Last Updated**: April 21, 2026  
**Dokploy Commit**: 6fb4a13  
**Analysis Scope**: Frontend architecture, design system, UI patterns
