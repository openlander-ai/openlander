export const PROVIDER_MODELS: Record<string, string[]> = {
  openai: ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o'],
  anthropic: ['claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-sonnet-4-20250514'],
  gemini: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
  xai: ['grok-3-mini-fast', 'grok-3-fast', 'grok-3-mini', 'grok-3'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  mistral: [
    'mistral-small-latest',
    'mistral-medium-latest',
    'mistral-large-latest',
    'codestral-latest',
  ],
  groq: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'mixtral-8x7b-32768', 'gemma2-9b-it'],
  togetherai: [
    'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    'meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo',
    'mistralai/Mixtral-8x7B-Instruct-v0.1',
    'Qwen/Qwen2.5-72B-Instruct-Turbo',
  ],
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
  { id: 'xai', label: 'xAI (Grok)', color: 'bg-sky-500', models: PROVIDER_MODELS.xai },
  { id: 'deepseek', label: 'DeepSeek', color: 'bg-indigo-500', models: PROVIDER_MODELS.deepseek },
  { id: 'mistral', label: 'Mistral AI', color: 'bg-amber-500', models: PROVIDER_MODELS.mistral },
  { id: 'groq', label: 'Groq', color: 'bg-rose-500', models: PROVIDER_MODELS.groq },
  {
    id: 'togetherai',
    label: 'Together AI',
    color: 'bg-teal-500',
    models: PROVIDER_MODELS.togetherai,
  },
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
