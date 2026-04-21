import { HelpCircle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../ui/popover.js';
import { useLanguage } from '../../../i18n/context.js';
import { cn } from '../../../lib/utils.js';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface KeyboardShortcutsHelpProps {
  className?: string;
  helpButtonRef?: React.RefObject<HTMLButtonElement | null>;
}

export function KeyboardShortcutsHelp({ className, helpButtonRef }: KeyboardShortcutsHelpProps) {
  const { t } = useLanguage();

  const shortcuts = [
    { key: 'J', description: t('opsV2.shortcuts.nextItem') },
    { key: 'K', description: t('opsV2.shortcuts.prevItem') },
    { key: '/', description: t('opsV2.shortcuts.search') },
    { key: 'Esc', description: t('opsV2.shortcuts.close') },
    { key: '?', description: t('opsV2.shortcuts.help') },
  ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          ref={helpButtonRef}
          className={cn(
            'inline-flex items-center justify-center rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors',
            className,
          )}
          aria-label={t('opsV2.shortcuts.helpLabel')}
          data-testid="keyboard-shortcuts-help-btn"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64">
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-sm">{t('opsV2.shortcuts.title')}</h3>
            <p className="text-xs text-muted-foreground mt-1">{t('opsV2.shortcuts.description')}</p>
          </div>
          <div className="space-y-2">
            {shortcuts.map((shortcut) => (
              <div key={shortcut.key} className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{shortcut.description}</span>
                <kbd className="px-2 py-1 text-xs font-semibold text-foreground bg-subtle rounded border border-border">
                  {shortcut.key}
                </kbd>
              </div>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
