import { useEffect, useState } from 'react';
import { Key, Loader2, ShieldCheck, Bot, Plus, Save, Trash2, Eye, EyeOff, Zap } from 'lucide-react';
import {
  addProvider,
  deleteProvider,
  testLLMConnection,
  startGoogleOAuth,
  getGoogleAuthStatus,
  type ProviderInfo,
} from '@/lib/api/index.js';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.js';
import { cn } from '@/lib/utils.js';
import { useLanguage } from '@/i18n/context.js';
import { emitLlmChanged } from '@/lib/llm-events.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog.js';
import { LlmProviderOAuth } from './LlmProviderOAuth.js';
import { PROVIDER_DEFS, getDefaultModel, getProviderDef } from './ai-settings-constants.js';

interface AiProvidersSectionProps {
  providers: ProviderInfo[];
  onProvidersChange: () => Promise<void>;
}

export function AiProvidersSection({ providers, onProvidersChange }: AiProvidersSectionProps) {
  const { t } = useLanguage();

  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState({
    provider: 'gemini',
    apiKey: '',
    defaultModel: getDefaultModel('gemini'),
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [adding, setAdding] = useState(false);

  const [providerToDelete, setProviderToDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; latencyMs?: number; error?: string }>
  >({});

  const [googleConnected, setGoogleConnected] = useState(false);
  const [checkingGoogle, setCheckingGoogle] = useState(true);

  useEffect(() => {
    void getGoogleAuthStatus().then((status) => {
      setGoogleConnected(status.connected);
      setCheckingGoogle(false);
    });
  }, []);

  const handleProviderChange = (providerVal: string) => {
    setNewProvider({
      provider: providerVal,
      apiKey: '',
      defaultModel: getDefaultModel(providerVal),
    });
  };

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await addProvider({
        id: `${newProvider.provider}-${Date.now()}`,
        provider: newProvider.provider,
        apiKey: newProvider.apiKey,
        defaultModel: newProvider.defaultModel,
      });
      await onProvidersChange();
      emitLlmChanged();
      setShowAddForm(false);
      setNewProvider({ provider: 'gemini', apiKey: '', defaultModel: getDefaultModel('gemini') });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('llmSettings.errorAdd') || 'Failed to add provider',
      );
    } finally {
      setAdding(false);
    }
  };

  const executeDeleteProvider = async () => {
    if (!providerToDelete) return;
    setDeletingId(providerToDelete);
    setError(null);
    try {
      await deleteProvider(providerToDelete);
      await onProvidersChange();
      emitLlmChanged();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('llmSettings.errorDelete') || 'Failed to delete provider',
      );
    } finally {
      setDeletingId(null);
      setProviderToDelete(null);
    }
  };

  const handleTestConnection = async (provider: ProviderInfo) => {
    setTestingId(provider.id);
    setTestResults((prev) => {
      const next = { ...prev };
      delete next[provider.id];
      return next;
    });
    try {
      const result = await testLLMConnection({
        providerId: provider.id,
        model: provider.defaultModel,
      });
      setTestResults((prev) => ({ ...prev, [provider.id]: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [provider.id]: {
          ok: false,
          error: err instanceof Error ? err.message : t('llmSettings.testFail') || 'Test failed',
        },
      }));
    } finally {
      setTestingId(null);
      emitLlmChanged();
    }
  };

  const handleTestNewConnection = async () => {
    setTestingId('new');
    setTestResults((prev) => {
      const next = { ...prev };
      delete next['new'];
      return next;
    });
    try {
      const result = await testLLMConnection({
        provider: newProvider.provider,
        apiKey: newProvider.apiKey,
        model: newProvider.defaultModel,
      });
      setTestResults((prev) => ({ ...prev, new: result }));
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        new: {
          ok: false,
          error: err instanceof Error ? err.message : t('llmSettings.testFail') || 'Test failed',
        },
      }));
    } finally {
      setTestingId(null);
      emitLlmChanged();
    }
  };

  const activeProviderDef = PROVIDER_DEFS.find((p) => p.id === newProvider.provider);

  return (
    <>
      <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-secondary-ol" />
          <h2 className="font-display text-sm font-semibold text-primary-ol">
            {t('llmSettings.title') || 'LLM Providers'}
          </h2>
        </div>

        {error && (
          <div className="rounded-md bg-error/10 p-3 text-sm font-body text-error">{error}</div>
        )}

        {providers.length > 0 && (
          <div className="rounded-lg border border-success/30 bg-success/5 px-4 py-3 flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-success" />
            <p className="text-sm font-body font-medium text-success">
              {providers.length === 1
                ? t('llmSettings.connected')?.replace('{n}', '1') || '1 provider connected'
                : t('llmSettings.connectedPlural')?.replace('{n}', providers.length.toString()) ||
                  `${providers.length} providers connected`}
            </p>
          </div>
        )}

        {providers.length === 0 && !showAddForm && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-bg-subtle/30 py-12 px-4 text-center">
            <div className="bg-bg-panel p-3 rounded-full shadow-sm border border-border mb-4">
              <Bot className="h-6 w-6 text-agent/70" />
            </div>
            <h3 className="mb-4 font-display text-sm font-medium text-primary-ol">
              {t('llmSettings.noProviders') || 'No AI Providers Configured'}
            </h3>
            <Button
              size="sm"
              onClick={() => setShowAddForm(true)}
              className="gap-2 bg-agent text-white hover:bg-agent/90 shadow-sm transition-transform active:scale-95"
            >
              <Plus className="h-3.5 w-3.5" />
              {t('llmSettings.addProvider') || 'Add Provider'}
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {providers.map((provider) => {
            const pDef = getProviderDef(provider.provider);
            const isTesting = testingId === provider.id;
            const testResult = testResults[provider.id];

            return (
              <div
                key={provider.id}
                className="rounded-lg border border-border bg-bg-subtle/50 p-4 flex flex-col gap-3 transition-colors hover:bg-bg-subtle"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 px-2 py-1 rounded bg-bg-app border border-border text-xs font-medium text-primary-ol">
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full shrink-0',
                          pDef?.color ?? 'bg-gray-400',
                        )}
                      />
                      {pDef?.label || provider.provider}
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
                      {t('llmSettings.testConnection') || 'Test'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setProviderToDelete(provider.id)}
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
                      ? t('llmSettings.testSuccess')?.replace(
                          '{ms}',
                          testResult.latencyMs?.toString() || '0',
                        ) || `Connection successful (${testResult.latencyMs}ms)`
                      : testResult.error || t('llmSettings.testFail') || 'Connection failed'}
                  </div>
                )}
              </div>
            );
          })}

          {providers.length > 0 && !showAddForm && (
            <Button
              variant="outline"
              className="w-full border-dashed gap-2 text-muted-ol hover:text-primary-ol transition-colors"
              onClick={() => setShowAddForm(true)}
            >
              <Plus className="h-4 w-4" />
              {t('llmSettings.addProvider') || 'Add Provider'}
            </Button>
          )}

          {showAddForm && (
            <div className="rounded-xl border border-border bg-bg-subtle/40 p-5 space-y-5 relative overflow-hidden ring-1 ring-black/5 shadow-sm">
              <div className="absolute top-0 left-0 w-1 h-full bg-agent" />
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-primary-ol">
                  {t('llmSettings.addProvider') || 'Add Provider'}
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAddForm(false)}
                  className="h-8 text-xs text-muted-ol"
                >
                  {t('llmSettings.cancel') || 'Cancel'}
                </Button>
              </div>

              <form onSubmit={handleAddProvider} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <p className="text-xs font-body text-muted-ol">Provider</p>
                    <Select value={newProvider.provider} onValueChange={handleProviderChange}>
                      <SelectTrigger className="w-full bg-bg-app border-border text-primary-ol">
                        <SelectValue placeholder="Select provider" />
                      </SelectTrigger>
                      <SelectContent>
                        {PROVIDER_DEFS.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            <span className="flex items-center gap-2">
                              <span className={cn('h-2 w-2 rounded-full', p.color)} />
                              {p.label}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-body text-muted-ol">
                      {t('llmSettings.defaultModel') || 'Default Model'}
                    </p>
                    <Select
                      value={newProvider.defaultModel}
                      onValueChange={(val) => setNewProvider({ ...newProvider, defaultModel: val })}
                    >
                      <SelectTrigger className="w-full bg-bg-app border-border text-primary-ol font-mono">
                        <SelectValue placeholder="Select model" />
                      </SelectTrigger>
                      <SelectContent>
                        {(activeProviderDef?.models ?? []).map((model) => (
                          <SelectItem key={model} value={model} className="font-mono text-sm">
                            {model}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-body text-muted-ol">
                    {t('llmSettings.apiKey') || 'API Key'}
                  </p>
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
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-ol hover:text-primary-ol flex items-center justify-center p-1 rounded-sm focus:outline-none focus:ring-1 focus:ring-agent"
                    >
                      {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
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
                    {t('llmSettings.addProvider') || 'Save Provider'}
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
                    {t('llmSettings.testConnection') || 'Test'}
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
                      ? t('llmSettings.testSuccess')?.replace(
                          '{ms}',
                          testResults['new'].latencyMs?.toString() || '0',
                        ) || 'Success!'
                      : testResults['new'].error || t('llmSettings.testFail') || 'Failed'}
                  </div>
                )}
              </form>
            </div>
          )}
        </div>

        <div className="pt-6 mt-6 relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center mb-6">
            <span className="bg-bg-panel px-3 text-xs font-semibold text-muted-ol uppercase tracking-wider">
              OAuth Providers
            </span>
          </div>
          <LlmProviderOAuth
            provider="google"
            label="Google Gemini"
            description="Connect your Google account to use Gemini models"
            connected={googleConnected}
            loading={checkingGoogle}
            onConnect={startGoogleOAuth}
          />
        </div>
      </section>

      <ConfirmDialog
        open={!!providerToDelete}
        onOpenChange={(open) => !open && setProviderToDelete(null)}
        title={t('llmSettings.deleteConfirmTitle') || 'Delete Provider'}
        description={
          t('llmSettings.deleteConfirm') ||
          'Are you sure you want to delete this provider? Features using this provider will fallback to the default provider.'
        }
        confirmLabel={t('llmSettings.delete') || 'Delete'}
        cancelLabel={t('llmSettings.cancel') || 'Cancel'}
        variant="destructive"
        onConfirm={executeDeleteProvider}
      />
    </>
  );
}
