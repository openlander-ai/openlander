import { useId } from 'react';
import { cn } from '@/lib/utils';

export function AISparkle({
  className,
  ...props
}: React.SVGProps<SVGSVGElement> & { className?: string }) {
  const id = useId().replace(/:/g, '');
  const gradientId = `ai-sparkle-gradient-${id}`;

  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('ai-sparkle-glow', className)}
      {...props}
    >
      <defs>
        <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--sparkle-start, #6366f1)" />
          <stop offset="100%" stopColor="var(--sparkle-end, #f43f5e)" />
        </linearGradient>
      </defs>
      <path
        d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12Z"
        fill={`url(#${gradientId})`}
      />
    </svg>
  );
}
