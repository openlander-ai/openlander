export const LLM_PROVIDERS = [
  'gemini',
  'anthropic',
  'openai',
  'xai',
  'deepseek',
  'mistral',
  'zai',
  'zai-coding',
] as const;

export type LLMProviderType = (typeof LLM_PROVIDERS)[number];
