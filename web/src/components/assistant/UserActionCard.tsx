import { AlertTriangle, X } from 'lucide-react';

interface UserActionCardProps {
  category: string;
  message: string;
  detail?: string;
  locale: string;
  onDismiss?: () => void;
}

export function UserActionCard({ category, message, detail, onDismiss }: UserActionCardProps) {
  return (
    <div className="relative flex gap-3 py-3 px-4 rounded-lg bg-warning/5 border border-warning/20 animate-in fade-in slide-in-from-top-2 duration-300 mb-4">
      {/* Icon */}
      <div className="shrink-0 mt-0.5">
        <div className="p-1 rounded-md bg-warning/15">
          <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[10px] font-mono text-warning uppercase tracking-wider px-1.5 py-0.5 rounded bg-warning/10 border border-warning/20">
            {category}
          </span>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="text-muted-ol hover:text-secondary-ol transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <p className="text-sm font-body text-primary-ol leading-snug">{message}</p>
        {detail && (
          <p className="text-xs font-body text-secondary-ol mt-1 whitespace-pre-wrap">{detail}</p>
        )}
      </div>
    </div>
  );
}
