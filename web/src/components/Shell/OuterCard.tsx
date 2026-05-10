/**
 * OuterCard — Shell V2 primitive.
 *
 * The outer "card frame" that wraps every page body. Same shape across
 * every route — mechanism M2 (Single Outer-Card Content Frame).
 *
 * Linear/Vercel tone: titles carry weight, no painted square accents.
 * If a leading glyph is desired, render it inside the `title` ReactNode
 * (e.g. `title={<><Bot className="..." /> MCP Server</>}`) — there is no
 * dedicated `icon` prop on purpose.
 */
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface OuterCardProps {
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned actions slot (e.g. "View all" buttons, status pills) */
  actions?: ReactNode;
  /** Hide the bottom border under the header */
  divider?: boolean;
  /** Remove the body padding for full-bleed children (e.g. log viewer) */
  fullBleed?: boolean;
  className?: string;
  bodyClassName?: string;
  children?: ReactNode;
}

export function OuterCard({
  title,
  subtitle,
  actions,
  divider = true,
  fullBleed = false,
  className,
  bodyClassName,
  children,
}: OuterCardProps) {
  const hasHeader = title != null || actions != null;
  return (
    <section
      className={cn(
        'rounded-[var(--ol-radius)] border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel)]',
        'shadow-[0_1px_0_color-mix(in_oklch,var(--ol-border-subtle)_70%,transparent)]',
        className,
      )}
    >
      {hasHeader && (
        <header
          className={cn(
            'flex items-start gap-4 px-5 py-4',
            divider && 'border-b border-[color:var(--ol-border-subtle)]',
          )}
        >
          <div className="min-w-0 flex-1">
            {title != null && (
              <h2 className="text-[15px] font-semibold leading-tight text-[color:var(--ol-fg)]">
                {title}
              </h2>
            )}
            {subtitle != null && (
              <p className="mt-1 text-[13px] leading-snug text-[color:var(--ol-fg-muted)]">
                {subtitle}
              </p>
            )}
          </div>
          {actions != null && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(fullBleed ? '' : 'p-5', bodyClassName)}>{children}</div>
    </section>
  );
}

export default OuterCard;
