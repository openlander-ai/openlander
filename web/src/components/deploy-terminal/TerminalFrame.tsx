import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { terminalTokens } from './terminal-tokens';

export interface TerminalFrameProps {
  children: ReactNode;
  className?: string;
  title?: string;
}

export function TerminalFrame({ children, className, title }: TerminalFrameProps) {
  return (
    <div
      className={cn('relative flex flex-col overflow-hidden rounded-xl border', className)}
      style={{
        backgroundColor: terminalTokens.colors.background,
        borderColor: terminalTokens.colors.border,
        boxShadow: terminalTokens.effects.innerShadow,
      }}
    >
      <div className="absolute top-0 left-0 right-0 h-24 bg-gradient-to-b from-white/[0.02] to-transparent pointer-events-none" />

      {title && (
        <div
          className="flex items-center px-4 py-2 border-b text-xs font-mono uppercase tracking-wider"
          style={{
            borderColor: terminalTokens.colors.border,
            color: terminalTokens.colors.text.muted,
            fontFamily: terminalTokens.typography.fontFamily,
          }}
        >
          {title}
        </div>
      )}

      <div
        className="flex-1 overflow-auto p-4 font-mono text-[13px] leading-relaxed"
        style={{
          color: terminalTokens.colors.text.primary,
          fontFamily: terminalTokens.typography.fontFamily,
        }}
      >
        {children}
      </div>
    </div>
  );
}
