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
  Key,
  ShieldCheck,
  Bot,
  Plus,
  Save,
  Trash2,
  Eye,
  EyeOff,
} from 'lucide-react';
import { AISparkle } from '@/components/ui/AISparkle.js';
import { getAiFeatures, updateAiFeatures, type AiFeaturesResponse } from '@/lib/api/system.js';
import {
  getProviders,
  addProvider,
  deleteProvider,
  testLLMConnection,
  startGoogleOAuth,
  getGoogleAuthStatus,
  type ProviderInfo,
} from '@/lib/api/index.js';
import { Switch } from '@/components/ui/switch.js';
import { useLanguage } from '@/i18n/context.js';
import { cn } from '@/lib/utils.js';
import { useAiUsage } from '@/hooks/use-ai-usage.js';
import { listProjects } from '@/lib/api/projects.js';
import { StatCard } from './shared.js';
import { formatRelativeTime } from '@/lib/time.js';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import { emitLlmChanged } from '@/lib/llm-events.js';
import { LlmProviderOAuth } from './LlmProviderOAuth.js';
import { ConfirmDialog } from '@/components/ui/confirm-dialog.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.js';

const MODEL_SELECTOR_FEATURES = new Set([
  'autoRecovery',
  'buildDebugger',
  'webAgent',
  'envDetection',
  'secretScan',
  'rollbackSuggestion',
  'operationalMonitoring',
  'codingPlan',
]);

const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'],
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-20250514'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  openrouter: ['openrouter/free', 'openai/gpt-4o-mini'],
  ollama: ['llama3.2', 'llama3.1', 'mistral'],
};

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI', models: PROVIDER_MODELS.openai },
  { id: 'anthropic', label: 'Anthropic', models: PROVIDER_MODELS.anthropic },
  { id: 'gemini', label: 'Google Gemini', models: PROVIDER_MODELS.gemini },
  { id: 'openrouter', label: 'OpenRouter', models: PROVIDER_MODELS.openrouter },
  { id: 'ollama', label: 'Ollama (Local)', models: PROVIDER_MODELS.ollama },
];

function getDefaultModel(providerId: string): string {
  return PROVIDER_MODELS[providerId]?.[0] ?? '';
}

export function AiSettingsTab() {
  const { t } = useLanguage();

  // Usage State
  const { summary, recent, isLoading: usageLoading, error: usageError } = useAiUsage();
  const [projects, setProjects] = useState<Record<string, string>>({});

  // AI Features State
  const [features, setFeatures] = useState<AiFeaturesResponse['features'] | null>(null);
  const [updating, setUpdating] = useState<string | null>(null);

  // Providers State
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add Provider State
  const [showAddForm, setShowAddForm] = useState(false);
  const [newProvider, setNewProvider] = useState({
    id: `gemini-${Date.now()}`,
    provider: 'gemini',
    apiKey: '',
    defaultModel: getDefaultModel('gemini'),
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [adding, setAdding] = useState(false);

  // Delete Context
  const [providerToDelete, setProviderToDelete] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Testing State
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<
    Record<string, { ok: boolean; latencyMs?: number; error?: string }>
  >({});

  // OAuth State
  const [googleConnected, setGoogleConnected] = useState(false);
  const [checkingGoogle, setCheckingGoogle] = useState(true);

  useEffect(() => {
    async function loadInitialData() {
      try {
        const [featuresData, providersData, projectsData] = await Promise.all([
          getAiFeatures().catch(() => ({ features: {} as AiFeaturesResponse['features'] })),
          getProviders(),
          listProjects(false).catch(() => []),
        ]);

        setFeatures(featuresData.features);
        setProviders(providersData.providers);

        const projectMap: Record<string, string> = {};
        for (const p of projectsData) {
          projectMap[p.id] = p.name;
        }
        setProjects(projectMap);
        setError(null);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : t('settings.ai.errorLoad') || 'Failed to load settings',
        );
      } finally {
        setLoading(false);
      }
    }
    void loadInitialData();
  }, [t]);

  useEffect(() => {
    void getGoogleAuthStatus().then((status) => {
      setGoogleConnected(status.connected);
      setCheckingGoogle(false);
    });
  }, []);

  const loadProvidersOnly = async () => {
    try {
      const res = await getProviders();
      setProviders(res.providers);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('llmSettings.errorLoad') || 'Failed to load providers',
      );
    }
  };

  const handleToggleFeature = async (
    key: keyof AiFeaturesResponse['features'],
    enabled: boolean,
  ) => {
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
      setError(
        err instanceof Error
          ? err.message
          : t('settings.ai.errorUpdate') || 'Failed to update feature',
      );
    } finally {
      setUpdating(null);
    }
  };

  const handleFeatureModelChange = async (
    key: keyof AiFeaturesResponse['features'],
    value: string,
  ) => {
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

  const handleProviderChange = (providerVal: string) => {
    setNewProvider({
      ...newProvider,
      provider: providerVal,
      id: `${providerVal}-${Date.now()}`,
      defaultModel: getDefaultModel(providerVal),
    });
  };

  const handleAddProvider = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    setError(null);
    try {
      await addProvider(newProvider);
      await loadProvidersOnly();
      emitLlmChanged();
      setShowAddForm(false);
      setNewProvider({
        id: `gemini-${Date.now()}`,
        provider: 'gemini',
        apiKey: '',
        defaultModel: getDefaultModel('gemini'),
      });
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
      await loadProvidersOnly();
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-agent" />
      </div>
    );
  }

  const activeProviderDef = PROVIDERS.find((p) => p.id === newProvider.provider);

  const featureList: Array<keyof AiFeaturesResponse['features']> = [
    'codingPlan',
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
    <div className="space-y-8 flex flex-col">
      {/* 1. Usage Statistics */}
      <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5 order-1">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-agent" />
          <h2 className="font-display text-sm font-semibold text-primary-ol">
            {t('settings.ai.usage.title') || 'Usage & Statistics'}
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
            <span className="ml-2 text-sm text-muted-ol">
              {t('settings.ai.usage.loading') || 'Loading...'}
            </span>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <div data-testid="usage-total-input-tokens">
                <StatCard
                  icon={<ArrowDownToLine className="h-4 w-4" />}
                  label={t('settings.ai.usage.inputTokens') || 'Input Tokens'}
                  value={summary?.totalInputTokens.toLocaleString() ?? '0'}
                  color="text-blue-500"
                />
              </div>
              <div data-testid="usage-total-output-tokens">
                <StatCard
                  icon={<ArrowUpFromLine className="h-4 w-4" />}
                  label={t('settings.ai.usage.outputTokens') || 'Output Tokens'}
                  value={summary?.totalOutputTokens.toLocaleString() ?? '0'}
                  color="text-green-500"
                />
              </div>
              <div data-testid="usage-total-cost">
                <StatCard
                  icon={<DollarSign className="h-4 w-4" />}
                  label={t('settings.ai.usage.totalCost') || 'Total Cost'}
                  value={`$${summary?.totalCostUsd?.toFixed(3) ?? '0.000'}`}
                  color="text-yellow-500"
                />
              </div>
              <div data-testid="usage-call-count">
                <StatCard
                  icon={<Zap className="h-4 w-4" />}
                  label={t('settings.ai.usage.callCount') || 'Call Count'}
                  value={summary?.callCount.toLocaleString() ?? '0'}
                  color="text-purple-500"
                />
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <h3 className="text-sm font-medium text-primary-ol">
                {t('settings.ai.usage.recentCalls') || 'Recent Calls'}
              </h3>
              {recent.length === 0 ? (
                <div className="rounded-lg border border-border bg-bg-panel shadow-sm p-8 text-center">
                  <p className="text-xs font-body text-muted-ol">
                    {t('settings.ai.usage.empty') || 'No recent calls.'}
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-bg-subtle/50 divide-y divide-border">
                  {recent.slice(0, 10).map((log) => (
                    <div
                      key={log.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-4"
                    >
                      <div className="flex items-start sm:items-center gap-3">
                        <div
                          className={cn(
                            'flex items-center justify-center h-8 w-8 rounded-full shrink-0 mt-0.5 sm:mt-0',
                            log.result === 'failure' ? 'bg-error/10' : 'bg-bg-subtle',
                          )}
                        >
                          <Brain
                            className={cn(
                              'h-4 w-4',
                              log.result === 'failure' ? 'text-error' : 'text-agent',
                            )}
                          />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-primary-ol flex flex-wrap items-center gap-1.5">
                            {log.projectId && (
                              <span className="text-xs font-normal text-agent border border-agent/20 bg-agent/5 px-1.5 py-0.5 rounded">
                                {projects[log.projectId] || log.projectId.slice(0, 12)}
                              </span>
                            )}
                            {!log.projectId && (
                              <span className="text-xs font-normal text-muted-ol border border-border bg-bg-subtle px-1.5 py-0.5 rounded">
                                {(t as (key: string) => string)('settings.ai.usage.noProject') ||
                                  'Global'}
                              </span>
                            )}
                            {(t as (key: string) => string)(
                              `settings.ai.usage.actionType.${log.actionType}`,
                            ) || log.actionType}
                            <span className="text-xs font-normal text-muted-ol bg-bg-subtle px-1.5 py-0.5 rounded">
                              {log.modelName}
                            </span>
                          </p>
                          <p className="text-xs text-secondary-ol flex flex-wrap items-center gap-1.5 mt-1">
                            <span className="flex items-center gap-1 whitespace-nowrap">
                              <Clock className="h-3 w-3" />
                              {formatRelativeTime(log.createdAt, t)}
                            </span>
                            {log.durationMs && (
                              <span className="whitespace-nowrap flex items-center gap-1">
                                <span className="text-border">|</span>
                                {(log.durationMs / 1000).toFixed(1)}s
                              </span>
                            )}
                            {log.source && (
                              <span className="whitespace-nowrap flex items-center gap-1">
                                <span className="text-border">|</span>
                                <span className="font-mono text-[10px] bg-bg-subtle px-1 rounded">
                                  {(t as (key: string) => string)(
                                    `settings.ai.usage.source.${log.source}`,
                                  ) || log.source}
                                </span>
                              </span>
                            )}
                            {log.result && (
                              <span className="whitespace-nowrap flex items-center gap-1">
                                <span className="text-border">|</span>
                                <span
                                  className={cn(
                                    'font-mono text-[10px] px-1 rounded',
                                    log.result === 'success'
                                      ? 'text-success bg-success/10'
                                      : log.result === 'failure'
                                        ? 'text-error bg-error/10'
                                        : 'text-warning bg-warning/10',
                                  )}
                                >
                                  {(t as (key: string) => string)(
                                    `settings.ai.usage.result.${log.result}`,
                                  ) || log.result}
                                </span>
                              </span>
                            )}
                            {log.toolsCalled && (
                              <span
                                className="truncate max-w-[200px] flex items-center gap-1"
                                title={log.toolsCalled}
                              >
                                <span className="text-border">|</span>
                                <span className="font-mono text-[10px] bg-bg-subtle px-1 rounded truncate">
                                  {log.toolsCalled.split(',').length} tools
                                </span>
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="text-left sm:text-right shrink-0 ml-11 sm:ml-0">
                        <p className="text-sm font-medium text-primary-ol">
                          {((log.inputTokens || 0) + (log.outputTokens || 0)).toLocaleString()}{' '}
                          {t('settings.ai.usage.tokenUnit') || 'tokens'}
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

      {/* 2. LLM Providers */}
      <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5 order-2">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-secondary-ol" />
          <h2 className="font-display text-sm font-semibold text-primary-ol">
            {t('defaults.llmSettings.title') || t('llmSettings.title') || 'LLM Providers'}
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
            const providerDef = PROVIDERS.find((p) => p.id === provider.provider);
            const isTesting = testingId === provider.id;
            const testResult = testResults[provider.id];

            return (
              <div
                key={provider.id}
                className="rounded-lg border border-border bg-bg-subtle/50 p-4 flex flex-col gap-3 transition-colors hover:bg-bg-subtle"
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
                        {PROVIDERS.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-body text-muted-ol">
                      {t('llmSettings.id') || 'Provider ID'}
                    </p>
                    <Input
                      value={newProvider.id}
                      onChange={(e) => setNewProvider({ ...newProvider, id: e.target.value })}
                      placeholder={t('llmSettings.idHint') || 'e.g. gemini-personal'}
                      className="font-mono text-sm bg-bg-app border-border"
                      required
                    />
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
                      {(activeProviderDef?.models || []).map((model) => (
                        <SelectItem key={model} value={model} className="font-mono text-sm">
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
            <div className="w-full border-t border-border"></div>
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

      {/* 3. AI Features */}
      <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5 order-3">
        <div className="flex items-center gap-2">
          <AISparkle className="h-5 w-5" />
          <h2 className="font-display text-sm font-semibold text-primary-ol">
            {t('settings.ai.title') || 'AI Features'}
          </h2>
        </div>

        {hasUnavailableFeatures && (
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
            featureList.map((key) => {
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
                            handleFeatureModelChange(key, val === 'default' ? '' : val)
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
                              const pDef = PROVIDER_MODELS[p.provider] ?? [];
                              const labelPrefix =
                                PROVIDERS.find((def) => def.id === p.provider)?.label || p.provider;

                              return pDef.map((m) => (
                                <SelectItem
                                  key={`${p.id}:${m}`}
                                  value={`${p.id}:${m}`}
                                  className="text-xs font-mono"
                                >
                                  {labelPrefix} — {m}
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
                      onCheckedChange={(checked) => handleToggleFeature(key, checked)}
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
    </div>
  );
}
