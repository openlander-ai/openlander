import { useEffect, useState } from 'react';
import { Loader2, Sparkles, AlertCircle, Info } from 'lucide-react';
import { getAiFeatures, updateAiFeatures, type AiFeaturesResponse } from '@/lib/api/system.js';
import { Switch } from '@/components/ui/switch.js';
import { useLanguage } from '@/i18n/context.js';
import { cn } from '@/lib/utils.js';

export function AiSettingsTab() {
  const { t } = useLanguage();
  const [features, setFeatures] = useState<AiFeaturesResponse['features'] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    async function loadFeatures() {
      try {
        const data = await getAiFeatures();
        setFeatures(data.features);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load AI features');
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
      const data = await updateAiFeatures({ [key]: { enabled } });
      setFeatures(data.features);
    } catch (err) {
      setFeatures((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [key]: { ...prev[key], enabled: !enabled },
        };
      });
      setError(err instanceof Error ? err.message : 'Failed to update feature');
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
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-agent" />
        <h2 className="font-display text-lg font-semibold text-primary-ol">
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

      <div className="rounded-lg border border-border bg-bg-panel/30 divide-y divide-border">
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
                        Unavailable
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-body text-secondary-ol">
                    {t(`settings.ai.${key}.description`)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
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
  );
}
