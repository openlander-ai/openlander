import type { TimelineItem } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';
import {
  CheckCircle2,
  LayoutList,
  ScrollText,
  Activity,
  KeyRound,
  Wrench,
  RotateCcw,
  Layers,
} from 'lucide-react';
import { getRendererForTool } from '../shared/ToolResultRenderers';

interface ToolResultCardProps {
  item: TimelineItem;
}

export function ToolResultCard({ item }: ToolResultCardProps) {
  const isSuccess = item.toolSuccess !== false; // Default to true if undefined
  const toolName = item.toolName || 'unknown_tool';

  const bgClass = isSuccess ? 'bg-agent/5' : 'bg-error/5';
  const borderClass = isSuccess ? 'border-agent/10' : 'border-error/10';
  const iconColorClass = isSuccess ? 'text-agent' : 'text-error';
  const iconBgClass = isSuccess ? 'bg-agent/10' : 'bg-error/10';

  let Icon = Wrench;
  const Renderer = getRendererForTool(toolName);

  switch (toolName) {
    case 'deploy_project':
      Icon = CheckCircle2;
      break;
    case 'deploy_compose':
      Icon = Layers;
      break;
    case 'rollback_project':
      Icon = RotateCcw;
      break;
    case 'fix_dockerfile':
      Icon = Wrench;
      break;
    case 'list_projects':
      Icon = LayoutList;
      break;
    case 'get_logs':
      Icon = ScrollText;
      break;
    case 'get_system_stats':
      Icon = Activity;
      break;
    case 'set_env_vars':
      Icon = KeyRound;
      break;
  }

  if (!isSuccess) {
    Icon = Wrench; // Override icon for errors
  }

  return (
    <div
      className={cn(
        'relative flex gap-3 py-3 px-4 rounded-lg border transition-all duration-300',
        'animate-in fade-in slide-in-from-bottom-2',
        bgClass,
        borderClass,
      )}
    >
      {/* Icon */}
      <div className="shrink-0 mt-0.5">
        <div className={cn('p-1.5 rounded-md', iconBgClass)}>
          <Icon className={cn('h-3.5 w-3.5', iconColorClass)} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm font-medium font-body leading-snug',
              isSuccess ? 'text-agent/90' : 'text-error',
            )}
          >
            {item.title || `${toolName} result`}
          </p>
          <span className="text-xs font-mono text-muted-foreground shrink-0 mt-0.5">
            {formatTime(item.timestamp)}
          </span>
        </div>

        {!isSuccess && item.toolError && (
          <p className="mt-1 text-xs font-mono text-error/80 whitespace-pre-wrap break-all">
            {item.toolError}
          </p>
        )}

        {isSuccess && item.toolResult !== undefined && item.toolResult !== null ? (
          <Renderer result={item.toolResult} />
        ) : null}
      </div>
    </div>
  );
}
