import type { ReactNode } from 'react';

interface PageHeaderProps {
  /** Main page title. Rendered as h1. */
  title: ReactNode;
  /** Optional subtext under the title (counts, short description). */
  description?: ReactNode;
  /** Optional action buttons rendered on the right. */
  actions?: ReactNode;
  /** Optional slot rendered below the title row (filters, secondary tabs). */
  children?: ReactNode;
}

/**
 * Unified full-width header bar for top-level pages. Mirrors the
 * ProjectHeader pattern so sidebar-adjacent pages share one visual
 * language: bg-bg-panel + border-b, flush against the app sidebar's
 * right edge, no outer padding outside the bar.
 */
export function PageHeader({ title, description, actions, children }: PageHeaderProps) {
  return (
    <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel px-6 py-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display font-bold text-lg text-foreground tracking-tight truncate">
            {title}
          </h1>
          {description && (
            <p className="text-xs font-body text-muted-foreground mt-0.5">{description}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}
