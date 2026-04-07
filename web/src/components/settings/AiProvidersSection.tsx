import { useEffect, useState } from 'react';
import { Key, ShieldCheck, Bot, Plus } from 'lucide-react';
import {
  addProvider,
  deleteProvider,
  testLLMConnection,
  startGoogleOAuth,
  getGoogleAuthStatus,
  type ProviderInfo,
} from '@/lib/api/index.js';
import { Button } from '@/components/ui/button.js';
import { useLanguage } from '@/i18n/context.js';
import { emitLlmChanged } from '@/lib/llm-events.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog.js';
import { LlmProviderOAuth } from './LlmProviderOAuth.js';
import { ProviderCard } from './ProviderCard.js';
import { AddProviderForm } from './AddProviderForm.js';

interface AiProvidersSectionProps {
  providers: ProviderInfo[];
  onProvidersChange: () => Promise<void>;
}

export function AiProvidersSection({ providers, onProvidersChange }: AiProvidersSectionProps) {
  const { t } = useLanguage();

  const [error, setError] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

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

  const handleTestNewConnection = async (data: {
    provider: string;
    apiKey: string;
    defaultModel: string;
  }) => {
    setTestingId('new');
    setTestResults((prev) => {
      const next = { ...prev };
      delete next['new'];
      return next;
    });
    try {
      const result = await testLLMConnection({
        provider: data.provider,
        apiKey: data.apiKey,
        model: data.defaultModel,
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

  const handleAddSubmit = async (data: {
    provider: string;
    apiKey: string;
    defaultModel: string;
  }) => {
    setError(null);
    try {
      await addProvider({
        id: `${data.provider}-${Date.now()}`,
        provider: data.provider,
        apiKey: data.apiKey,
        defaultModel: data.defaultModel,
      });
      await onProvidersChange();
      emitLlmChanged();
      setShowAddForm(false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('llmSettings.errorAdd') || 'Failed to add provider',
      );
      throw err;
    }
  };

  const testLabel = t('llmSettings.testConnection') || 'Test';
  const testSuccessLabel = t('llmSettings.testSuccess') || 'Connected ({ms}ms)';
  const testFailLabel = t('llmSettings.testFail') || 'Connection failed';

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
          {providers.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              isTesting={testingId === provider.id}
              isDeleting={deletingId === provider.id}
              testResult={testResults[provider.id]}
              onTest={() => handleTestConnection(provider)}
              onDelete={() => setProviderToDelete(provider.id)}
              testLabel={testLabel}
              testSuccessLabel={testSuccessLabel}
              testFailLabel={testFailLabel}
            />
          ))}

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
            <AddProviderForm
              onSubmit={handleAddSubmit}
              onCancel={() => setShowAddForm(false)}
              onTestNew={handleTestNewConnection}
              isTestingNew={testingId === 'new'}
              testResult={testResults['new']}
            />
          )}
        </div>

        <div className="pt-6 mt-6 relative">
          <div className="absolute inset-0 flex items-center" aria-hidden="true">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center mb-6">
            <span className="bg-bg-panel px-3 text-xs font-semibold text-muted-ol uppercase tracking-wider">
              {t('llmSettings.oauthTitle') || 'OAuth Providers'}
            </span>
          </div>
          <LlmProviderOAuth
            provider="google"
            label={t('llmSettings.oauthGoogleLabel') || 'Google Gemini'}
            description={
              t('llmSettings.oauthGoogleDescription') ||
              'Connect your Google account to use Gemini models'
            }
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
