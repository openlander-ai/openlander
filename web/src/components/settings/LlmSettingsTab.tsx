import { useEffect, useMemo, useState } from 'react';
import { Eye, EyeOff, Key, Loader2, Plus, Save, Trash2, Zap } from 'lucide-react';
import {
  addProvider,
  deleteProvider,
  getProviders,
  testLLMConnection,
  type ProviderInfo,
  type SetupStatus,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context.js';

interface LlmSettingsTabProps {
  status: SetupStatus | null;
  refetch: () => Promise<void>;
}

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'] },
  {
    id: 'anthropic',
    label: 'Anthropic',
    models: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-20250514'],
  },
  {
    id: 'gemini',
    label: 'Google Gemini',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  },
  { id: 'openrouter', label: 'OpenRouter', models: ['openrouter/free', 'openai/gpt-4o-mini'] },
  { id: 'ollama', label: 'Ollama (Local)', models: ['llama3.2', 'llama3.1', 'mistral'] },
];

function getDefaultModel(providerId: string): string {
  return PROVIDERS.find((item) => item.id === providerId)?.models[0] || '';
}

export function LlmSettingsTab({ refetch }: LlmSettingsTabProps) {
  const { t } = useLanguage();

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState({
    id: `gemini-${Date.now()}`,
    provider: 'gemini',
    apiKey: '',
    defaultModel: getDefaultModel('gemini'),
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [adding, setAdding] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; latencyMs?: number; error?: string }>
  >({});

  const loadProviders = async () => {
    try {
      setLoadingProviders(true);
      const res = await getProviders();
      setProviders(res.providers);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('llmSettings.errorLoad'));
    } finally {
      setLoadingProviders(false);
    }
  };

  useEffect(() => {
    void loadProviders();
  }, []);

  const handleProviderChange = (providerId: string) => {
    setNewProvider({
      ...newProvider,
      provider: providerId,
      id: `${providerId}-${Date.now()}`,
      defaultModel: getDefaultModel(providerId),
    });
  };

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await addProvider(newProvider);
      await loadProviders();
      await refetch();
      setShowAddForm(false);
      setNewProvider({
        id: `gemini-${Date.now()}`,
        provider: 'gemini',
        apiKey: '',
        defaultModel: getDefaultModel('gemini'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : t('llmSettings.errorAdd'));
    } finally {
      setAdding(false);
    }
  };

  const handleDeleteProvider = async (id: string) => {
    if (!window.confirm(t('llmSettings.deleteConfirm'))) return;
    setDeletingId(id);
    setError(null);
    try {
      await deleteProvider(id);
      await loadProviders();
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('llmSettings.errorDelete'));
    } finally {
      setDeletingId(null);
    }
  };

  const handleTestConnection = async (provider: ProviderInfo) => {
    setTestingId(provider.id);
    setTestResults((prev) => ({ ...prev, [provider.id]: { ok: false, error: undefined } }));
    try {
      const result = await testLLMConnection(provider.provider);
      setTestResults((prev) => ({ ...prev, [provider.id]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: {
          ok: false,
          error: err instanceof Error ? err.message : t('llmSettings.testFail'),
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const handleTestNewConnection = async () => {
    setTestingId('new');
    setTestResults((prev) => ({ ...prev, new: { ok: false, error: undefined } }));
    try {
      const result = await testLLMConnection(newProvider.provider, newProvider.apiKey);
      setTestResults((prev) => ({ ...prev, new: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        new: { ok: false, error: err instanceof Error ? err.message : t('llmSettings.testFail') },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const activeProviderDef = useMemo(
    () => PROVIDERS.find((p) => p.id === newProvider.provider),
    [newProvider.provider],
  );

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-secondary-ol" />
        <h2 className="font-display text-lg font-semibold text-primary-ol">
          {t('llmSettings.title')}
        </h2>
      </div>

      {error && (
        <div className="rounded-md bg-error/10 p-3 text-sm font-body text-error">{error}</div>
      )}

      <div
        className={cn(
          'rounded-lg border p-3 flex items-center justify-between',
          providers.length > 0
            ? 'border-success/30 bg-success/5'
            : 'border-[hsl(var(--border))] bg-bg-panel',
        )}
      >
        <div className="flex items-center gap-2.5">
          <span className={cn('text-sm', providers.length > 0 ? 'text-success' : 'text-muted-ol')}>
            {providers.length > 0 ? '✓' : '○'}
          </span>
          <div>
            <p
              className={cn(
                'text-sm font-body font-medium',
                providers.length > 0 ? 'text-primary-ol' : 'text-muted-ol',
              )}
            >
              {providers.length > 0
                ? providers.length === 1
                  ? t('llmSettings.connected').replace('{n}', '1')
                  : t('llmSettings.connectedPlural').replace('{n}', providers.length.toString())
                : t('llmSettings.noProviders')}
            </p>
          </div>
        </div>
      </div>

      {loadingProviders ? (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-ol" />
        </div>
      ) : (
        <div className="space-y-3">
          {providers.map((provider) => {
            const providerDef = PROVIDERS.find((p) => p.id === provider.provider);
            const isTesting = testingId === provider.id;
            const testResult = testResults[provider.id];

            return (
              <div
                key={provider.id}
                className="rounded-lg border border-border bg-bg-panel/30 p-4 flex flex-col gap-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="px-2 py-1 rounded bg-bg-app border border-border text-xs font-medium text-primary-ol">
                      {providerDef?.label || provider.provider}
                    </div>
                    <div className="text-sm font-mono text-muted-ol">{provider.defaultModel}</div>
                    {provider.hasApiKey && (
                      <div className="text-xs font-mono text-muted-ol bg-bg-app px-2 py-0.5 rounded border border-border">
                        {provider.apiKeyPreview}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleTestConnection(provider)}
                      disabled={isTesting}
                      className="h-8 text-xs gap-1.5"
                    >
                      {isTesting ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Zap className="h-3 w-3" />
                      )}
                      {t('llmSettings.testConnection')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteProvider(provider.id)}
                      disabled={deletingId === provider.id}
                      className="h-8 w-8 p-0 text-muted-ol hover:text-error"
                    >
                      {deletingId === provider.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                {testResult && (
                  <div
                    className={cn(
                      'rounded-md px-3 py-2 text-xs font-body',
                      testResult.ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
                    )}
                  >
                    {testResult.ok
                      ? t('llmSettings.testSuccess').replace(
                          '{ms}',
                          testResult.latencyMs?.toString() || '0',
                        )
                      : testResult.error || t('llmSettings.testFail')}
                  </div>
                )}
              </div>
            );
          })}

          {!showAddForm ? (
            <Button
              variant="outline"
              className="w-full border-dashed gap-2 text-muted-ol hover:text-primary-ol"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-4 w-4" />
              {t('llmSettings.addProvider')}
            </Button>
          ) : (
            <div className="rounded-lg border border-border bg-bg-panel p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-primary-ol">
                  {t('llmSettings.addProvider')}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddForm(false)}
                  className="h-8 text-xs text-muted-ol"
                >
                  {t('llmSettings.cancel')}
                </Button>
              </div>

              <form onSubmit={handleAddProvider} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <p className="text-xs font-body text-muted-ol">Provider</p>
                    <select
                      value={newProvider.provider}
                      onChange={(e) => handleProviderChange(e.target.value)}
                      className="w-full rounded-md border border-border bg-bg-app px-3 py-2 text-sm font-body text-primary-ol"
                    >
                      {PROVIDERS.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-body text-muted-ol">{t('llmSettings.id')}</p>
                    <Input
                      value={newProvider.id}
                      onChange={(e) => setNewProvider({ ...newProvider, id: e.target.value })}
                      placeholder={t('llmSettings.idHint')}
                      className="font-mono text-sm bg-bg-app border-border"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-body text-muted-ol">{t('llmSettings.apiKey')}</p>
                  <div className="relative">
                    <Input
                      type={showApiKey ? 'text' : 'password'}
                      placeholder="sk-..."
                      value={newProvider.apiKey}
                      onChange={(e) => setNewProvider({ ...newProvider, apiKey: e.target.value })}
                      className="pr-10 font-mono text-sm bg-bg-app border-border"
                      required={newProvider.provider !== 'ollama'}
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((prev) => !prev)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-ol hover:text-primary-ol"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-body text-muted-ol">{t('llmSettings.defaultModel')}</p>
                  <select
                    value={newProvider.defaultModel}
                    onChange={(e) =>
                      setNewProvider({ ...newProvider, defaultModel: e.target.value })
                    }
                    className="w-full rounded-md border border-border bg-bg-app px-3 py-2 text-sm font-mono text-primary-ol"
                  >
                    {(activeProviderDef?.models || []).map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    type="submit"
                    disabled={
                      adding || (!newProvider.apiKey.trim() && newProvider.provider !== 'ollama')
                    }
                    size="sm"
                    className="gap-1.5 font-body bg-agent text-white hover:bg-agent/90"
                  >
                    {adding ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    {t('llmSettings.addProvider')}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      testingId === 'new' ||
                      (!newProvider.apiKey.trim() && newProvider.provider !== 'ollama')
                    }
                    onClick={handleTestNewConnection}
                    className="gap-1.5 font-body text-xs"
                  >
                    {testingId === 'new' ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5" />
                    )}
                    {t('llmSettings.testConnection')}
                  </Button>
                </div>

                {testResults['new'] && (
                  <div
                    className={cn(
                      'rounded-md px-3 py-2 text-xs font-body mt-2',
                      testResults['new'].ok
                        ? 'bg-success/10 text-success'
                        : 'bg-error/10 text-error',
                    )}
                  >
                    {testResults['new'].ok
                      ? t('llmSettings.testSuccess').replace(
                          '{ms}',
                          testResults['new'].latencyMs?.toString() || '0',
                        )
                      : testResults['new'].error || t('llmSettings.testFail')}
                  </div>
                )}
              </form>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
