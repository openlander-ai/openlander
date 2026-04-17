import { Loader2, Trash2, CheckCircle2, XCircle, HelpCircle, Clock } from 'lucide-react';
import type { ProviderInfo } from '@/lib/api/index.js';
import { Button } from '@/components/ui/button.js';
import { cn } from '@/lib/utils.js';
import { getProviderDef } from './ai-settings-constants.js';
import { useLanguage } from '@/i18n/context.js';

interface ProviderCardProps {
  provider: ProviderInfo;
  isDeleting: boolean;
  onDelete: () => void;
}

export function ProviderCard({ provider, isDeleting, onDelete }: ProviderCardProps) {
  const { t, language } = useLanguage();
  const pDef = getProviderDef(provider.provider);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(0, 'day');
    } else if (diffDays < 30) {
      return new Intl.RelativeTimeFormat(language, { numeric: 'auto' }).format(-diffDays, 'day');
    }
    return new Intl.DateTimeFormat(language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  };

  return (
    <div className="rounded-lg border border-border bg-bg-subtle/50 p-4 flex flex-col gap-3 transition-colors hover:bg-bg-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-bg-app border border-border text-xs font-medium text-primary-ol shrink-0">
            <span className={cn('h-2 w-2 rounded-full shrink-0', pDef?.color ?? 'bg-gray-400')} />
            {pDef?.label || provider.provider}
          </div>
          <div className="text-sm font-mono text-muted-ol truncate">{provider.defaultModel}</div>
          {provider.hasApiKey && (
            <div className="text-xs font-mono text-muted-ol bg-bg-app px-2 py-0.5 rounded border border-border truncate max-w-[120px]">
              {provider.apiKeyPreview}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={isDeleting}
            className="h-8 w-8 p-0 text-muted-ol hover:text-error"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-ol">
        <div className="flex items-center gap-1.5">
          {provider.circuitBreaker?.state === 'OPEN' ? (
            <>
              <XCircle className="h-3.5 w-3.5 text-error" />
              <span className="text-error font-medium">
                {t('llmSettings.circuitBreaker.open') || 'Blocked (Waiting for retry)'}
              </span>
            </>
          ) : provider.circuitBreaker?.state === 'HALF_OPEN' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 text-warning animate-spin" />
              <span className="text-warning font-medium">
                {t('llmSettings.circuitBreaker.halfOpen') || 'Testing recovery...'}
              </span>
            </>
          ) : provider.health ? (
            provider.health.ok ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                <span className="text-success font-medium">
                  {t('llmSettings.healthy') || 'Healthy'}
                </span>
                {provider.health.latencyMs !== undefined && (
                  <span className="text-muted-ol/70 ml-1">({provider.health.latencyMs}ms)</span>
                )}
              </>
            ) : (
              <>
                <XCircle className="h-3.5 w-3.5 text-error" />
                <span className="text-error font-medium">
                  {t('llmSettings.unhealthy') || 'Unhealthy'}
                </span>
              </>
            )
          ) : (
            <>
              <HelpCircle className="h-3.5 w-3.5 text-muted-ol/70" />
              <span>{t('llmSettings.untested') || 'Untested'}</span>
            </>
          )}
        </div>

        {provider.createdAt && (
          <div className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 text-muted-ol/70" />
            <span>
              {t('llmSettings.registeredAt') || 'Registered'} {formatDate(provider.createdAt)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
