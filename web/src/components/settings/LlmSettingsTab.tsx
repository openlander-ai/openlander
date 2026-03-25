import { useMemo, useState } from 'react';
import { Check, Eye, EyeOff, Key, Loader2, Save, Zap, Trash2 } from 'lucide-react';
import { configureLLM, testLLMConnection, deleteLLMConfig, type SetupStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface LlmSettingsTabProps {
  status: SetupStatus | null;
  refetch: () => Promise<void>;
}

type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter';

const PROVIDERS: Array<{
  id: ProviderId;
  label: string;
  models: string[];
}> = [
  { id: 'openai', label: 'OpenAI', models: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1'] },
  {
    id: 'anthropic',
    label: 'Anthropic',
    models: ['claude-sonnet-4-20250514', 'claude-3-7-sonnet-latest'],
  },
  { id: 'gemini', label: 'Google Gemini', models: ['gemini-2.0-flash', 'gemini-2.5-flash'] },
  { id: 'openrouter', label: 'OpenRouter', models: ['openrouter/free', 'openai/gpt-4o-mini'] },
];

function isProviderId(value: string | undefined): value is ProviderId {
  return PROVIDERS.some((provider) => provider.id === value);
}

function getDefaultModel(provider: ProviderId): string {
  return PROVIDERS.find((item) => item.id === provider)?.models[0] || 'gemini-2.0-flash';
}

export function LlmSettingsTab({ status, refetch }: LlmSettingsTabProps) {
  const initialProvider = isProviderId(status?.llm?.provider) ? status.llm.provider : 'gemini';
  const [llmProvider, setLlmProvider] = useState<ProviderId>(initialProvider);
  const [llmModel, setLlmModel] = useState(
    status?.llm?.ok && status.llm.provider === initialProvider && status.llm.model
      ? status.llm.model
      : getDefaultModel(initialProvider),
  );
  const [llmApiKey, setLlmApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);
  const [llmMessage, setLlmMessage] = useState('');
  const [llmError, setLlmError] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    latencyMs?: number;
    error?: string;
  } | null>(null);

  const [removing, setRemoving] = useState(false);

  const isConfigured = status?.llm?.ok === true;
  const activeProvider = useMemo(
    () => PROVIDERS.find((provider) => provider.id === llmProvider),
    [llmProvider],
  );
  const canTestWithSavedConfig = isConfigured && status?.llm?.provider === llmProvider;

  const handleSaveApiKey = async (e: { preventDefault: () => void }) => {
    e.preventDefault();
    setLlmSaving(true);
    setLlmMessage('');
    setLlmError('');
    setTestResult(null);
    try {
      await configureLLM(llmProvider, llmApiKey.trim(), llmModel);
      await refetch();
      setLlmMessage('API Key saved successfully');
      setLlmApiKey('');
      setLlmSaved(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save API Key';
      setLlmError(message);
    } finally {
      setLlmSaving(false);
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    setLlmError('');
    try {
      const result = await testLLMConnection(
        llmApiKey.trim() ? llmProvider : undefined,
        llmApiKey.trim() || undefined,
      );
      setTestResult(result);
    } catch (err: unknown) {
      setTestResult({
        ok: false,
        error: err instanceof Error ? err.message : 'Test failed',
      });
    } finally {
      setTesting(false);
    }
  };

  const handleRemove = async () => {
    setRemoving(true);
    setLlmError('');
    try {
      await deleteLLMConfig();
      await refetch();
      setLlmMessage('');
      setLlmSaved(false);
      setTestResult(null);
    } catch (err: unknown) {
      setLlmError(err instanceof Error ? err.message : 'Failed to remove');
    } finally {
      setRemoving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-secondary-ol" />
        <h2 className="font-display text-lg font-semibold text-primary-ol">
          AI Model Configuration
        </h2>
      </div>

      <div
        className={cn(
          'rounded-lg border p-3 flex items-center justify-between',
          isConfigured
            ? 'border-success/30 bg-success/5'
            : 'border-[hsl(var(--border))] bg-bg-subtle/30',
        )}
      >
        <div className="flex items-center gap-2.5">
          <span className={cn('text-sm', isConfigured ? 'text-success' : 'text-muted-ol')}>
            {isConfigured ? '✓' : '○'}
          </span>
          <div>
            <p
              className={cn(
                'text-sm font-body font-medium',
                isConfigured ? 'text-primary-ol' : 'text-muted-ol',
              )}
            >
              {isConfigured ? 'Connected' : 'Not configured'}
            </p>
            {isConfigured && status?.llm && (
              <p className="text-xs font-body text-muted-ol">
                {status.llm.provider} · {status.llm.model}
              </p>
            )}
          </div>
        </div>
        {isConfigured && (
          <Button
            variant="ghost"
            size="sm"
            disabled={removing}
            onClick={handleRemove}
            className="text-xs text-muted-ol hover:text-error h-7 gap-1"
          >
            {removing ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            Remove
          </Button>
        )}
      </div>

      <div className="flex gap-4 rounded-lg border border-border bg-bg-panel/30 p-4">
        <aside className="w-52 shrink-0 rounded-md border border-border bg-bg-panel p-2">
          <p className="px-2 pb-2 text-xs font-body text-muted-ol">Providers</p>
          <div className="space-y-1">
            {PROVIDERS.map((provider) => {
              const selected = provider.id === llmProvider;
              const configured = isConfigured && status?.llm?.provider === provider.id;

              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => {
                    setLlmProvider(provider.id);
                    setLlmModel(
                      isConfigured && status?.llm?.provider === provider.id && status?.llm?.model
                        ? status.llm.model
                        : getDefaultModel(provider.id),
                    );
                    setLlmSaved(false);
                    setTestResult(null);
                    setLlmMessage('');
                    setLlmError('');
                  }}
                  className={cn(
                    'w-full rounded-md border px-2.5 py-2 text-left text-sm font-body transition-colors',
                    selected
                      ? 'border-agent/40 bg-agent/10 text-primary-ol'
                      : 'border-transparent text-muted-ol hover:border-border hover:bg-bg-app/40 hover:text-primary-ol',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span>{provider.label}</span>
                    <span className={cn('text-xs', configured ? 'text-success' : 'text-muted-ol')}>
                      {configured ? '✓' : '○'}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <div className="flex-1 rounded-md border border-border bg-bg-panel p-4">
          <p className="text-sm font-body text-muted-ol">
            Provide an API key and model for {activeProvider?.label || 'the selected provider'}.
            This keeps smart auto-recovery enabled.
          </p>

          <form onSubmit={handleSaveApiKey} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <p className="text-xs font-body text-muted-ol">API Key</p>
              <div className="relative">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  placeholder={canTestWithSavedConfig ? '••••••••••••' : 'sk-...'}
                  value={llmApiKey}
                  onChange={(e) => {
                    setLlmApiKey(e.target.value);
                    setLlmSaved(false);
                    setTestResult(null);
                    setLlmMessage('');
                    setLlmError('');
                  }}
                  className="pr-10 font-mono text-sm bg-bg-app border-border"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((prev) => !prev)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-ol hover:text-primary-ol"
                  aria-label={showApiKey ? 'Hide API key' : 'Show API key'}
                >
                  {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-body text-muted-ol">Model</p>
              <select
                value={llmModel}
                onChange={(e) => {
                  setLlmModel(e.target.value);
                  setLlmSaved(false);
                  setTestResult(null);
                  setLlmMessage('');
                  setLlmError('');
                }}
                className="w-full rounded-md border border-border bg-bg-app px-3 py-2 text-sm font-mono text-primary-ol"
              >
                {(activeProvider?.models || []).map((model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="submit"
                disabled={llmSaving || llmSaved || !llmApiKey.trim()}
                size="sm"
                className={cn(
                  'gap-1.5 font-body',
                  llmSaved
                    ? 'bg-success/10 text-success border border-success/30 hover:bg-success/10'
                    : 'bg-agent text-bg-app hover:bg-agent/90',
                )}
              >
                {llmSaving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : llmSaved ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  <Save className="h-3.5 w-3.5" />
                )}
                {llmSaved ? 'Saved' : 'Save API Key'}
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testing || (!canTestWithSavedConfig && !llmApiKey.trim())}
                onClick={handleTest}
                className="gap-1.5 font-body text-xs"
              >
                {testing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="h-3.5 w-3.5" />
                )}
                Test Connection
              </Button>
            </div>

            {testResult && (
              <div
                className={cn(
                  'rounded-md px-3 py-2 text-xs font-body',
                  testResult.ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
                )}
              >
                {testResult.ok
                  ? `✓ Connection successful — responded in ${testResult.latencyMs}ms`
                  : `✗ ${testResult.error || 'Connection failed'}`}
              </div>
            )}

            {llmMessage && !testResult && (
              <p className="text-sm font-body text-success">{llmMessage}</p>
            )}
            {llmError && <p className="text-sm font-body text-error">{llmError}</p>}
          </form>
        </div>
      </div>
    </section>
  );
}
