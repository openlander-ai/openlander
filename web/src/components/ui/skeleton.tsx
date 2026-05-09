import { cn } from '@/lib/utils';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-shimmer rounded-md bg-primary/10 bg-gradient-to-r from-transparent via-primary/5 to-transparent bg-[length:1000px_100%]',
        className,
      )}
      {...props}
    />
  );
}
