import type { TimelineItem } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import { Wrench } from 'lucide-react';

interface DockerfileFixedCardProps {
  item: TimelineItem;
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}

export function DockerfileFixedCard({ item }: DockerfileFixedCardProps) {
  const retryCount = item.retryCount ?? 1;
  const changes = item.dockerfileChanges ?? [];

  return (
    <div
      className={cn(
        'relative flex gap-3 py-3 px-4 rounded-lg border transition-all duration-300',
        'animate-in fade-in slide-in-from-bottom-2',
        'bg-amber-50 border-amber-200',
      )}
    >
      {/* Icon */}
      <div className="shrink-0 mt-0.5">
        <div className="p-1.5 rounded-md bg-amber-100">
          <Wrench className="h-3.5 w-3.5 text-amber-700" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-medium text-amber-800">
            Dockerfile Fixed (attempt {retryCount}/3)
          </p>
          <span className="text-[10px] font-mono text-amber-600 shrink-0 mt-0.5">
            {formatTime(item.timestamp)}
          </span>
        </div>

        {changes.length > 0 && (
          <ul className="mt-1.5 space-y-0.5">
            {changes.map((change, i) => (
              <li key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                <span className="text-amber-400 mt-0.5">•</span>
                <span>{change}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="mt-1.5 text-[11px] text-amber-600">
          Retrying build with corrected Dockerfile...
        </p>
      </div>
    </div>
  );
}
