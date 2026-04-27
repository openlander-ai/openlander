# Shell Motion Grammar

v4 motion primitives are restrained. These rules apply to ALL Shell components.

## Rules

1. **Max duration**: 200ms. No easing longer than 200ms.
2. **Properties**: `opacity` and `transform` only. No `color` transitions, no `box-shadow` pulses, no `background-color` animations.
3. **No spring physics**. CSS `transition` only — no spring-based easing.
4. **Reduced-motion**: Every `animation:` and `transition:` declaration must have a `@media (prefers-reduced-motion: reduce)` counterpart that sets `animation: none` / `transition: none`.

## Inventory

| Component                       | Motion                             | Duration | Reduced-motion            |
| ------------------------------- | ---------------------------------- | -------- | ------------------------- |
| InfraMap (crashed node pulse)   | `ol-node-pulse` scale+opacity      | 1.4s     | `animation: none` in CSS  |
| InfraMap (alert edge dash flow) | `ol-edge-flow` stroke-dashoffset   | 1.6s     | `animation: none` in CSS  |
| InfraMap (popover entrance)     | `ol-popover-in` opacity+translateY | 0.12s    | `animation: none` in CSS  |
| LogViewer (progress bar fill)   | `width 0.18s linear`               | 0.18s    | `transition: none` in CSS |

## Violations to avoid

- `transition: color` — removes the no-color-transition rule
- `box-shadow` animations — v2 leftover, not in v4
- any `animation-duration > 200ms` for interactive feedback (the crash pulse is an ambient indicator, exception granted)
