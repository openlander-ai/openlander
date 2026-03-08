import { useState } from 'react';
import { FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';

interface PostmortemCardProps {
  projectId: string;
  projectName: string;
  markdown: string;
  generatedAt: string;
}

export function PostmortemCard({ markdown, generatedAt }: PostmortemCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={cn(
        'relative flex flex-col gap-3 py-3 px-4 rounded-lg border transition-all duration-300',
        'animate-in fade-in slide-in-from-bottom-2',
        'bg-agent/5 border-agent/15',
      )}
    >
      <div className="flex gap-3 items-start">
        {/* Icon */}
        <div className="shrink-0 mt-0.5">
          <div className="p-1 rounded-md bg-agent/15">
            <FileText className="h-3.5 w-3.5 text-agent" />
          </div>
        </div>

        {/* Header Content */}
        <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
          <div className="flex flex-col">
            <p className="text-sm font-body leading-snug text-primary-ol">Postmortem available</p>
            <p className="text-xs font-body text-secondary-ol leading-relaxed">
              AI analysis of the recent recovery
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-muted-ol shrink-0">
              {formatTime(generatedAt)}
            </span>
            <button
              onClick={() => setExpanded(!expanded)}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-body border transition-colors',
                'bg-agent/10 hover:bg-agent/20 border-agent/20 text-agent',
              )}
            >
              {expanded ? 'Hide' : 'View'}
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
          </div>
        </div>
      </div>

      {/* Expanded Content */}
      {expanded && (
        <div className="mt-2 pl-9 pr-2 pb-2 animate-in slide-in-from-top-2 fade-in duration-200">
          <div className="bg-bg-subtle/50 border border-white/5 rounded-md p-4 overflow-x-auto">
            <pre className="text-xs font-mono text-secondary-ol whitespace-pre-wrap break-words">
              {markdown}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}
