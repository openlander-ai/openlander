import * as React from 'react';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface PageEmptyStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
  icon?: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}

/**
 * Standard empty-state box. Dashed bordered card with centered icon +
 * title + optional description + optional action. Matches the pattern
 * that was previously copy-pasted across Ops tabs (approvals, usage,
 * postmortems, patterns) and MainFeedGrid.
 */
export const PageEmptyState = React.forwardRef<HTMLDivElement, PageEmptyStateProps>(
  ({ className, icon: Icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed border-[hsl(var(--border))] bg-bg-subtle/30 p-12 text-center',
        className,
      )}
      {...props}
    >
      {Icon && <Icon aria-hidden className="h-12 w-12 text-muted-foreground" />}
      <div className="space-y-1.5">
        <p className="text-lg font-medium text-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground max-w-md">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  ),
);
PageEmptyState.displayName = 'PageEmptyState';
