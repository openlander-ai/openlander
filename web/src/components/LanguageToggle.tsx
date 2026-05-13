import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

type Language = 'en' | 'ko';

const OPTIONS: { value: Language; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'ko', label: 'KO' },
];

interface LanguageToggleProps {
  className?: string;
  size?: 'sm' | 'xs';
}

export function LanguageToggle({ className, size = 'sm' }: LanguageToggleProps) {
  const { language, setLanguage } = useLanguage();
  const pad = size === 'xs' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-1 text-[11px]';

  return (
    <div
      role="group"
      aria-label="Language"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] p-0.5',
        className,
      )}
    >
      {OPTIONS.map((opt) => {
        const active = language === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => void setLanguage(opt.value)}
            aria-pressed={active}
            className={cn(
              'rounded-sm font-mono uppercase tracking-wider transition-colors',
              pad,
              active
                ? 'bg-[color:var(--ol-primary-soft)] text-[color:var(--ol-primary)]'
                : 'text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
