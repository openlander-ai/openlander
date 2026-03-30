import { useEffect, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  Info,
  Brain,
  ArrowDownToLine,
  ArrowUpFromLine,
  DollarSign,
  Activity,
  Clock,
  Zap,
} from 'lucide-react';
import { AISparkle } from '@/components/ui/AISparkle.js';
import {
  getAiFeatures,
  updateAiFeatures,
  getProviders,
  type AiFeaturesResponse,
  type ProviderInfo,
} from '@/lib/api/system.js';
import { Switch } from '@/components/ui/switch.js';
import { useLanguage } from '@/i18n/context.js';
import { cn } from '@/lib/utils.js';
import { useAiUsage } from '@/hooks/use-ai-usage.js';
import { StatCard } from './shared.js';
import { formatRelativeTime } from '@/lib/time.js';

const MODEL_SELECTOR_FEATURES = new Set([
  'autoRecovery',
  'buildDebugger',
  'webAgent',
  'envDetection',
  'operationalMonitoring',
]);

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'],
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-20250514'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  openrouter: ['openrouter/free', 'openai/gpt-4o-mini'],
  ollama: ['llama3.2', 'llama3.1', 'mistral'],
};

export function AiSettingsTab() {
  const { t } = useLanguage();
  const [features, setFeatures] = useState<AiFeaturesResponse['features'] | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  const { summary, recent, isLoading: usageLoading, error: usageError } = useAiUsage();

  useEffect(() => {
    async function loadFeatures() {
      try {
        const [data, providersData] = await Promise.all([getAiFeatures(), getProviders()]);
        setFeatures(data.features);
        setProviders(providersData.providers);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('settings.ai.errorLoad'));
      } finally {
        setLoading(false);
      }
    }
    void loadFeatures();
  }, []);

  const handleToggle = async (key: keyof AiFeaturesResponse['features'], enabled: boolean) => {
    if (!features) return;

    setUpdating(key);
    setError(null);

    setFeatures((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [key]: { ...prev[key], enabled },
      };
    });

    try {
      const data = await updateAiFeatures({
        [key]: { enabled, providerId: features[key].providerId, model: features[key].model },
      });
      setFeatures(data.features);
    } catch (err) {
      setFeatures((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [key]: { ...prev[key], enabled: !enabled },
        };
      });
      setError(err instanceof Error ? err.message : t('settings.ai.errorUpdate'));
    } finally {
      setUpdating(null);
    }
  };

  const handleModelChange = async (key: keyof AiFeaturesResponse['features'], value: string) => {
    if (!features) return;
    setUpdating(key);
    const [providerId, model] = value ? value.split(':') : [undefined, undefined];
    setFeatures((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: { ...prev[key], providerId, model } };
    });
    try {
      const data = await updateAiFeatures({
        [key]: { enabled: features[key].enabled, providerId, model },
      });
      setFeatures(data.features);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.ai.errorUpdate'));
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-agent" />
      </div>
    );
  }

  const featureList: Array<keyof AiFeaturesResponse['features']> = [
    'autoRecovery',
    'buildDebugger',
    'webAgent',
    'envDetection',
    'secretScan',
    'rollbackSuggestion',
    'operationalMonitoring',
  ];

  const hasUnavailableFeatures = features && Object.values(features).some((f) => !f.available);

  return (
    <div className="space-y-6">
      <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <AISparkle className="h-5 w-5" />
          <h2 className="font-display text-sm font-semibold text-primary-ol">
            {t('settings.ai.title')}
          </h2>
        </div>

        {error && (
          <div className="rounded-md bg-error/10 p-3 text-sm font-body text-error flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}

        {hasUnavailableFeatures && (
          <div className="rounded-md border border-warning/30 bg-warning/5 p-3 flex items-start gap-2.5">
            <Info className="h-4 w-4 text-warning mt-0.5 shrink-0" />
            <div className="space-y-1">
              <p className="text-sm font-body font-medium text-warning">
                {t('settings.ai.requiresApiKey')}
              </p>
              <p className="text-xs font-body text-warning/80">
                {t('settings.ai.requiresApiKeyDescription')}
              </p>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-border bg-bg-subtle/50 overflow-hidden divide-y divide-border">
          {features &&
            featureList.map((key) => {
              const feature = features[key];
              const isUpdating = updating === key;

              return (
                <div key={key} className="flex items-center justify-between p-4 gap-4">
                  <div className="space-y-1 flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={cn(
                          'text-sm font-body font-medium',
                          feature.available ? 'text-primary-ol' : 'text-muted-ol',
                        )}
                      >
                        {t(`settings.ai.${key}.label`)}
                      </p>
                      {!feature.available && (
                        <span className="text-[10px] uppercase tracking-wider font-semibold bg-bg-subtle text-muted-ol px-1.5 py-0.5 rounded">
                          {t('settings.ai.unavailable')}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-body text-secondary-ol">
                      {t(`settings.ai.${key}.description`)}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {MODEL_SELECTOR_FEATURES.has(key) && providers.length > 0 && (
                      <select
                        value={
                          feature.providerId && feature.model
                            ? `${feature.providerId}:${feature.model}`
                            : ''
                        }
                        onChange={(e) => handleModelChange(key, e.target.value)}
                        disabled={!feature.available || isUpdating}
                        className="w-48 rounded-md border border-border bg-bg-app px-2 py-1 text-xs font-mono text-primary-ol disabled:opacity-50"
                      >
                        <option value="">{t('settings.ai.modelDefault')}</option>
                        {providers.flatMap((p) =>
                          (PROVIDER_MODELS[p.provider] ?? []).map((m) => (
                            <option key={`${p.id}:${m}`} value={`${p.id}:${m}`}>
                              {p.id} — {m}
                            </option>
                          )),
                        )}
                      </select>
                    )}
                    {isUpdating && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-ol" />}
                    <Switch
                      checked={feature.enabled}
                      onCheckedChange={(checked) => handleToggle(key, checked)}
                      disabled={!feature.available || isUpdating}
                    />
                  </div>
                </div>
              );
            })}
        </div>

        <p className="text-xs font-body text-muted-ol flex items-center gap-1.5">
          <Info className="h-3.5 w-3.5" />
          {t('settings.ai.requiresRestart')}
        </p>
      </section>

      <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-agent" />
          <h2 className="font-display text-sm font-semibold text-primary-ol">
            {t('settings.ai.usage.title')}
          </h2>
        </div>

        {usageError && (
          <div className="rounded-md bg-error/10 p-3 text-sm font-body text-error flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            {usageError}
          </div>
        )}

        {usageLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-agent" />
            <span className="ml-2 text-sm text-muted-ol">{t('settings.ai.usage.loading')}</span>
          </div>
        ) : (
          <>
            {/* Always show stat cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div data-testid="usage-total-input-tokens">
                <StatCard
                  icon={<ArrowDownToLine className="h-4 w-4" />}
                  label={t('settings.ai.usage.inputTokens')}
                  value={summary?.totalInputTokens.toLocaleString() ?? '0'}
                  color="text-blue-500"
                />
              </div>
              <div data-testid="usage-total-output-tokens">
                <StatCard
                  icon={<ArrowUpFromLine className="h-4 w-4" />}
                  label={t('settings.ai.usage.outputTokens')}
                  value={summary?.totalOutputTokens.toLocaleString() ?? '0'}
                  color="text-green-500"
                />
              </div>
              <div data-testid="usage-total-cost">
                <StatCard
                  icon={<DollarSign className="h-4 w-4" />}
                  label={t('settings.ai.usage.totalCost')}
                  value={`$${summary?.totalCostUsd?.toFixed(3) ?? '0.000'}`}
                  color="text-yellow-500"
                />
              </div>
              <div data-testid="usage-call-count">
                <StatCard
                  icon={<Zap className="h-4 w-4" />}
                  label={t('settings.ai.usage.callCount')}
                  value={summary?.callCount.toLocaleString() ?? '0'}
                  color="text-purple-500"
                />
              </div>
            </div>

            {/* Recent calls section with empty state */}
            <div className="mt-6 space-y-3">
              <h3 className="text-sm font-medium text-primary-ol">
                {t('settings.ai.usage.recentCalls')}
              </h3>
              {recent.length === 0 ? (
                <div className="rounded-lg border border-border bg-bg-panel shadow-sm p-8 text-center">
                  <p className="text-xs font-body text-muted-ol">{t('settings.ai.usage.empty')}</p>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-bg-subtle/50 divide-y divide-border">
                  {recent.slice(0, 10).map((log) => (
                    <div key={log.id} className="flex items-center justify-between p-3 gap-4">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center h-8 w-8 rounded-full bg-bg-subtle">
                          <Brain className="h-4 w-4 text-agent" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-primary-ol flex items-center gap-2">
                            {(t as (key: string) => string)(
                              `settings.ai.usage.actionType.${log.actionType}`,
                            ) || log.actionType}
                            <span className="text-xs font-normal text-muted-ol bg-bg-subtle px-1.5 py-0.5 rounded">
                              {log.modelName}
                            </span>
                          </p>
                          <p className="text-xs text-secondary-ol flex items-center gap-1 mt-0.5">
                            <Clock className="h-3 w-3" />
                            {formatRelativeTime(log.createdAt, t)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium text-primary-ol">
                          {((log.inputTokens || 0) + (log.outputTokens || 0)).toLocaleString()}{' '}
                          {t('settings.ai.usage.tokenUnit')}
                        </p>
                        {log.costUsd != null && log.costUsd > 0 && (
                          <p className="text-xs text-muted-ol">${log.costUsd.toFixed(4)}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </section>
    </div>
  );
}
