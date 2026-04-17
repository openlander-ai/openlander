export interface ProviderModelOption {
  id: string;
  label: string;
}

const model = (id: string, label = id): ProviderModelOption => ({ id, label });

export const PROVIDER_MODELS: Record<string, ProviderModelOption[]> = {
  openai: [
    model('gpt-4o'),
    model('gpt-4o-mini'),
    model('gpt-4.1'),
    model('gpt-4.1-mini'),
    model('gpt-4.1-nano'),
    model('o3'),
    model('o3-mini'),
    model('o4-mini'),
  ],
  anthropic: [
    model('claude-sonnet-4-20250514'),
    model('claude-opus-4-20250514'),
    model('claude-haiku-4-5-20251001'),
  ],
  gemini: [model('gemini-2.5-flash'), model('gemini-2.5-pro'), model('gemini-2.0-flash')],
  xai: [model('grok-3-mini-fast'), model('grok-3-fast'), model('grok-3-mini'), model('grok-3')],
  deepseek: [model('deepseek-chat'), model('deepseek-reasoner')],
  mistral: [
    model('mistral-large-latest'),
    model('mistral-medium-latest'),
    model('mistral-small-latest'),
    model('codestral-latest'),
  ],
  zai: [
    model('glm-5.1'),
    model('glm-5', 'GLM-5 (deprecated)'),
    model('glm-4.7'),
    model('glm-4.7-flash'),
    model('glm-4.6'),
    model('glm-4.6-flash'),
    model('glm-z1-flash'),
  ],
  'zai-coding': [
    model('glm-5.1'),
    model('glm-5', 'GLM-5 (deprecated)'),
    model('glm-4.7'),
    model('glm-4.7-flash'),
    model('glm-4.6'),
    model('glm-4.6-flash'),
    model('glm-z1-flash'),
  ],
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
  { id: 'zai', label: 'Z.ai (GLM)', color: 'bg-cyan-500', models: PROVIDER_MODELS.zai },
  {
    id: 'zai-coding',
    label: 'Z.ai Coding Plan',
    color: 'bg-cyan-600',
    models: PROVIDER_MODELS['zai-coding'],
  },
] as const;

export type ProviderDefId = (typeof PROVIDER_DEFS)[number]['id'];

export function getDefaultModel(providerId: string): string {
  return PROVIDER_MODELS[providerId]?.[0]?.id ?? '';
}

export function getProviderModels(providerId: string): ProviderModelOption[] {
  return PROVIDER_MODELS[providerId] ?? [];
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
