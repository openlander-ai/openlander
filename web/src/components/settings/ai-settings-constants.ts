export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'],
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-20250514'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  openrouter: ['openrouter/free', 'openai/gpt-4o-mini'],
  ollama: ['llama3.2', 'llama3.1', 'mistral'],
};

export const PROVIDER_DEFS = [
  { id: 'openai', label: 'OpenAI', color: 'bg-emerald-500', models: PROVIDER_MODELS.openai },
  {
    id: 'anthropic',
    label: 'Anthropic',
    color: 'bg-orange-500',
    models: PROVIDER_MODELS.anthropic,
  },
  { id: 'gemini', label: 'Google Gemini', color: 'bg-blue-500', models: PROVIDER_MODELS.gemini },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    color: 'bg-purple-500',
    models: PROVIDER_MODELS.openrouter,
  },
  { id: 'ollama', label: 'Ollama (Local)', color: 'bg-gray-500', models: PROVIDER_MODELS.ollama },
] as const;

export type ProviderDefId = (typeof PROVIDER_DEFS)[number]['id'];

export function getDefaultModel(providerId: string): string {
  return PROVIDER_MODELS[providerId]?.[0] ?? '';
}

export function getProviderDef(providerId: string) {
  return PROVIDER_DEFS.find((p) => p.id === providerId);
}

// Currently includes all features. Kept as a Set so new features
// without per-model selection can simply be omitted from here.
export const MODEL_SELECTOR_FEATURES = new Set([
  'autoRecovery',
  'buildDebugger',
  'webAgent',
  'envDetection',
  'secretScan',
  'rollbackSuggestion',
  'operationalMonitoring',
  'codingPlan',
]);
