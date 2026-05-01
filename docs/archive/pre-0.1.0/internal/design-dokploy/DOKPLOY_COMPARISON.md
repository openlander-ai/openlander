# DOKPLOY vs OPENLANDER: UI COMPARISON FRAMEWORK

## Why Dokploy Feels "Clean & Intuitive"

### 1. MINIMAL COLOR PALETTE

**Dokploy**: 95% neutral (grays, blacks, whites) + 5% semantic (emerald, amber, red, yellow)
**OpenLander**: Compare your current color usage. Are you using too many accent colors?

**Action**: Audit your dashboard. Count how many different colors appear. If > 10, you're using too many.

### 2. GENEROUS WHITESPACE

**Dokploy**:

- Card padding: `p-6` (24px)
- Content padding: `py-8` (32px)
- Item gaps: `gap-4` (16px)
- Grid gaps: `gap-5` (20px)

**OpenLander**: Check your current spacing. Is it tighter? Increase padding by 50%.

**Action**: Update all cards to use `p-6` instead of `p-4`. Update content areas to use `py-8` instead of `py-4`.

### 3. SUBTLE SHADOWS

**Dokploy**: `shadow-sm` (0 1px 2px 0 rgba(0, 0, 0, 0.05))
**OpenLander**: If using `shadow-lg` or `shadow-xl`, reduce to `shadow-sm`.

**Action**: Replace all `shadow-lg` with `shadow-sm`. Remove `shadow-xl` entirely.

### 4. SEMANTIC STATUS COLORS

**Dokploy**:

```
Success:  Emerald 500  (bg-emerald-500)
Running:  Amber 500    (bg-amber-500)
Error:    Red 500      (bg-red-500)
Warning:  Yellow 50    (bg-yellow-50)
Idle:     Muted/40     (bg-muted-foreground/40)
```

**OpenLander**: Are your status colors consistent? Do they mean the same thing everywhere?

**Action**: Create a status color map. Use it everywhere. No exceptions.

### 5. MUTED ICONS

**Dokploy**: All icons use `text-muted-foreground` (gray) unless they're status indicators.
**OpenLander**: Are your icons colored? Make them gray.

**Action**: Replace all colored icons with `text-muted-foreground`. Only use color for status dots.

### 6. CONSISTENT COMPONENT PATTERNS

**Dokploy**: Every card, button, badge, input follows the same pattern.
**OpenLander**: Are your components inconsistent? Standardize them.

**Action**: Create a component library. Use it everywhere. No custom styling.

### 7. PROGRESSIVE DISCLOSURE

**Dokploy**: Main info visible → Secondary info in dropdowns → Detailed info in separate pages.
**OpenLander**: Are you showing too much info at once? Hide secondary info.

**Action**: Move secondary actions to dropdown menus. Move detailed info to separate pages.

---

## SPECIFIC IMPROVEMENTS FOR OPENLANDER

### Dashboard Home Page

**Current**: Likely has too many cards, too much color, too tight spacing.
**Target**:

- 4-6 stat cards with `p-5 min-h-[140px]`
- Neutral colors (gray borders, white backgrounds)
- `gap-4` between cards
- Status indicators with semantic colors (emerald, amber, red)

### Projects List

**Current**: Likely has inconsistent card styling, colored icons, tight spacing.
**Target**:

- Responsive grid: 1 → 2 → 3 → 4 → 5 columns
- Cards with `bg-transparent hover:bg-border`
- `gap-5` between cards
- Muted icons (`text-muted-foreground`)
- Tags with custom colors (only visual accent)

### Deployment Logs

**Current**: Likely has bright background, thick scrollbar, no custom styling.
**Target**:

- Background: `bg-[#fafafa]` (light) / `dark:bg-[#050506]` (dark)
- Custom scrollbar: 8px wide, 30% opacity gray
- `p-4` padding
- `h-[720px]` fixed height

### Sidebar Navigation

**Current**: Likely has colored icons, inconsistent spacing, no keyboard shortcut.
**Target**:

- Width: 16rem (256px) expanded, 3rem (48px) collapsed
- Keyboard shortcut: Ctrl+B
- Muted icons
- Consistent spacing
- Saved state to cookie

### Buttons

**Current**: Likely has multiple button styles, inconsistent sizing, no press effect.
**Target**:

- Default: Dark gray background (`bg-primary`)
- Outline: Border + white background
- Ghost: No background, hover adds accent
- Sizes: sm (36px), default (40px), lg (44px), icon (40x40px)
- Press effect: `active:hover:scale-[0.98]`

### Forms & Inputs

**Current**: Likely has inconsistent styling, no icon support, tight spacing.
**Target**:

- Search input with icon: `relative` container, `pr-10` input, `absolute right-3 top-1/2 -translate-y-1/2` icon
- Select dropdown: `flex items-center gap-2` with icon
- Consistent border color: `border-input`
- Consistent padding: `px-3 py-2`

### Empty States

**Current**: Likely has no empty state, or a generic message.
**Target**:

- Icon: `size-8 text-muted-foreground`
- Text: `text-center font-medium text-muted-foreground`
- Container: `flex h-[50vh] w-full flex-col items-center justify-center space-y-4`

### Loading States

**Current**: Likely has no loading state, or a generic spinner.
**Target**:

- Spinner: `<Loader2 className="animate-spin size-4" />`
- Text: `text-sm text-muted-foreground`
- Container: `flex flex-row gap-2 items-center justify-center`

---

## IMPLEMENTATION ROADMAP

### Phase 1: Foundation (Week 1)

- [ ] Update CSS variables to match Dokploy's HSL values
- [ ] Update Tailwind config with Dokploy's extensions
- [ ] Update card component styling (p-6, shadow-sm)
- [ ] Update button component styling (variants, sizes, press effect)
- [ ] Update badge component styling (status colors)

### Phase 2: Components (Week 2)

- [ ] Update all icons to use `text-muted-foreground`
- [ ] Update all inputs to use consistent styling
- [ ] Update all selects to use consistent styling
- [ ] Create empty state component
- [ ] Create loading state component

### Phase 3: Pages (Week 3)

- [ ] Update dashboard home page (stat cards, spacing)
- [ ] Update projects list page (grid, cards, spacing)
- [ ] Update deployment logs (background, scrollbar, height)
- [ ] Update sidebar navigation (width, keyboard shortcut, spacing)
- [ ] Update all other pages to use new patterns

### Phase 4: Polish (Week 4)

- [ ] Add keyboard shortcuts (Ctrl+B for sidebar)
- [ ] Add focus rings to all interactive elements
- [ ] Add hover effects to all interactive elements
- [ ] Test on mobile, tablet, desktop, large screens
- [ ] Test dark mode
- [ ] Get user feedback

---

## QUICK WINS (Do These First)

1. **Update card padding**: `p-4` → `p-6` (24px)
2. **Update content padding**: `py-4` → `py-8` (32px)
3. **Update shadows**: `shadow-lg` → `shadow-sm`
4. **Update icon colors**: All icons → `text-muted-foreground`
5. **Update status colors**: Use semantic colors (emerald, amber, red, yellow)
6. **Update grid gaps**: `gap-4` → `gap-5` (20px)
7. **Update button press effect**: Add `active:hover:scale-[0.98]`
8. **Update empty states**: Add icon + text pattern
9. **Update loading states**: Add spinner + text pattern
10. **Update sidebar**: Add keyboard shortcut (Ctrl+B)

---

## MEASUREMENT FRAMEWORK

### Before

- [ ] Screenshot current dashboard
- [ ] Count colors used
- [ ] Measure padding/spacing
- [ ] Count shadow variants
- [ ] Count button variants
- [ ] Count icon colors

### After

- [ ] Screenshot updated dashboard
- [ ] Count colors used (should be < 10)
- [ ] Measure padding/spacing (should be p-6, py-8, gap-4, gap-5)
- [ ] Count shadow variants (should be 1: shadow-sm)
- [ ] Count button variants (should be 4: default, outline, ghost, destructive)
- [ ] Count icon colors (should be 1: text-muted-foreground)

### User Feedback

- [ ] Does it feel "cleaner"?
- [ ] Is it easier to scan?
- [ ] Is the information hierarchy clear?
- [ ] Are the status colors intuitive?
- [ ] Is the spacing comfortable?

---

## COMMON MISTAKES TO AVOID

1. **Too many colors**: Stick to neutral + 5 semantic colors
2. **Too tight spacing**: Use p-6, py-8, gap-4, gap-5
3. **Too large shadows**: Use shadow-sm only
4. **Colored icons**: Keep them muted (text-muted-foreground)
5. **Inconsistent buttons**: Use 4 variants (default, outline, ghost, destructive)
6. **No empty states**: Always show empty state with icon + text
7. **No loading states**: Always show loading state with spinner + text
8. **No keyboard shortcuts**: Add Ctrl+B for sidebar toggle
9. **No focus rings**: Add focus-visible:ring-2 to all interactive elements
10. **No hover effects**: Add hover:bg-border or hover:bg-accent to all interactive elements

---

## RESOURCES

- **Full Analysis**: docs/DOKPLOY_UI_ANALYSIS.md
- **Quick Reference**: docs/DOKPLOY_UI_QUICK_REFERENCE.md
- **Source Code**: github.com/Dokploy/dokploy (apps/dokploy)
- **Tailwind Docs**: tailwindcss.com
- **shadcn/ui**: ui.shadcn.com

---

**Last Updated**: April 21, 2026
**Status**: Ready for implementation
