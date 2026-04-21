import * as React from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface LoadingStateProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: React.ReactNode;
  fullHeight?: boolean;
}

/**
 * Inline loading state — dokploy pattern. Pairs a small muted spinner with
 * optional label text. Use `fullHeight` when placing inside a 60vh content
 * area that expects its own vertical center.
 */
export const LoadingState = React.forwardRef<HTMLDivElement, LoadingStateProps>(
  ({ className, label, fullHeight = false, ...props }, ref) => (
    <div
      ref={ref}
      role="status"
      className={cn(
        'flex flex-row items-center justify-center gap-2 text-sm text-muted-foreground',
        fullHeight && 'min-h-[60vh]',
        className,
      )}
      {...props}
    >
      {label && <span>{label}</span>}
      <Loader2 aria-hidden className="size-4 animate-spin" />
    </div>
  ),
);
LoadingState.displayName = 'LoadingState';
