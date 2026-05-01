# Dokploy Visual Design Patterns

**Visual reference guide for UI/UX decisions**

---

## 🎨 Color Palette

### Light Mode

```
Background:     #FFFFFF (0 0% 100%)
Foreground:     #0A0A0A (240 10% 3.9%)
Primary:        #1A1A1A (240 5.9% 10%)
Secondary:      #F5F5F5 (240 4.8% 95.9%)
Muted:          #F5F5F5 (240 4.8% 95.9%)
Border:         #E5E5E5 (240 5.9% 90%)
Destructive:    #EF4444 (0 84.2% 50.2%)
```

### Dark Mode

```
Background:     #000000 (0 0% 0%)
Foreground:     #FAFAFA (0 0% 98%)
Primary:        #FAFAFA (0 0% 98%)
Secondary:      #262626 (240 3.7% 15.9%)
Muted:          #1A1A1A (240 4% 10%)
Border:         #262626 (240 3.7% 15.9%)
Destructive:    #EF4444 (0 84.2% 50.2%)
Sidebar:        #1A1A1A (240 5.9% 10%)
```

### Chart Colors

```
Teal:           #2D9B7F (173 58% 39%)
Orange:         #F97316 (12 76% 61%)
Blue:           #1E3A5F (197 37% 24%)
Yellow:         #FBBF24 (43 74% 66%)
Red-Orange:     #FB923C (27 87% 67%)
```

---

## 📐 Typography

### Font Family

- **Display/Body**: Inter (system fallback)
- **Code**: Monospace (CodeMirror, xterm)

### Font Sizes

- **Page Title**: 20px (text-xl)
- **Section Title**: 16px (text-lg)
- **Body**: 14px (text-sm)
- **Small**: 12px (text-xs)

### Font Weights

- **Bold**: 700 (titles, labels)
- **Semibold**: 600 (section headers)
- **Medium**: 500 (buttons, labels)
- **Regular**: 400 (body text)

---

## 🧩 Component Spacing

### Padding

```
p-2:  8px
p-3:  12px
p-4:  16px
p-6:  24px
p-8:  32px
```

### Gaps (between items)

```
gap-1:  4px
gap-2:  8px
gap-3:  12px
gap-4:  16px
gap-6:  24px
```

### Margins

```
m-2:  8px
m-4:  16px
m-6:  24px
```

---

## 🎯 Button Styles

### Default Button

```
Background:     Primary color
Text:           White
Padding:        10px 16px (h-10 px-4)
Border Radius:  8px (rounded-lg)
Hover:          Primary/90 (darker)
Active:         Scale 0.98 (pressed effect)
Focus:          Ring 2px offset 2px
```

### Outline Button

```
Background:     Transparent
Border:         1px solid border color
Text:           Primary color
Hover:          Accent background
Focus:          Ring 2px offset 2px
```

### Ghost Button

```
Background:     Transparent
Text:           Primary color
Hover:          Accent background
Focus:          Ring 2px offset 2px
```

### Destructive Button

```
Background:     Red (#EF4444)
Text:           White
Hover:          Red/70 (darker)
Focus:          Ring 2px offset 2px
```

---

## 🎴 Card Layout

### Card Structure

```
┌─────────────────────────────────┐
│ Card (rounded-lg, shadow-sm)    │
│ ┌───────────────────────────────┤
│ │ CardHeader (p-6)              │
│ │ ┌─────────────────────────────┤
│ │ │ CardTitle (text-2xl)        │
│ │ │ CardDescription (text-sm)   │
│ │ └─────────────────────────────┤
│ ├───────────────────────────────┤
│ │ CardContent (p-6 pt-0)        │
│ │ [Content goes here]           │
│ ├───────────────────────────────┤
│ │ CardFooter (p-6 pt-0)         │
│ │ [Footer content]              │
│ └─────────────────────────────────┘
```

### Nested Card Pattern (Dashboard)

```
┌─────────────────────────────────┐
│ Outer Card (bg-sidebar p-2.5)   │
│ ┌───────────────────────────────┐
│ │ Inner Card (bg-background)    │
│ │ ┌─────────────────────────────┤
│ │ │ CardHeader                  │
│ │ │ CardContent                 │
│ │ └─────────────────────────────┤
│ └───────────────────────────────┘
└─────────────────────────────────┘
```

---

## 🗂️ Layout Structure

### Sidebar Layout

```
┌──────────────────────────────────────┐
│ Header (Logo, User Menu)             │
├──────────────────────────────────────┤
│ ┌────────┐ ┌──────────────────────┐  │
│ │Sidebar │ │ Main Content         │  │
│ │(256px) │ │ (flex-1)             │  │
│ │        │ │                      │  │
│ │ Nav    │ │ Page Content         │  │
│ │ Items  │ │                      │  │
│ │        │ │                      │  │
│ └────────┘ └──────────────────────┘  │
└──────────────────────────────────────┘
```

### Sidebar Collapsed

```
┌──────────────────────────────────────┐
│ Header                               │
├──────────────────────────────────────┤
│ ┌──┐ ┌──────────────────────────────┐│
│ │  │ │ Main Content (wider)         ││
│ │  │ │                              ││
│ │  │ │ Page Content                 ││
│ │  │ │                              ││
│ └──┘ └──────────────────────────────┘│
```

### Mobile Layout

```
┌──────────────────────┐
│ Header + Menu Icon   │
├──────────────────────┤
│                      │
│ Main Content         │
│ (full width)         │
│                      │
│                      │
└──────────────────────┘

[Sidebar as drawer overlay when menu opened]
```

---

## 🔍 Input Fields

### Text Input

```
┌─────────────────────────────────┐
│ Label                           │
│ ┌───────────────────────────────┤
│ │ Placeholder text              │
│ └───────────────────────────────┤
│ Error message (if any)          │
└─────────────────────────────────┘
```

### Input States

```
Default:    Border: #E5E5E5, Background: white
Hover:      Border: #D4D4D4
Focus:      Ring: 2px, Ring color: primary
Error:      Border: red, Error text below
Disabled:   Opacity: 50%, Cursor: not-allowed
```

---

## 📋 Form Layout

### Vertical Form

```
┌─────────────────────────────────┐
│ Label 1                         │
│ [Input field]                   │
│                                 │
│ Label 2                         │
│ [Input field]                   │
│                                 │
│ Label 3                         │
│ [Select dropdown]               │
│                                 │
│ [Submit Button]                 │
└─────────────────────────────────┘
```

### Horizontal Form (on desktop)

```
┌─────────────────────────────────────────┐
│ Label 1: [Input]  Label 2: [Input]      │
│                                         │
│ Label 3: [Select]  [Submit Button]      │
└─────────────────────────────────────────┘
```

---

## 📊 Data Table

### Table Structure

```
┌─────────────────────────────────────────┐
│ Column 1  │ Column 2  │ Column 3 │ ...  │
├─────────────────────────────────────────┤
│ Data 1    │ Data 2    │ Data 3   │ ...  │
├─────────────────────────────────────────┤
│ Data 1    │ Data 2    │ Data 3   │ ...  │
├─────────────────────────────────────────┤
│ Data 1    │ Data 2    │ Data 3   │ ...  │
└─────────────────────────────────────────┘
```

### Row Hover

```
Default:    Background: transparent
Hover:      Background: #F5F5F5 (light) or #1A1A1A (dark)
Selected:   Background: primary/10
```

---

## 🏷️ Badge & Status

### Badge Styles

```
Default:    Background: secondary, Text: secondary-foreground
Outline:    Border: 1px, Background: transparent
Destructive: Background: red, Text: white
Success:    Background: green, Text: white
```

### Status Indicators

```
Success:    Green circle + text
Error:      Red circle + text
Warning:    Yellow circle + text
Info:       Blue circle + text
Loading:    Spinner icon
```

---

## 🔔 Toast Notifications

### Toast Position

```
Top-right corner (default)
Auto-dismiss after 3-5 seconds
```

### Toast Types

```
Success:    Green background, checkmark icon
Error:      Red background, X icon
Info:       Blue background, info icon
Warning:    Yellow background, warning icon
```

---

## 🎬 Animations

### Transitions

```
Duration:   200-300ms
Easing:     ease-out (default)
Properties: background-color, opacity, transform
```

### Button Interactions

```
Hover:      Background color change (200ms)
Active:     Scale 0.98 (100ms)
Focus:      Ring appears (instant)
```

### Sidebar Toggle

```
Collapse:   Width animation (300ms)
Mobile:     Slide in from left (300ms)
```

### Accordion

```
Expand:     Height animation (200ms)
Collapse:   Height animation (200ms)
```

---

## 🌙 Dark Mode Transitions

### Color Inversion

```
Light → Dark:
  White → Black
  Dark text → Light text
  Light gray → Dark gray
  Borders: Subtle in both modes
```

### Smooth Transition

```
Duration:   300ms
Easing:     ease-in-out
All colors: Transition smoothly
```

---

## ♿ Focus States

### Keyboard Focus

```
All interactive elements:
  Ring: 2px solid primary
  Ring offset: 2px
  Visible on Tab key
```

### Focus Visible

```
Only show on keyboard navigation
Hide on mouse click
```

---

## 📱 Responsive Breakpoints

### Mobile (< 640px)

```
Full-width layouts
Single column
Sidebar → Drawer
Touch-friendly targets (44px min)
```

### Tablet (640px - 1024px)

```
Two-column layouts
Sidebar visible
Flexible spacing
```

### Desktop (> 1024px)

```
Multi-column layouts
Sidebar expanded
Max-width constraints
Optimal reading width
```

---

## 🎯 Visual Hierarchy

### Title

```
Font size:  20px (text-xl)
Font weight: 700 (bold)
Color:      Foreground
Margin:     24px bottom
```

### Subtitle/Description

```
Font size:  14px (text-sm)
Font weight: 400 (regular)
Color:      Muted-foreground
Margin:     8px bottom
```

### Body Text

```
Font size:  14px (text-sm)
Font weight: 400 (regular)
Color:      Foreground
Line height: 1.5
```

### Label

```
Font size:  14px (text-sm)
Font weight: 500 (medium)
Color:      Foreground
Margin:     8px bottom
```

---

## 🎨 Icon Usage

### Icon Sizes

```
Inline (with text):     16px (size-4)
Navigation items:       20px (size-5)
Page headers:           24px (size-6)
Large buttons:          32px (size-8)
```

### Icon Colors

```
Default:        Foreground color
Muted:          Muted-foreground color
Primary:        Primary color
Destructive:    Red color
Success:        Green color
```

---

## 📐 Spacing Rules

### Consistent Spacing

```
Between sections:   24px (gap-6)
Between items:      16px (gap-4)
Within component:   8px (gap-2)
Card padding:       24px (p-6)
```

### Whitespace

```
Generous whitespace for clarity
Breathing room around content
No cramped layouts
```

---

## 🎓 Design Checklist

- [ ] Use HSL variables for colors
- [ ] Maintain consistent spacing (Tailwind scale)
- [ ] Use shadcn/ui components
- [ ] Include clear visual hierarchy
- [ ] Ensure keyboard accessibility
- [ ] Test dark mode
- [ ] Check mobile responsiveness
- [ ] Minimize animations (functional only)
- [ ] Use Lucide icons consistently
- [ ] Provide clear error messages
- [ ] Show loading states
- [ ] Include focus indicators
- [ ] Test color contrast
- [ ] Use semantic HTML

---

**Last Updated**: April 21, 2026  
**Reference**: Dokploy commit 6fb4a13
