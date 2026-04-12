import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { terminalTokens } from './terminal-tokens';

export interface TerminalAIBlockProps {
  variant: 'diagnostic' | 'prescription' | 'info';
  icon?: ReactNode;
  title: string;
  detail?: string;
  children?: ReactNode;
  className?: string;
}

const variantStyles = {
  diagnostic: {
    borderColor: terminalTokens.colors.text.error,
    backgroundColor: 'rgba(239, 68, 68, 0.06)',
    titleColor: terminalTokens.colors.text.error,
  },
  prescription: {
    borderColor: terminalTokens.colors.text.accent,
    backgroundColor: 'rgba(168, 85, 247, 0.06)',
    titleColor: terminalTokens.colors.text.accent,
  },
  info: {
    borderColor: terminalTokens.colors.text.info,
    backgroundColor: 'rgba(96, 165, 250, 0.06)',
    titleColor: terminalTokens.colors.text.info,
  },
} as const;

export function TerminalAIBlock({
  variant,
  icon,
  title,
  detail,
  children,
  className,
}: TerminalAIBlockProps) {
  const styles = variantStyles[variant];

  return (
    <div
      className={cn('my-1 p-3', className)}
      style={{
        borderLeft: `3px solid ${styles.borderColor}`,
        borderTopRightRadius: '8px',
        borderBottomRightRadius: '8px',
        backgroundColor: styles.backgroundColor,
        fontFamily: terminalTokens.typography.fontFamily,
      }}
    >
      <div className="flex items-start gap-2">
        {icon && (
          <div className="shrink-0 pt-[2px]" style={{ color: styles.titleColor }}>
            {icon}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div
            className="text-xs leading-relaxed whitespace-pre-wrap break-words"
            style={{ color: styles.titleColor }}
          >
            {title}
          </div>
          {detail && (
            <div
              className="mt-1 text-xs leading-relaxed whitespace-pre-wrap break-words"
              style={{ color: terminalTokens.colors.text.secondary }}
            >
              {detail}
            </div>
          )}
          {children && (
            <div
              className="mt-2 text-xs leading-relaxed whitespace-pre-wrap break-words"
              style={{ color: terminalTokens.colors.text.secondary }}
            >
              {children}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
