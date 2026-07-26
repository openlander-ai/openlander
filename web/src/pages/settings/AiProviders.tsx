import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, CheckCircle2, KeyRound, Loader2, PlugZap, Trash2 } from 'lucide-react';
import { OuterCard } from '@/components/Shell/OuterCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/i18n/context';
import {
  deleteAiOpsProvider,
  getAiProviders,
  saveAiOpsProvider,
  testAiOpsProvider,
  type AiProviderKind,
  type AiProviderStatus,
  type SaveAiProviderInput,
} from '@/lib/api/ai-providers';
import { cn } from '@/lib/utils';
import { localizeApiError } from '@/lib/localized-api-error';

const DEFAULT_MODELS: Record<AiProviderKind, string> = {
  openai: 'gpt-4.1-mini',
  anthropic: 'claude-haiku-4-5-20251001',
  gemini: 'gemini-2.5-flash',
};

interface FormState {
  provider: AiProviderKind;
  apiKey: string;
  model: string;
  baseUrl: string;
}

function formFromProvider(provider: AiProviderStatus | null): FormState {
  const kind = provider?.provider ?? 'openai';
  return {
    provider: kind,
    apiKey: '',
    model: provider?.model ?? DEFAULT_MODELS[kind],
    baseUrl: provider?.base_url ?? '',
  };
}

function payloadFromForm(form: FormState): SaveAiProviderInput {
  return {
    provider: form.provider,
    ...(form.apiKey.trim() ? { api_key: form.apiKey.trim() } : {}),
    model: form.model.trim() || DEFAULT_MODELS[form.provider],
    ...(form.provider === 'openai' && form.baseUrl.trim() ? { base_url: form.baseUrl.trim() } : {}),
  };
}

function providerName(provider: AiProviderKind): string {
  if (provider === 'openai') return 'OpenAI-compatible';
  if (provider === 'anthropic') return 'Anthropic API';
  return 'Gemini API';
}

export function AiProvidersSettings() {
  const { t } = useLanguage();
  const [providerStatus, setProviderStatus] = useState<AiProviderStatus | null>(null);
  const [form, setForm] = useState<FormState>(() => formFromProvider(null));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    void getAiProviders()
      .then((response) => {
        setProviderStatus(response.provider);
        setForm(formFromProvider(response.provider));
      })
      .catch((err: unknown) => {
        setError(localizeApiError(err, t, 'aiProviders.error.load', 'common.errors.codes'));
      })
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const apiKeyRequired =
    !providerStatus?.api_key_configured || providerStatus.provider !== form.provider;
  const canSubmit = useMemo(() => {
    if (saving || testing || deleting) return false;
    if (!form.model.trim()) return false;
    if (apiKeyRequired && !form.apiKey.trim()) return false;
    return true;
  }, [apiKeyRequired, deleting, form.apiKey, form.model, saving, testing]);

  const updateProvider = (provider: AiProviderKind) => {
    setForm((prev) => ({
      ...prev,
      provider,
      model:
        prev.provider === provider && prev.model.trim()
          ? prev.model
          : providerStatus?.provider === provider && providerStatus.model
            ? providerStatus.model
            : DEFAULT_MODELS[provider],
      baseUrl: provider === 'openai' ? prev.baseUrl : '',
    }));
    setMessage(null);
    setError(null);
  };

  const save = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await saveAiOpsProvider(payloadFromForm(form));
      setProviderStatus(response.provider);
      setForm(formFromProvider(response.provider));
      setMessage(t('aiProviders.status.saved'));
    } catch (err) {
      setError(localizeApiError(err, t, 'aiProviders.error.save', 'common.errors.codes'));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    if (!canSubmit) return;
    setTesting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await testAiOpsProvider(payloadFromForm(form));
      if (response.health.ok) {
        setMessage(t('aiProviders.status.testPassed'));
      } else {
        setError(t('aiProviders.error.test'));
      }
    } catch (err) {
      setError(localizeApiError(err, t, 'aiProviders.error.test', 'common.errors.codes'));
    } finally {
      setTesting(false);
    }
  };

  const disconnect = async () => {
    setDeleting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await deleteAiOpsProvider();
      setProviderStatus(response.provider);
      setForm(formFromProvider(response.provider));
      setMessage(t('aiProviders.status.deleted'));
    } catch (err) {
      setError(localizeApiError(err, t, 'aiProviders.error.delete', 'common.errors.codes'));
    } finally {
      setDeleting(false);
    }
  };

  const configured = providerStatus?.configured === true;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <Bot className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            {t('aiProviders.title')}
          </span>
        }
        subtitle={t('aiProviders.subtitle')}
        actions={
          configured ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--ol-border-subtle)] px-2.5 py-1 text-[11px] text-[color:var(--ol-success)]">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('aiProviders.connected')}
            </span>
          ) : null
        }
      >
        {loading ? (
          <div className="flex items-center gap-2 text-[13px] text-[color:var(--ol-fg-muted)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('aiProviders.loading')}
          </div>
        ) : (
          <div className="grid gap-5">
            <div className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-4">
              <div className="flex items-start gap-3">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--ol-fg-muted)]" />
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-[color:var(--ol-fg)]">
                    {t('aiProviders.policyTitle')}
                  </p>
                  <p className="mt-1 text-[12.5px] leading-relaxed text-[color:var(--ol-fg-muted)]">
                    {t('aiProviders.policyBody')}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="ai-provider-kind">{t('aiProviders.form.provider')}</Label>
                <Select
                  value={form.provider}
                  onValueChange={(value) => updateProvider(value as AiProviderKind)}
                >
                  <SelectTrigger id="ai-provider-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="openai">OpenAI-compatible</SelectItem>
                    <SelectItem value="anthropic">Anthropic API</SelectItem>
                    <SelectItem value="gemini">Gemini API</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="ai-provider-model">{t('aiProviders.form.model')}</Label>
                <Input
                  id="ai-provider-model"
                  value={form.model}
                  onChange={(event) => setForm((prev) => ({ ...prev, model: event.target.value }))}
                  placeholder={DEFAULT_MODELS[form.provider]}
                />
              </div>

              <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="ai-provider-key">{t('aiProviders.form.apiKey')}</Label>
                <Input
                  id="ai-provider-key"
                  type="password"
                  value={form.apiKey}
                  onChange={(event) => setForm((prev) => ({ ...prev, apiKey: event.target.value }))}
                  placeholder={
                    providerStatus?.api_key_configured && providerStatus.provider === form.provider
                      ? t('aiProviders.form.apiKeyPlaceholderConfigured')
                      : t('aiProviders.form.apiKeyPlaceholder')
                  }
                  autoComplete="off"
                />
                <p className="text-[11.5px] text-[color:var(--ol-fg-subtle)]">
                  {t('aiProviders.form.apiKeyHint')}
                </p>
              </div>

              {form.provider === 'openai' && (
                <div className="grid gap-2 sm:col-span-2">
                  <Label htmlFor="ai-provider-base-url">{t('aiProviders.form.baseUrl')}</Label>
                  <Input
                    id="ai-provider-base-url"
                    value={form.baseUrl}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, baseUrl: event.target.value }))
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                  <p className="text-[11.5px] text-[color:var(--ol-fg-subtle)]">
                    {t('aiProviders.form.baseUrlHint')}
                  </p>
                </div>
              )}
            </div>

            {message && (
              <div className="rounded-md border border-[color:var(--ol-success)]/30 bg-[color:var(--ol-success)]/10 px-3 py-2 text-[12.5px] text-[color:var(--ol-success)]">
                {message}
              </div>
            )}
            {error && (
              <div className="rounded-md border border-[color:var(--ol-error)]/30 bg-[color:var(--ol-error)]/10 px-3 py-2 text-[12.5px] text-[color:var(--ol-error)]">
                {error}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" onClick={() => void save()} disabled={!canSubmit}>
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <PlugZap className="h-4 w-4" />
                )}
                {t('aiProviders.actions.save')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void test()}
                disabled={!canSubmit}
              >
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {t('aiProviders.actions.test')}
              </Button>
              {configured && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void disconnect()}
                  disabled={saving || testing || deleting}
                  className="text-[color:var(--ol-error)] hover:text-[color:var(--ol-error)]"
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}
                  {t('aiProviders.actions.disconnect')}
                </Button>
              )}
            </div>
          </div>
        )}
      </OuterCard>

      <OuterCard title={t('aiProviders.scope.title')} subtitle={t('aiProviders.scope.subtitle')}>
        <div className="grid gap-3 sm:grid-cols-3">
          {(['provider', 'project', 'service'] as const).map((key) => (
            <div
              key={key}
              className={cn(
                'rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-3',
              )}
            >
              <div className="text-[12px] font-semibold text-[color:var(--ol-fg)]">
                {t(`aiProviders.scope.${key}.title`)}
              </div>
              <p className="mt-1 text-[11.5px] leading-relaxed text-[color:var(--ol-fg-muted)]">
                {t(`aiProviders.scope.${key}.body`)}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-[color:var(--ol-fg-subtle)]">
          {t('aiProviders.currentProvider', { provider: providerName(form.provider) })}
        </p>
      </OuterCard>
    </div>
  );
}
