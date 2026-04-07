import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, Info } from 'lucide-react';
import { AISparkle } from '@/components/ui/AISparkle.js';
import { getAiFeatures, updateAiFeatures, type AiFeaturesResponse } from '@/lib/api/system.js';
import type { ProviderInfo } from '@/lib/api/index.js';
import { Switch } from '@/components/ui/switch.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.js';
import { cn } from '@/lib/utils.js';
import { useLanguage } from '@/i18n/context.js';
import {
  PROVIDER_MODELS,
  PROVIDER_DEFS,
  MODEL_SELECTOR_FEATURES,
} from './ai-settings-constants.js';

interface AiFeaturesSectionProps {
  providers: ProviderInfo[];
}

const FEATURE_LIST: Array<keyof AiFeaturesResponse['features']> = [
  'codingPlan',
  'autoRecovery',
  'buildDebugger',
  'webAgent',
  'envDetection',
  'secretScan',
  'rollbackSuggestion',
  'operationalMonitoring',
];

export function AiFeaturesSection({ providers }: AiFeaturesSectionProps) {
  const { t } = useLanguage();

  const [features, setFeatures] = useState<AiFeaturesResponse['features'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getAiFeatures()
      .then((data) => setFeatures(data.features))
      .catch((err) =>
        setError(
          err instanceof Error ? err.message : t('settings.ai.errorLoad') || 'Failed to load',
        ),
      )
      .finally(() => setLoading(false));
  }, [t]);

  const handleToggle = async (key: keyof AiFeaturesResponse['features'], enabled: boolean) => {
    if (!features) return;

    setUpdating(key);
    setError(null);

    setFeatures((prev) => {
      if (!prev) return prev;
      return { ...prev, [key]: { ...prev[key], enabled } };
    });

    try {
      const data = await updateAiFeatures({
        [key]: { enabled, providerId: features[key].providerId, model: features[key].model },
      });
      setFeatures(data.features);
    } catch (err) {
      setFeatures((prev) => {
        if (!prev) return prev;
        return { ...prev, [key]: { ...prev[key], enabled: !enabled } };
      });
      setError(
        err instanceof Error
          ? err.message
          : t('settings.ai.errorUpdate') || 'Failed to update feature',
      );
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
      setError(
        err instanceof Error
          ? err.message
          : t('settings.ai.errorUpdate') || 'Failed to update feature',
      );
    } finally {
      setUpdating(null);
    }
  };

  if (loading) {
    return (
      <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-agent" />
        </div>
      </section>
    );
  }

  const hasUnavailable = features && Object.values(features).some((f) => !f.available);

  return (
    <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <AISparkle className="h-5 w-5" />
        <h2 className="font-display text-sm font-semibold text-primary-ol">
          {t('settings.ai.title') || 'AI Features'}
        </h2>
      </div>

      {error && (
        <div className="rounded-md bg-error/10 p-3 text-sm font-body text-error flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {hasUnavailable && (
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3 flex items-start gap-2.5">
          <Info className="h-4 w-4 text-warning mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-body font-medium text-warning">
              {t('settings.ai.requiresApiKey') || 'Action Required'}
            </p>
            <p className="text-xs font-body text-warning/80">
              {t('settings.ai.requiresApiKeyDescription') ||
                'Some features require an AI provider connection.'}
            </p>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-border bg-bg-subtle/50 overflow-hidden divide-y divide-border">
        {features &&
          FEATURE_LIST.map((key) => {
            const feature = features[key];
            if (!feature) return null;

            const isUpdating = updating === key;
            const currentValue =
              feature.providerId && feature.model
                ? `${feature.providerId}:${feature.model}`
                : 'default';

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
                      {t(`settings.ai.${key}.label`) || key}
                    </p>
                    {!feature.available && (
                      <span className="text-[10px] uppercase tracking-wider font-semibold bg-bg-subtle text-muted-ol px-1.5 py-0.5 rounded">
                        {t('settings.ai.unavailable') || 'UNAVAILABLE'}
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-body text-secondary-ol">
                    {t(`settings.ai.${key}.description`) || ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {MODEL_SELECTOR_FEATURES.has(key) && providers.length > 0 && (
                    <div className="w-[220px]">
                      <Select
                        value={currentValue}
                        onValueChange={(val) =>
                          handleModelChange(key, val === 'default' ? '' : val)
                        }
                        disabled={!feature.available || isUpdating}
                      >
                        <SelectTrigger className="w-full h-8 text-xs bg-bg-app border-border font-mono">
                          <SelectValue placeholder={t('settings.ai.modelDefault') || 'Default'} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default" className="text-xs font-body">
                            {t('settings.ai.modelDefault') || 'Default'}
                          </SelectItem>
                          {providers.flatMap((p) => {
                            const models = PROVIDER_MODELS[p.provider] ?? [];
                            const label =
                              PROVIDER_DEFS.find((def) => def.id === p.provider)?.label ??
                              p.provider;

                            return models.map((m) => (
                              <SelectItem
                                key={`${p.id}:${m}`}
                                value={`${p.id}:${m}`}
                                className="text-xs font-mono"
                              >
                                {label} — {m}
                              </SelectItem>
                            ));
                          })}
                        </SelectContent>
                      </Select>
                    </div>
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
        {t('settings.ai.requiresRestart') || 'Changes to AI features may require a restart.'}
      </p>
    </section>
  );
}
