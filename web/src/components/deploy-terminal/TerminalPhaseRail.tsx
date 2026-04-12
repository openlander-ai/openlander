import { cn } from '@/lib/utils';
import { terminalTokens } from './terminal-tokens';

export type PhaseState = 'pending' | 'active' | 'done' | 'error' | 'skip';

export interface Phase {
  id: string;
  label: string;
  state: PhaseState;
}

export interface TerminalPhaseRailProps {
  phases: Phase[];
  className?: string;
}

export function TerminalPhaseRail({ phases, className }: TerminalPhaseRailProps) {
  return (
    <div
      className={cn('flex flex-col gap-3 py-4 px-4 shrink-0', className)}
      style={{
        backgroundColor: terminalTokens.colors.surface,
        borderRight: `1px solid ${terminalTokens.colors.border}`,
        fontFamily: terminalTokens.typography.fontFamily,
      }}
    >
      {phases.map((phase, index) => {
        const isLast = index === phases.length - 1;
        const color = terminalTokens.colors.glyph[phase.state];
        const isActive = phase.state === 'active';
        const isDone = phase.state === 'done';

        return (
          <div key={phase.id} className="flex items-start gap-3 relative">
            <div className="flex flex-col items-center mt-1">
              <div
                className={cn('w-2 h-2 rounded-full z-10', isActive && 'animate-pulse')}
                style={{
                  backgroundColor: color,
                  boxShadow: isActive ? terminalTokens.effects.glow : 'none',
                }}
              />
              {!isLast && (
                <div
                  className="w-px h-full absolute top-3 bottom-[-12px]"
                  style={{
                    backgroundColor: isDone
                      ? terminalTokens.colors.glyph.done
                      : terminalTokens.colors.border,
                  }}
                />
              )}
            </div>
            <span
              className={cn('text-xs', isActive && 'font-bold')}
              style={{
                color: isActive
                  ? terminalTokens.colors.text.primary
                  : isDone
                    ? terminalTokens.colors.text.secondary
                    : terminalTokens.colors.text.muted,
              }}
            >
              {phase.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
