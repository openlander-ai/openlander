import { cn } from '@/lib/utils';
import { terminalTokens } from './terminal-tokens';

export interface TerminalHeaderProps {
  projectName: string;
  branchName?: string;
  elapsedTime?: string;
  subtitle?: string;
  status?: 'pending' | 'active' | 'done' | 'error' | 'skip';
  className?: string;
}

export function TerminalHeader({
  projectName,
  branchName,
  elapsedTime,
  subtitle,
  status = 'active',
  className,
}: TerminalHeaderProps) {
  return (
    <div
      className={cn('flex items-center justify-between px-4 py-3 border-b shrink-0', className)}
      style={{
        backgroundColor: terminalTokens.colors.surface,
        borderColor: terminalTokens.colors.border,
        fontFamily: terminalTokens.typography.fontFamily,
      }}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <span
            className="font-bold text-[13px]"
            style={{ color: terminalTokens.colors.text.primary }}
          >
            {projectName}
          </span>
          {branchName && (
            <span
              className="px-1.5 py-0.5 rounded text-xs font-medium"
              style={{
                backgroundColor: terminalTokens.colors.background,
                color: terminalTokens.colors.text.secondary,
                border: `1px solid ${terminalTokens.colors.border}`,
              }}
            >
              {branchName}
            </span>
          )}
        </div>
        {subtitle && (
          <>
            <span className="text-[13px]" style={{ color: terminalTokens.colors.text.muted }}>
              /
            </span>
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  backgroundColor: terminalTokens.colors.glyph[status],
                  boxShadow: status === 'active' ? terminalTokens.effects.glow : 'none',
                }}
              />
              <span className="text-xs" style={{ color: terminalTokens.colors.text.secondary }}>
                {subtitle}
              </span>
            </div>
          </>
        )}
      </div>

      {elapsedTime && (
        <div
          className="text-xs font-medium tabular-nums"
          style={{ color: terminalTokens.colors.text.muted }}
        >
          {elapsedTime}
        </div>
      )}
    </div>
  );
}
