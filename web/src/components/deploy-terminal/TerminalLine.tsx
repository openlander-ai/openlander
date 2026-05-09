import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { terminalTokens } from './terminal-tokens';
import type { TerminalColor, TerminalGlyphState } from './terminal-tokens';

export interface TerminalLineProps {
  children: ReactNode;
  glyph?: ReactNode;
  glyphState?: TerminalGlyphState;
  time?: string;
  textColor?: TerminalColor;
  className?: string;
}

export function TerminalLine({
  children,
  glyph,
  glyphState = 'pending',
  time,
  textColor = 'primary',
  className,
}: TerminalLineProps) {
  return (
    <div
      className={cn('flex items-start gap-3 py-0.5 group', className)}
      style={{ fontFamily: terminalTokens.typography.fontFamily }}
    >
      {time && (
        <div
          className="shrink-0 w-16 text-xs pt-[2px] opacity-70 group-hover:opacity-100 transition-opacity"
          style={{ color: terminalTokens.colors.text.muted }}
        >
          {time}
        </div>
      )}

      <div
        className="shrink-0 w-4 flex justify-center pt-[2px] text-[13px]"
        style={{ color: terminalTokens.colors.glyph[glyphState] }}
      >
        {glyph || (
          <span className={cn(glyphState === 'active' && 'animate-pulse')}>
            {glyphState === 'done'
              ? '✓'
              : glyphState === 'error'
                ? '✗'
                : glyphState === 'active'
                  ? '●'
                  : '○'}
          </span>
        )}
      </div>

      <div
        className="flex-1 min-w-0 whitespace-pre-wrap break-words"
        style={{ color: terminalTokens.colors.text[textColor] }}
      >
        {children}
      </div>
    </div>
  );
}
