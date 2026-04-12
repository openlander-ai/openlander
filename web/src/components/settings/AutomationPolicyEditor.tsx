import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useLanguage } from '@/i18n/context';
import {
  fetchAutomationDefaults,
  type AutomationStep,
  type AutomationMode,
  type AutomationPolicy,
} from '@/lib/api/operations';

const STEPS: {
  key: AutomationStep;
  labelKey: string;
  noteKey: string;
}[] = [
  {
    key: 'restart',
    labelKey: 'settings.operations.automation.restart',
    noteKey: 'settings.operations.automation.restartNote',
  },
  {
    key: 'diagnosis',
    labelKey: 'settings.operations.automation.diagnosis',
    noteKey: 'settings.operations.automation.diagnosisNote',
  },
  {
    key: 'apply_fixes',
    labelKey: 'settings.operations.automation.applyFixes',
    noteKey: 'settings.operations.automation.applyFixesNote',
  },
  {
    key: 'rollback',
    labelKey: 'settings.operations.automation.rollback',
    noteKey: 'settings.operations.automation.rollbackNote',
  },
];

interface AutomationPolicyEditorProps {
  /** When provided, the policy values are externally controlled */
  value?: Partial<Record<AutomationStep, AutomationMode>>;
  /** Called when any step mode changes */
  onChange?: (policy: Record<AutomationStep, AutomationMode>) => void;
}

const DEFAULT_POLICY: AutomationPolicy = {
  restart: 'confirm',
  diagnosis: 'confirm',
  apply_fixes: 'confirm',
  rollback: 'confirm',
};

export function AutomationPolicyEditor({ value, onChange }: AutomationPolicyEditorProps) {
  const { t } = useLanguage();
  const [policy, setPolicy] = useState<AutomationPolicy>(DEFAULT_POLICY);
  const [effectivePolicy, setEffectivePolicy] = useState<AutomationPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetchAutomationDefaults()
      .then((data) => {
        const effective = data.effective ?? data.defaults;
        setEffectivePolicy(effective);
        setPolicy(effective);
        setLoading(false);
      })
      .catch(() => {
        setError(t('settings.operations.automation.loadFailed'));
        setLoading(false);
      });
  }, [t]);

  // Sync external value when provided
  useEffect(() => {
    if (value) {
      setPolicy((prev) => ({ ...prev, ...value }));
    }
  }, [value]);

  const currentPolicy = value ? { ...DEFAULT_POLICY, ...value } : policy;
  const isFullAuto = STEPS.every((s) => currentPolicy[s.key] === 'auto');

  const updateStep = (step: AutomationStep, mode: AutomationMode) => {
    const next = { ...currentPolicy, [step]: mode };
    setPolicy(next);
    onChange?.(next);
  };

  const toggleFullAuto = (enabled: boolean) => {
    const mode: AutomationMode = enabled ? 'auto' : 'confirm';
    const next: AutomationPolicy = {
      restart: mode,
      diagnosis: mode,
      apply_fixes: mode,
      rollback: mode,
    };
    setPolicy(next);
    onChange?.(next);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-muted-foreground">
            {t('settings.operations.automation.loading')}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6">
          <p className="text-sm text-destructive">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('settings.operations.automation.title')}</CardTitle>
        <CardDescription>{t('settings.operations.automation.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Full Auto master toggle */}
        <div className="flex items-center justify-between rounded-lg border p-3 bg-muted/50">
          <div>
            <Label className="text-sm font-medium">
              {t('settings.operations.automation.fullAuto')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t('settings.operations.automation.fullAutoDesc')}
            </p>
          </div>
          <Switch checked={isFullAuto} onCheckedChange={toggleFullAuto} />
        </div>

        {/* Individual step toggles */}
        <div className="space-y-3">
          {STEPS.map(({ key, labelKey, noteKey }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm">{t(labelKey)}</Label>
                <p className="text-xs text-muted-foreground">{t(noteKey)}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant={currentPolicy[key] === 'auto' ? 'default' : 'secondary'}
                  className="text-xs min-w-[4rem] justify-center"
                >
                  {currentPolicy[key] === 'auto'
                    ? t('settings.operations.automation.modeAuto')
                    : t('settings.operations.automation.modeConfirm')}
                </Badge>
                <Switch
                  checked={currentPolicy[key] === 'auto'}
                  onCheckedChange={(checked) => updateStep(key, checked ? 'auto' : 'confirm')}
                />
              </div>
            </div>
          ))}
        </div>

        {/* Effective policy display */}
        {effectivePolicy && (
          <div className="mt-4 rounded-lg border p-3">
            <p className="text-xs font-medium text-muted-foreground mb-2">
              {t('settings.operations.automation.effective')}
            </p>
            <div className="flex flex-wrap gap-2">
              {STEPS.map(({ key, labelKey }) => (
                <Badge
                  key={key}
                  variant={effectivePolicy[key] === 'auto' ? 'default' : 'outline'}
                  className="text-xs"
                >
                  {t(labelKey)}:{' '}
                  {effectivePolicy[key] === 'auto'
                    ? t('settings.operations.automation.modeAuto')
                    : t('settings.operations.automation.modeConfirm')}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
