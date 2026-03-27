import { useId } from 'react';
import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AISparkle({
  className,
  ...props
}: { className?: string } & React.ComponentProps<typeof Star>) {
  const id = useId().replace(/:/g, '');
  const gradientId = `ai-sparkle-gradient-${id}`;

  return (
    <>
      <svg width="0" height="0" className="absolute" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a855f7" />
            <stop offset="100%" stopColor="#f43f5e" />
          </linearGradient>
        </defs>
      </svg>
      <Star
        className={cn('ai-sparkle-glow', className)}
        style={{
          fill: `url(#${gradientId})`,
          stroke: `url(#${gradientId})`,
        }}
        {...props}
      />
    </>
  );
}
