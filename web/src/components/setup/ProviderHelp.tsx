import { ExternalLink, Info } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

interface ProviderHelpProps {
  provider: string;
  className?: string;
}

export function ProviderHelp({ provider, className }: ProviderHelpProps) {
  const { t } = useLanguage();
  if (provider === 'anthropic') {
    return (
      <div className={cn('p-4 rounded-lg border border-agent/20 bg-agent/5 space-y-2', className)}>
        <div className="flex items-start gap-2 text-agent">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('providerHelp.anthropic.usingClaudeCode')}</p>
            <p className="text-xs text-muted-ol">
              {'Run'}{' '}
              <code className="px-1 py-0.5 rounded bg-bg-subtle font-mono text-primary-ol">
                claude setup-token
              </code>{' '}
              {t('providerHelp.anthropic.inTerminal')}
            </p>
            <a
              href="https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs flex items-center gap-1 hover:underline mt-2"
            >
              {t('providerHelp.anthropic.learnMore')} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (provider === 'gemini') {
    return (
      <div className={cn('p-4 rounded-lg border border-agent/20 bg-agent/5 space-y-2', className)}>
        <div className="flex items-start gap-2 text-agent">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('providerHelp.gemini.needKey')}</p>
            <p className="text-xs text-muted-ol">{t('providerHelp.gemini.freeTier')}</p>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs flex items-center gap-1 hover:underline mt-2"
            >
              {t('providerHelp.gemini.getFreeKey')} <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
