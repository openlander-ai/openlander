import { apiDelete, apiGet, apiPost, apiPut } from './client';

export type AiProviderKind = 'openai' | 'anthropic';

export interface AiProviderStatus {
  configured: boolean;
  provider_id: 'aiops';
  provider: AiProviderKind | null;
  provider_label: string | null;
  model: string | null;
  base_url: string | null;
  api_key_configured: boolean;
  feature: 'ai_ops_briefing';
  ai_ops_enabled_by_provider: false;
}

export interface AiProvidersResponse {
  status: 'ok';
  provider: AiProviderStatus;
  message: string;
}

export interface SaveAiProviderInput {
  provider: AiProviderKind;
  api_key?: string;
  model?: string;
  base_url?: string;
}

export interface SaveAiProviderResponse {
  status: 'saved';
  provider: AiProviderStatus;
  ai_ops_enabled_by_provider: false;
  _agent_guidance: {
    message: string;
  };
}

export interface AiProviderHealth {
  ok: boolean;
  latency_ms: number | null;
  checked_at: string;
  error: string | null;
}

export interface TestAiProviderResponse {
  status: 'ok' | 'failed';
  provider: AiProviderStatus;
  health: AiProviderHealth;
  ai_ops_enabled_by_provider: false;
}

export interface DeleteAiProviderResponse {
  status: 'deleted';
  provider: AiProviderStatus;
  ai_ops_enabled_by_provider: false;
}

export async function getAiProviders(): Promise<AiProvidersResponse> {
  return apiGet<AiProvidersResponse>('/api/settings/ai-providers');
}

export async function saveAiOpsProvider(
  input: SaveAiProviderInput,
): Promise<SaveAiProviderResponse> {
  return apiPut<SaveAiProviderResponse>('/api/settings/ai-providers/ai-ops-briefing', input);
}

export async function testAiOpsProvider(
  input: SaveAiProviderInput,
): Promise<TestAiProviderResponse> {
  return apiPost<TestAiProviderResponse>('/api/settings/ai-providers/ai-ops-briefing/test', input);
}

export async function deleteAiOpsProvider(): Promise<DeleteAiProviderResponse> {
  return apiDelete('/api/settings/ai-providers/ai-ops-briefing').then(
    () =>
      ({
        status: 'deleted',
        provider: {
          configured: false,
          provider_id: 'aiops',
          provider: null,
          provider_label: null,
          model: null,
          base_url: null,
          api_key_configured: false,
          feature: 'ai_ops_briefing',
          ai_ops_enabled_by_provider: false,
        },
        ai_ops_enabled_by_provider: false,
      }) satisfies DeleteAiProviderResponse,
  );
}
