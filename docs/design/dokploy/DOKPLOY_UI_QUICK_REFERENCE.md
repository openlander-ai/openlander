# DOKPLOY UI — QUICK REFERENCE GUIDE

## Color Palette (HSL Variables)

### Light Mode

```
Background:     0 0% 100%      (Pure white)
Foreground:     240 10% 3.9%   (Near-black)
Border:         240 5.9% 90%   (Light gray)
Muted:          240 4.8% 95.9% (Very light gray)
Primary:        240 5.9% 10%   (Dark gray)
```

### Status Colors (Semantic)

```
Success:        Emerald 500    (bg-emerald-500)
Running:        Amber 500      (bg-amber-500)
Error:          Red 500        (bg-red-500)
Warning:        Yellow 50      (bg-yellow-50)
Idle:           Muted/40       (bg-muted-foreground/40)
```

## Spacing System

```
Base unit:      4px (0.25rem)
Common gaps:    4, 8, 12, 16, 20, 24, 32px
Card padding:   24px (p-6)
Content padding: 32px vertical (py-8)
Item gaps:      16px (gap-4)
Grid gap:       20px (gap-5)
```

## Typography

```
Font:           Inter (sans-serif)
Sizes:          xs(12px), sm(14px), base(16px), lg(20px), 2xl(28px), 3xl(32px)
Weights:        400(normal), 500(medium), 600(semibold), 700(bold)
Line height:    1 (headings), 1.5 (body)
Letter spacing: tight (-0.02em) for headings
```

## Component Patterns

### Cards

```tsx
<Card className="rounded-lg border bg-card text-card-foreground shadow-sm">
  <CardHeader className="flex flex-col space-y-1.5 p-6">
    <CardTitle className="text-2xl font-semibold leading-none tracking-tight">Title</CardTitle>
    <CardDescription className="text-sm text-muted-foreground">Description</CardDescription>
  </CardHeader>
  <CardContent className="p-6 pt-0">Content</CardContent>
</Card>
```

### Buttons

```tsx
<Button variant="default">Primary</Button>           {/* Dark gray bg */}
<Button variant="outline">Secondary</Button>         {/* Border + white bg */}
<Button variant="ghost">Tertiary</Button>            {/* No bg, hover accent */}
<Button variant="destructive">Delete</Button>        {/* Red bg */}
<Button size="sm">Small</Button>                      {/* 36px height */}
<Button size="lg">Large</Button>                      {/* 44px height */}
<Button size="icon">Icon</Button>                     {/* 40x40px */}
```

### Status Badges

```tsx
<Badge variant="green">Success</Badge>               {/* bg-emerald-600/20 */}
<Badge variant="yellow">Running</Badge>              {/* bg-yellow-600/20 */}
<Badge variant="red">Error</Badge>                   {/* bg-red-600/20 */}
<Badge variant="blue">Info</Badge>                   {/* bg-blue-600/20 */}
```

### Status Dots

```tsx
<span className="size-2 rounded-full bg-emerald-500" />  {/* Success */}
<span className="size-2 rounded-full bg-amber-500" />    {/* Running */}
<span className="size-2 rounded-full bg-red-500" />      {/* Error */}
<span className="size-2 rounded-full bg-muted-foreground/40" /> {/* Idle */}
```

### Stat Cards

```tsx
<div className="rounded-xl border bg-background p-5 min-h-[140px] flex flex-col justify-between">
  <span className="text-xs uppercase tracking-wider text-muted-foreground">Label</span>
  <div className="flex flex-col gap-1">
    <span className="text-3xl font-semibold tracking-tight">42</span>
    <span className="text-xs text-muted-foreground">+5 this week</span>
  </div>
</div>
```

### Empty States

```tsx
<div className="flex h-[50vh] w-full flex-col items-center justify-center space-y-4">
  <FolderInput className="size-8 text-muted-foreground" />
  <span className="text-center font-medium text-muted-foreground">No items found</span>
</div>
```

### Loading States

```tsx
<div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground">
  <span>Loading...</span>
  <Loader2 className="animate-spin size-4" />
</div>
```

## Layout Patterns

### Main Container

```tsx
<Card className="h-full bg-sidebar p-2.5 rounded-xl">
  <div className="rounded-xl bg-background shadow-md">
    {/* Header with p-6 */}
    {/* Content with py-8 border-t */}
  </div>
</Card>
```

### Responsive Grid

```tsx
<div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 gap-5">
  {/* Cards */}
</div>
```

### Search + Filters

```tsx
<div className="flex max-sm:flex-col gap-4 items-center w-full">
  <div className="flex-1 relative">
    <Input placeholder="Search..." className="pr-10" />
    <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
  </div>
  <Select value={sort} onValueChange={setSort}>
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Sort..." />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="name">Name</SelectItem>
      <SelectItem value="date">Date</SelectItem>
    </SelectContent>
  </Select>
</div>
```

## Sidebar

```
Width (expanded):   16rem (256px)
Width (collapsed):  3rem (48px)
Width (mobile):     18rem (288px)
Background:         Off-white (light) / Dark gray (dark)
Keyboard toggle:    Ctrl+B (or Cmd+B)
Persistence:        Saved to cookie
```

## Shadows & Borders

```
Card shadow:        shadow-sm (subtle)
Border color:       border-border (light gray)
Border radius:      rounded-lg (8px) or rounded-xl (12px)
No gradients:       All solid colors
```

## Interactions

```
Hover:              hover:bg-border or hover:bg-accent
Active:             active:hover:scale-[0.98] (subtle press)
Focus:              focus-visible:ring-2 focus-visible:ring-ring
Disabled:           disabled:opacity-50
Transitions:        transition-all (smooth)
```

## Dark Mode

```
Enabled via:        class-based dark mode
CSS variables:      Automatically override in .dark class
No component changes needed
```

## Responsive Breakpoints

```
Mobile:             < 640px (1 column)
Tablet (lg):        ≥ 1024px (2 columns)
Desktop (xl):       ≥ 1280px (3 columns)
Large (2xl):        ≥ 1536px (4 columns)
Extra Large (3xl):  ≥ 1920px (5 columns)
```

## Key Files

```
Colors:             apps/dokploy/styles/globals.css
Tailwind config:    apps/dokploy/tailwind.config.ts
Button component:   apps/dokploy/components/ui/button.tsx
Badge component:    apps/dokploy/components/ui/badge.tsx
Card component:     apps/dokploy/components/ui/card.tsx
Sidebar:            apps/dokploy/components/ui/sidebar.tsx
Projects page:      apps/dokploy/components/dashboard/projects/show.tsx
Home page:          apps/dokploy/components/dashboard/home/show-home.tsx
```

## Design Philosophy

1. **Minimal** — No visual clutter, subtle shadows, muted icons
2. **Information-dense** — Show relevant info without overwhelming
3. **Semantic** — Colors mean something (green=success, red=error)
4. **Consistent** — Same patterns repeated throughout
5. **Accessible** — Focus rings, keyboard shortcuts, ARIA labels
6. **Responsive** — Works on mobile, tablet, desktop, large screens
7. **Progressive** — Main info visible, secondary in dropdowns/modals

## What NOT to Do

- ❌ Don't use bright accent colors in primary UI
- ❌ Don't use large shadows (shadow-lg, shadow-xl)
- ❌ Don't use gradients
- ❌ Don't use animations except on interaction
- ❌ Don't use small padding (p-2, p-3)
- ❌ Don't use tight spacing (gap-1, gap-2)
- ❌ Don't use colored icons (keep them muted)
- ❌ Don't use multiple font families
- ❌ Don't use inconsistent button styles
- ❌ Don't hide important information

## What TO Do

- ✅ Use neutral colors (grays, blacks, whites)
- ✅ Use generous padding (p-6, py-8)
- ✅ Use semantic status colors (emerald, amber, red, yellow)
- ✅ Use subtle shadows (shadow-sm)
- ✅ Use consistent spacing (gap-4, gap-5)
- ✅ Use muted icons (text-muted-foreground)
- ✅ Use clear information hierarchy
- ✅ Use responsive grids
- ✅ Use progressive disclosure
- ✅ Use keyboard shortcuts

---

**Source**: github.com/Dokploy/dokploy (April 2026)
