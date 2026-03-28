import { cn } from '@/lib/utils';

export function AISparkle({
  className,
  ...props
}: React.SVGProps<SVGSVGElement> & { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={cn('ai-sparkle-glow', className)}
      {...props}
    >
      <path
        d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12Z"
        fill="currentColor"
      />
    </svg>
  );
}
