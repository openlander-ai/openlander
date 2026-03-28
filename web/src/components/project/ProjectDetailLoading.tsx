import { Skeleton } from '@/components/ui/skeleton';

export function ProjectDetailLoading() {
  return (
    <div className="flex flex-col h-full">
      <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Skeleton className="h-3 w-3 rounded-full" />
            <div>
              <Skeleton className="h-6 w-48 mb-2" />
              <div className="flex items-center gap-3">
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-7" />
          </div>
        </div>
      </div>
      <div className="flex-1 p-4">
        <Skeleton className="h-10 w-full max-w-md mb-4" />
        <Skeleton className="h-[600px] w-full rounded-lg" />
      </div>
    </div>
  );
}
