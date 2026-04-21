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
 * Unified empty-state for full-page/section placeholders (dokploy pattern).
 * Distinct from the agent-panel EmptyState which renders chat onboarding.
 */
export const PageEmptyState = React.forwardRef<HTMLDivElement, PageEmptyStateProps>(
  ({ className, icon: Icon, title, description, action, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex h-[50vh] w-full flex-col items-center justify-center gap-4 px-4 text-center',
        className,
      )}
      {...props}
    >
      {Icon && <Icon aria-hidden className="size-8 text-muted-foreground" />}
      <div className="space-y-1.5">
        <p className="font-medium text-muted-foreground">{title}</p>
        {description && <p className="text-sm text-muted-foreground/80">{description}</p>}
      </div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  ),
);
PageEmptyState.displayName = 'PageEmptyState';
