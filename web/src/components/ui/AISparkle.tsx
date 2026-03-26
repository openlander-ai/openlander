import { useId } from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

export function AISparkle({
  className,
  ...props
}: { className?: string } & React.ComponentProps<typeof Sparkles>) {
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
      <Sparkles
        className={cn('ai-sparkle-glow', className)}
        style={{ stroke: `url(#${gradientId})` }}
        {...props}
      />
    </>
  );
}
