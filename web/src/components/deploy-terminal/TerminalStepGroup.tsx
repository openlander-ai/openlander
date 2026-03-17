import { useState } from 'react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { TerminalGlyphState } from './terminal-tokens';
import { TerminalLine } from './TerminalLine';

export interface TerminalStepGroupProps {
  title: ReactNode;
  children: ReactNode;
  defaultExpanded?: boolean;
  status?: TerminalGlyphState;
  time?: string;
  className?: string;
}

export function TerminalStepGroup({
  title,
  children,
  defaultExpanded = true,
  status = 'pending',
  time,
  className,
}: TerminalStepGroupProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        className="flex items-center cursor-pointer hover:bg-white/[0.02] rounded px-1 -mx-1 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <TerminalLine
          time={time}
          glyphState={status}
          glyph={
            <div className="flex items-center justify-center w-full h-full">
              {isExpanded ? (
                <ChevronDown className="w-3 h-3" />
              ) : (
                <ChevronRight className="w-3 h-3" />
              )}
            </div>
          }
          textColor={status === 'error' ? 'error' : status === 'active' ? 'primary' : 'secondary'}
          className="flex-1 py-1"
        >
          <div className="flex items-center gap-2 font-medium select-none">{title}</div>
        </TerminalLine>
      </div>

      {isExpanded && <div className="flex flex-col gap-1 mt-1">{children}</div>}
    </div>
  );
}
