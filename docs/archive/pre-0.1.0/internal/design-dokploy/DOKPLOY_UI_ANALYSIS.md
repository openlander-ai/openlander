# DOKPLOY UI IMPLEMENTATION ANALYSIS

**Date**: April 21, 2026  
**Source**: github.com/Dokploy/dokploy (frontend: apps/dokploy)  
**Framework**: Next.js 14 + React 19 + TypeScript + Tailwind CSS v3 + shadcn/ui

---

## EXECUTIVE SUMMARY

Dokploy's UI is **intentionally minimal and information-dense**. Their design philosophy:

- **Neutral color palette** (grays, blacks, whites) with minimal accent colors
- **Generous whitespace** and padding (p-6, gap-4, gap-6 throughout)
- **Subtle borders** (border-border = 240 5.9% 90% in light mode)
- **Semantic status colors** (emerald for success, amber for running, red for error)
- **Card-based layout** with shadow-sm (not shadow-lg)
- **No visual clutter** — information is shown progressively
- **Consistent spacing system** (0.5rem base radius, 6px padding increments)

---

## PART 1: GLOBAL THEME & COLOR SYSTEM

### CSS Variables (Light Mode)

```css
/* apps/dokploy/styles/globals.css */

:root {
  /* Neutral palette */
  --background: 0 0% 100%; /* Pure white */
  --foreground: 240 10% 3.9%; /* Near-black */

  /* Cards & containers */
  --card: 0 0% 100%; /* White */
  --card-foreground: 240 10% 3.9%; /* Dark text */

  /* Primary (dark gray) */
  --primary: 240 5.9% 10%; /* Dark gray for buttons */
  --primary-foreground: 0 0% 98%; /* Near-white text */

  /* Secondary (light gray) */
  --secondary: 240 4.8% 95.9%; /* Very light gray */
  --secondary-foreground: 240 5.9% 10%;

  /* Muted (for disabled/secondary text) */
  --muted: 240 4.8% 95.9%; /* Light gray */
  --muted-foreground: 240 3.8% 46.1%; /* Medium gray */

  /* Borders */
  --border: 240 5.9% 90%; /* Light gray border */
  --input: 240 5.9% 90%; /* Input background */

  /* Sidebar */
  --sidebar-background: 0 0% 98%; /* Off-white */
  --sidebar-foreground: 240 5.3% 26.1%;
  --sidebar-primary: 240 5.9% 10%;
  --sidebar-border: 220 13% 91%;

  /* Status colors (semantic) */
  --chart-1: 173 58% 39%; /* Teal/emerald */
  --chart-2: 12 76% 61%; /* Orange */
  --chart-3: 197 37% 24%; /* Dark blue */
  --chart-4: 43 74% 66%; /* Yellow */
  --chart-5: 27 87% 67%; /* Orange-red */

  /* Radius */
  --radius: 0.5rem; /* 8px */
}
```

### Dark Mode Overrides

```css
.dark {
  --background: 0 0% 0%; /* Pure black */
  --foreground: 0 0% 98%; /* Near-white */
  --card: 240 4% 10%; /* Dark gray */
  --sidebar-background: 240 5.9% 10%; /* Dark gray */
  --sidebar-primary: 224.3 76.3% 48%; /* Blue accent */
}
```

**Key insight**: Dokploy uses **HSL color variables** (not hex), enabling dark mode via CSS variable overrides. No Tailwind color customization needed beyond the base theme.

---

## PART 2: SPACING & LAYOUT PATTERNS

### Card Container Pattern

```tsx
// apps/dokploy/components/dashboard/projects/show.tsx (line 207-226)

<Card className="h-full bg-sidebar p-2.5 rounded-xl">
  <div className="rounded-xl bg-background shadow-md">
    <div className="flex justify-between gap-4 w-full items-center flex-wrap p-6">
      <CardHeader className="p-0">
        <CardTitle className="text-xl flex flex-row gap-2">
          <FolderInput className="size-6 text-muted-foreground self-center" />
          Projects
        </CardTitle>
        <CardDescription>Create and manage your projects</CardDescription>
      </CardHeader>
      {/* Action buttons */}
    </div>

    <CardContent className="space-y-2 py-8 border-t gap-4 flex flex-col min-h-[60vh]">
      {/* Content */}
    </CardContent>
  </div>
</Card>
```

**Spacing breakdown**:

- **Outer Card**: `p-2.5` (4px padding) — creates breathing room
- **Inner div**: `rounded-xl bg-background shadow-md` — white container with subtle shadow
- **Header**: `p-6` (24px) — generous padding
- **Content**: `py-8` (32px vertical), `gap-4` (16px between items)
- **Border**: `border-t` (top border only, separates header from content)

### Grid Layout for Project Cards

```tsx
// apps/dokploy/components/dashboard/projects/show.tsx (line 293)

<div className="w-full grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 flex-wrap gap-5">
  {filteredProjects?.map((project) => (
    <div key={project.projectId} className="w-full lg:max-w-md">
      <Card className="group relative w-full h-full bg-transparent transition-colors hover:bg-border">
        {/* Project card content */}
      </Card>
    </div>
  ))}
</div>
```

**Grid pattern**:

- **Responsive**: 1 col (mobile) → 2 cols (lg) → 3 cols (xl) → 4 cols (2xl) → 5 cols (3xl)
- **Gap**: `gap-5` (20px between cards)
- **Card styling**: `bg-transparent` with `hover:bg-border` (subtle hover effect)
- **Max width**: `lg:max-w-md` (448px) — prevents cards from stretching too wide

---

## PART 3: COMPONENT PATTERNS

### Project Card (Minimal, Information-Dense)

```tsx
// apps/dokploy/components/dashboard/projects/show.tsx (line 347-479)

<Card className="group relative w-full h-full bg-transparent transition-colors hover:bg-border">
  <CardHeader>
    <CardTitle className="flex items-center justify-between gap-2 overflow-clip">
      <span className="flex flex-col gap-1.5">
        {/* Project name with icon */}
        <div className="flex items-center gap-2">
          <BookIcon className="size-4 text-muted-foreground" />
          <span className="text-base font-medium leading-none">{project.name}</span>
        </div>

        {/* Description */}
        <span className="text-sm font-medium text-muted-foreground break-normal">
          {project.description}
        </span>

        {/* Tags */}
        {project.projectTags && project.projectTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {project.projectTags.map((pt) => (
              <TagBadge key={pt.tag.tagId} name={pt.tag.name} color={pt.tag.color} />
            ))}
          </div>
        )}

        {/* Warning state */}
        {hasNoEnvironments && (
          <div className="flex flex-row gap-2 items-center rounded-lg bg-yellow-50 p-2 mt-2 dark:bg-yellow-950">
            <AlertTriangle className="size-4 text-yellow-600 dark:text-yellow-400 shrink-0" />
            <span className="text-xs text-yellow-600 dark:text-yellow-400">
              You have access to this project but no environments are available
            </span>
          </div>
        )}
      </span>

      {/* Dropdown menu */}
      <div className="flex self-start space-x-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="px-2">
              <MoreHorizontalIcon className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[200px] space-y-2 overflow-y-auto max-h-[280px]">
            {/* Actions */}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </CardTitle>
  </CardHeader>
</Card>
```

**Design principles**:

- **No footer** — all info in header
- **Vertical flex layout** (`flex flex-col gap-1.5`) — stacks name, description, tags
- **Icons are muted** (`text-muted-foreground`) — don't draw attention
- **Descriptions are secondary** (`text-sm text-muted-foreground`) — smaller, grayed
- **Tags have custom colors** — only visual accent
- **Warnings use semantic colors** (`bg-yellow-50 dark:bg-yellow-950`) — not red
- **Dropdown menu is subtle** (`variant="ghost"`) — doesn't dominate

### Home Dashboard Stats Cards

```tsx
// apps/dokploy/components/dashboard/home/show-home.tsx (line 44-66)

function StatCard({ label, value, delta }: { label: string; value: string; delta?: string }) {
  return (
    <div className="rounded-xl border bg-background p-5 min-h-[140px] flex flex-col justify-between">
      <span className="text-xs uppercase tracking-wider text-muted-foreground">{label}</span>
      <div className="flex flex-col gap-1">
        <span className="text-3xl font-semibold tracking-tight">{value}</span>
        {delta && <span className="text-xs text-muted-foreground">{delta}</span>}
      </div>
    </div>
  );
}
```

**Stat card pattern**:

- **Minimal styling**: `rounded-xl border bg-background p-5`
- **Label**: `text-xs uppercase tracking-wider text-muted-foreground` — small, spaced, muted
- **Value**: `text-3xl font-semibold tracking-tight` — large, bold, tight spacing
- **Delta**: `text-xs text-muted-foreground` — secondary info
- **Min height**: `min-h-[140px]` — consistent card height
- **Flex layout**: `flex flex-col justify-between` — label at top, value at bottom

### Status Indicator Pattern

```tsx
// apps/dokploy/components/dashboard/home/show-home.tsx (line 11-16)

const statusDotClass: Record<string, string> = {
  done: 'bg-emerald-500' /* Green for success */,
  running: 'bg-amber-500' /* Amber for in-progress */,
  error: 'bg-red-500' /* Red for failure */,
  idle: 'bg-muted-foreground/40' /* Muted gray for idle */,
};

// Usage in StatusListCard (line 82-89)
<li key={item.label} className="flex items-center gap-2.5 text-sm">
  <span className={`size-2 rounded-full shrink-0 ${item.dotClass}`} aria-hidden />
  <span className="font-semibold tabular-nums w-8">{item.count}</span>
  <span className="text-muted-foreground">{item.label}</span>
</li>;
```

**Status pattern**:

- **Dot size**: `size-2` (8px) — small, not dominant
- **Rounded**: `rounded-full` — circular
- **Semantic colors**: emerald (success), amber (running), red (error), muted (idle)
- **Layout**: dot + count + label, all aligned horizontally
- **Count styling**: `font-semibold tabular-nums w-8` — monospace, fixed width

---

## PART 4: BUTTON & INTERACTIVE PATTERNS

### Button Variants

```tsx
// apps/dokploy/components/ui/button.tsx (line 7-34)

const buttonVariants = cva(
  'inline-flex items-center justify-center whitespace-nowrap select-none rounded-lg transition-all will-change-transform active:hover:scale-[0.98] active:hover:transform text-sm font-medium ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/70',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);
```

**Button design**:

- **Base**: `rounded-lg` (8px), `text-sm`, `font-medium`
- **Interaction**: `transition-all` + `active:hover:scale-[0.98]` — subtle press effect
- **Default variant**: Dark gray background (`bg-primary`) with white text
- **Outline variant**: Border + white background, hover adds accent color
- **Ghost variant**: No background, hover adds accent background
- **Sizes**: default (40px), sm (36px), lg (44px), icon (40x40px)

### Badge Variants (Status Colors)

```tsx
// apps/dokploy/components/ui/badge.tsx (line 6-34)

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80',
        red: 'border-transparent select-none items-center whitespace-nowrap font-medium bg-red-600/20 dark:bg-red-500/15 text-destructive text-xs h-4 px-1 py-1 rounded-md',
        yellow:
          'border-transparent select-none items-center whitespace-nowrap font-medium bg-yellow-600/20 dark:bg-yellow-500/15 dark:text-yellow-500 text-yellow-600 text-xs h-4 px-1 py-1 rounded-md',
        orange:
          'border-transparent select-none items-center whitespace-nowrap font-medium bg-orange-600/20 dark:bg-orange-500/15 dark:text-orange-500 text-orange-600 text-xs h-4 px-1 py-1 rounded-md',
        green:
          'border-transparent select-none items-center whitespace-nowrap font-medium bg-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-500 text-emerald-600 text-xs h-4 px-1 py-1 rounded-md',
        blue: 'border-transparent select-none items-center whitespace-nowrap font-medium bg-blue-600/20 dark:bg-blue-500/15 dark:text-blue-500 text-blue-600 text-xs h-4 px-1 py-1 rounded-md',
        blank:
          'border-transparent select-none items-center whitespace-nowrap font-medium dark:bg-white/15 bg-black/15 text-foreground text-xs h-4 px-1 py-1 rounded-md',
        outline: 'text-foreground',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);
```

**Badge design**:

- **Shape**: `rounded-full` (pill-shaped)
- **Size**: `text-xs`, `px-2.5 py-0.5` (small, compact)
- **Status badges**: Use **low-opacity backgrounds** (`bg-red-600/20`) with **colored text** (`text-destructive`)
  - Red: `bg-red-600/20 text-destructive`
  - Yellow: `bg-yellow-600/20 text-yellow-600`
  - Green: `bg-emerald-600/20 text-emerald-600`
  - Blue: `bg-blue-600/20 text-blue-600`
- **Dark mode**: Darker backgrounds (`bg-red-500/15`) with lighter text (`dark:text-red-500`)

---

## PART 5: DEPLOYMENT LOGS & TERMINAL UI

### Logs Container

```tsx
// apps/dokploy/components/shared/drawer-logs.tsx (line 43-77)

<Sheet
  open={!!isOpen}
  onOpenChange={() => {
    onClose();
  }}
>
  <SheetContent className="sm:max-w-[740px] flex flex-col">
    <SheetHeader>
      <SheetTitle>Deployment Logs</SheetTitle>
      <SheetDescription>Details of the request log entry.</SheetDescription>
    </SheetHeader>
    <div
      ref={scrollRef}
      onScroll={handleScroll}
      className="h-[720px] overflow-y-auto space-y-0 border p-4 bg-[#fafafa] dark:bg-[#050506] rounded custom-logs-scrollbar"
    >
      {filteredLogs.length > 0 ? (
        filteredLogs.map((log: LogLine, index: number) => (
          <TerminalLine key={`${log.rawTimestamp ?? ''}-${index}`} log={log} noTimestamp />
        ))
      ) : (
        <div className="flex justify-center items-center h-full text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      )}
    </div>
  </SheetContent>
</Sheet>
```

**Logs styling**:

- **Container**: `h-[720px]` (fixed height), `overflow-y-auto` (scrollable)
- **Background**: `bg-[#fafafa]` (light mode) / `dark:bg-[#050506]` (dark mode) — near-white/near-black
- **Border**: `border` (subtle)
- **Padding**: `p-4` (16px)
- **Scrollbar**: Custom `custom-logs-scrollbar` class (see globals.css)
- **Empty state**: Centered spinner with muted text

### Custom Scrollbar Styling

```css
/* apps/dokploy/styles/globals.css (line 216-239) */

@layer utilities {
  .custom-logs-scrollbar {
    scrollbar-width: thin;
    scrollbar-color: hsl(var(--muted-foreground)) transparent;
  }

  .custom-logs-scrollbar::-webkit-scrollbar {
    width: 8px;
    height: 8px;
  }

  .custom-logs-scrollbar::-webkit-scrollbar-track {
    background: transparent;
  }

  .custom-logs-scrollbar::-webkit-scrollbar-thumb {
    background-color: hsl(var(--muted-foreground) / 0.3);
    border-radius: 20px;
  }

  .custom-logs-scrollbar::-webkit-scrollbar-thumb:hover {
    background-color: hsl(var(--muted-foreground) / 0.5);
  }
}
```

**Scrollbar design**:

- **Width**: 8px (thin but visible)
- **Thumb color**: `hsl(var(--muted-foreground) / 0.3)` (30% opacity gray)
- **Hover**: `0.5` opacity (50%) — subtle interaction
- **Border radius**: 20px (rounded)
- **Track**: Transparent (blends with background)

---

## PART 6: SIDEBAR NAVIGATION

### Sidebar Structure

```tsx
// apps/dokploy/components/layouts/side.tsx (line 1-150)

// Sidebar uses Radix UI primitives with custom styling
<SidebarProvider>
  <Sidebar>
    <SidebarHeader>{/* Logo */}</SidebarHeader>

    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Home</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <Link href="/dashboard/home">
                <House className="h-4 w-4" />
                <span>Home</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {/* More items */}
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>

    <SidebarFooter>{/* User menu */}</SidebarFooter>
  </Sidebar>

  <SidebarInset>{/* Main content */}</SidebarInset>
</SidebarProvider>
```

### Sidebar CSS Variables

```css
/* apps/dokploy/tailwind.config.ts (line 68-77) */

sidebar: {
  DEFAULT: "hsl(var(--sidebar-background))",
  foreground: "hsl(var(--sidebar-foreground))",
  primary: "hsl(var(--sidebar-primary))",
  "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
  accent: "hsl(var(--sidebar-accent))",
  "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
  border: "hsl(var(--sidebar-border))",
  ring: "hsl(var(--sidebar-ring))",
}
```

**Sidebar design**:

- **Width**: 16rem (256px) expanded, 3rem (48px) collapsed
- **Background**: Off-white (light) / dark gray (dark)
- **Keyboard shortcut**: Ctrl+B (or Cmd+B) to toggle
- **Mobile**: Collapses to drawer (18rem wide)
- **Persistence**: Sidebar state saved to cookie

---

## PART 7: DEPLOYMENT TABLE

### Deployments Table Structure

```tsx
// apps/dokploy/components/dashboard/deployments/show-deployments-table.tsx (line 97-150)

export function ShowDeploymentsTable() {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'createdAt', desc: true }]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });

  const { data: deploymentsList, isLoading } = api.deployment.allCentralized.useQuery(undefined, {
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  // Filter logic...

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Service</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Created</TableHead>
          {/* More columns */}
        </TableRow>
      </TableHeader>
      <TableBody>{/* Rows */}</TableBody>
    </Table>
  );
}
```

**Table design**:

- **Polling**: `refetchInterval: 5000` (updates every 5 seconds)
- **Sorting**: Default by `createdAt` descending (newest first)
- **Filtering**: Global search + status filter + type filter
- **Pagination**: 50 items per page
- **Status badges**: Use color variants (green, yellow, red)

---

## PART 8: EMPTY STATES

### Empty Projects State

```tsx
// apps/dokploy/components/dashboard/projects/show.tsx (line 285-292)

{
  filteredProjects?.length === 0 && (
    <div className="mt-6 flex h-[50vh] w-full flex-col items-center justify-center space-y-4">
      <FolderInput className="size-8 self-center text-muted-foreground" />
      <span className="text-center font-medium text-muted-foreground">No projects found</span>
    </div>
  );
}
```

**Empty state pattern**:

- **Height**: `h-[50vh]` (50% of viewport)
- **Centering**: `flex items-center justify-center`
- **Icon**: `size-8` (32px), `text-muted-foreground` (gray)
- **Text**: `font-medium text-muted-foreground` (secondary)
- **Spacing**: `space-y-4` (16px between icon and text)

### Loading State

```tsx
// apps/dokploy/components/dashboard/projects/show.tsx (line 227-231)

{isPending ? (
  <div className="flex flex-row gap-2 items-center justify-center text-sm text-muted-foreground min-h-[60vh]">
    <span>Loading...</span>
    <Loader2 className="animate-spin size-4" />
  </div>
) : (
  // Content
)}
```

**Loading pattern**:

- **Spinner**: `<Loader2 className="animate-spin size-4" />`
- **Text**: `text-sm text-muted-foreground`
- **Layout**: Horizontal flex with gap
- **Min height**: `min-h-[60vh]` (consistent with content area)

---

## PART 9: FORM & INPUT PATTERNS

### Search Input with Icon

```tsx
// apps/dokploy/components/dashboard/projects/show.tsx (line 234-244)

<div className="flex-1 relative max-sm:w-full">
  <FocusShortcutInput
    placeholder="Filter projects..."
    value={searchQuery}
    onChange={(e) => setSearchQuery(e.target.value)}
    className="pr-10"
  />
  <Search className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
</div>
```

**Search pattern**:

- **Container**: `relative` (for absolute icon positioning)
- **Input**: `pr-10` (padding-right for icon)
- **Icon**: `absolute right-3 top-1/2 -translate-y-1/2` (centered vertically, 12px from right)
- **Icon color**: `text-muted-foreground` (gray)
- **Icon size**: `size-4` (16px)

### Select Dropdown

```tsx
// apps/dokploy/components/dashboard/projects/show.tsx (line 257-282)

<div className="flex items-center gap-2 min-w-48 max-sm:w-full">
  <ArrowUpDown className="size-4 text-muted-foreground" />
  <Select value={sortBy} onValueChange={setSortBy}>
    <SelectTrigger className="w-full">
      <SelectValue placeholder="Sort by..." />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="name-asc">Name (A-Z)</SelectItem>
      <SelectItem value="name-desc">Name (Z-A)</SelectItem>
      <SelectItem value="createdAt-desc">Newest first</SelectItem>
      <SelectItem value="createdAt-asc">Oldest first</SelectItem>
      <SelectItem value="services-desc">Most services</SelectItem>
      <SelectItem value="services-asc">Least services</SelectItem>
    </SelectContent>
  </Select>
</div>
```

**Select pattern**:

- **Container**: `flex items-center gap-2` (icon + select)
- **Icon**: `size-4 text-muted-foreground` (small, gray)
- **Select**: `w-full` (fills container)
- **Min width**: `min-w-48` (192px minimum)
- **Responsive**: `max-sm:w-full` (full width on mobile)

---

## PART 10: CARD COMPONENT PRIMITIVES

### Card Base

```tsx
// apps/dokploy/components/ui/card.tsx

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)}
      {...props}
    />
  ),
);
```

**Card styling**:

- **Border radius**: `rounded-lg` (8px)
- **Border**: `border` (1px, color from CSS variable)
- **Background**: `bg-card` (white in light mode)
- **Shadow**: `shadow-sm` (subtle, not prominent)
- **Text color**: `text-card-foreground` (dark text)

### CardHeader

```tsx
const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
  ),
);
```

**CardHeader styling**:

- **Layout**: `flex flex-col` (vertical stack)
- **Spacing**: `space-y-1.5` (6px between children)
- **Padding**: `p-6` (24px)

### CardTitle

```tsx
const CardTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('text-2xl font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  ),
);
```

**CardTitle styling**:

- **Size**: `text-2xl` (28px)
- **Weight**: `font-semibold` (600)
- **Line height**: `leading-none` (1)
- **Letter spacing**: `tracking-tight` (-0.02em)

### CardDescription

```tsx
const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
));
```

**CardDescription styling**:

- **Size**: `text-sm` (14px)
- **Color**: `text-muted-foreground` (gray)

### CardContent

```tsx
const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
  ),
);
```

**CardContent styling**:

- **Padding**: `p-6 pt-0` (24px, but 0 on top to avoid double spacing)

---

## PART 11: TAILWIND CONFIGURATION

### Key Tailwind Extensions

```typescript
// apps/dokploy/tailwind.config.ts

const config = {
  darkMode: ['class'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', ...defaultTheme.fontFamily.sans],
      },
      screens: {
        '3xl': '1920px',
      },
      maxWidth: {
        '2xl': '40rem',
        '8xl': '85rem',
        '9xl': '95rem',
        '10xl': '105rem',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'caret-blink': {
          /* ... */
        },
        'accordion-down': {
          /* ... */
        },
        'accordion-up': {
          /* ... */
        },
      },
      animation: {
        'caret-blink': 'caret-blink 1.25s ease-out infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    require('fancy-ansi/plugin'),
    require('@tailwindcss/typography'),
  ],
};
```

**Key extensions**:

- **Font**: Inter (via CSS variable)
- **Screens**: 3xl breakpoint at 1920px
- **Max widths**: Extended for large layouts
- **Border radius**: Calculated from CSS variable (0.5rem base)
- **Animations**: Caret blink, accordion expand/collapse
- **Plugins**: Tailwind Animate, Fancy ANSI (for terminal output), Typography

---

## PART 12: DESIGN PRINCIPLES SUMMARY

### Information Hierarchy

1. **Primary**: Large, bold text (project name, stat values)
2. **Secondary**: Medium, gray text (descriptions, labels)
3. **Tertiary**: Small, muted text (timestamps, hints)
4. **Accent**: Semantic colors (status indicators, warnings)

### Spacing System

- **Base unit**: 4px (0.25rem)
- **Common gaps**: 4px, 8px, 12px, 16px, 20px, 24px, 32px
- **Card padding**: 24px (p-6)
- **Content padding**: 32px vertical (py-8)
- **Item gaps**: 16px (gap-4)

### Color Usage

- **Neutral**: 95% of UI (grays, blacks, whites)
- **Semantic**: 5% (emerald for success, amber for running, red for error, yellow for warning)
- **No accent colors** in primary UI — only in status indicators

### Typography

- **Font**: Inter (sans-serif)
- **Sizes**: 12px (xs), 14px (sm), 16px (base), 20px (lg), 28px (2xl), 32px (3xl)
- **Weights**: 400 (normal), 500 (medium), 600 (semibold), 700 (bold)
- **Line height**: Tight (1) for headings, normal (1.5) for body

### Interactions

- **Hover**: Subtle background color change (`hover:bg-border`, `hover:bg-accent`)
- **Active**: Scale down slightly (`active:hover:scale-[0.98]`)
- **Focus**: Ring outline (`focus-visible:ring-2`)
- **Disabled**: Reduced opacity (`disabled:opacity-50`)

### Responsive Design

- **Mobile first**: Single column, full width
- **Tablet (lg)**: 2 columns, sidebar visible
- **Desktop (xl)**: 3+ columns, full layout
- **Large screens (2xl, 3xl)**: 4-5 columns, max widths applied

---

## PART 13: WHAT MAKES IT "CLEAN & INTUITIVE"

### 1. **Minimal Visual Noise**

- No gradients, shadows are subtle (`shadow-sm`)
- Borders are light gray, not dark
- Icons are muted (`text-muted-foreground`)
- No animations except on interaction

### 2. **Clear Information Hierarchy**

- Project name is large and bold
- Description is smaller and grayed
- Tags are small and colored
- Warnings use semantic colors (yellow, not red)

### 3. **Generous Whitespace**

- Cards have `p-6` (24px) padding
- Content has `py-8` (32px) vertical padding
- Items have `gap-4` (16px) spacing
- Grid has `gap-5` (20px) between cards

### 4. **Semantic Color System**

- Green (emerald) = success/running
- Amber = in-progress
- Red = error/failure
- Yellow = warning
- Gray = neutral/disabled

### 5. **Consistent Component Patterns**

- All cards use same styling
- All buttons use same variants
- All badges use same color system
- All inputs use same styling

### 6. **Progressive Disclosure**

- Main info visible (name, description)
- Secondary info in dropdown menu
- Detailed info in separate pages
- Warnings only shown when relevant

### 7. **Responsive & Accessible**

- Mobile-first design
- Keyboard shortcuts (Ctrl+B for sidebar)
- Focus rings on interactive elements
- ARIA labels on icons

---

## IMPLEMENTATION CHECKLIST FOR OPENLANDER

To match Dokploy's "clean and intuitive" feel:

- [ ] Use neutral color palette (grays, blacks, whites)
- [ ] Apply generous padding (p-6 for cards, py-8 for content)
- [ ] Use subtle shadows (`shadow-sm`, not `shadow-lg`)
- [ ] Implement semantic status colors (emerald, amber, red, yellow)
- [ ] Keep icons muted (`text-muted-foreground`)
- [ ] Use HSL CSS variables for dark mode support
- [ ] Implement responsive grid (1 → 2 → 3 → 4 → 5 columns)
- [ ] Add keyboard shortcuts (Ctrl+B for sidebar toggle)
- [ ] Use subtle hover effects (`hover:bg-border`, `hover:bg-accent`)
- [ ] Implement progressive disclosure (dropdowns, modals)
- [ ] Add loading states with spinners
- [ ] Show empty states with icons and text
- [ ] Use consistent card styling throughout
- [ ] Implement custom scrollbars for logs
- [ ] Add focus rings for accessibility

---

**Analysis Complete**  
All code snippets are from Dokploy's actual source code (github.com/Dokploy/dokploy).
