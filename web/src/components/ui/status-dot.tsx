import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const statusDotVariants = cva('inline-block rounded-full shrink-0', {
  variants: {
    status: {
      success: 'bg-emerald-500',
      running: 'bg-amber-500',
      warning: 'bg-yellow-500',
      error: 'bg-red-500',
      idle: 'bg-muted-foreground/40',
      unknown: 'bg-muted-foreground/40',
    },
    size: {
      sm: 'h-1.5 w-1.5',
      default: 'h-2 w-2',
      lg: 'h-2.5 w-2.5',
    },
  },
  defaultVariants: {
    status: 'idle',
    size: 'default',
  },
});

export interface StatusDotProps
  extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof statusDotVariants> {}

/**
 * Static status dot. No pulse/glow by default — dokploy pattern.
 * If animation is truly required for attention, apply it via className.
 */
export const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(
  ({ className, status, size, ...props }, ref) => (
    <span
      ref={ref}
      aria-hidden
      className={cn(statusDotVariants({ status, size }), className)}
      {...props}
    />
  ),
);
StatusDot.displayName = 'StatusDot';

export { statusDotVariants };
