import { Hono, type Context } from 'hono';

import type { AppContext } from '../../app.js';
import {
  loadConfig,
  normalizeLlmConfig,
  saveConfig,
  type OpenLanderConfig,
} from '../../config/index.js';
import { buildEncryptedAiOpsProviderEntry } from '../../llm/provider-config.js';
import type { LLMProviderEntry } from '../../llm/model-registry.js';
import {
  checkLlmProviderBaseUrlSafety,
  testLlmProviderEntry,
} from '../../llm/provider-health-monitor.js';
import { sanitizeLlmErrorMessage } from '../../llm/llm-error-types.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('ai-provider-api');

const AI_OPS_PROVIDER_ID = 'aiops';
const DEFAULT_OPENAI_MODEL = 'gpt-4.1-mini';
const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5-20251001';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

type SupportedAiOpsProvider = 'openai' | 'anthropic' | 'gemini';

interface ProviderBody {
  provider?: unknown;
  api_key?: unknown;
  model?: unknown;
  base_url?: unknown;
}

function defaultModelFor(provider: SupportedAiOpsProvider): string {
  if (provider === 'openai') return DEFAULT_OPENAI_MODEL;
  if (provider === 'anthropic') return DEFAULT_ANTHROPIC_MODEL;
  return DEFAULT_GEMINI_MODEL;
}

function providerLabel(provider: SupportedAiOpsProvider): string {
  if (provider === 'openai') return 'OpenAI-compatible';
  if (provider === 'anthropic') return 'Anthropic API';
  return 'Gemini API';
}

function getAiOpsEntry(config: OpenLanderConfig): LLMProviderEntry | null {
  const normalized = normalizeLlmConfig(config.llm);
  return normalized.providers[AI_OPS_PROVIDER_ID] ?? null;
}

function serializeEntry(entry: LLMProviderEntry | null) {
  if (!entry) {
    return {
      configured: false,
      provider_id: AI_OPS_PROVIDER_ID,
      provider: null,
      provider_label: null,
      model: null,
      base_url: null,
      api_key_configured: false,
      feature: 'ai_ops_briefing',
      ai_ops_enabled_by_provider: false,
    };
  }

  const provider =
    entry.provider === 'anthropic' || entry.provider === 'gemini' ? entry.provider : 'openai';
  return {
    configured: true,
    provider_id: AI_OPS_PROVIDER_ID,
    provider,
    provider_label: providerLabel(provider),
    model: entry.defaultModel,
    base_url: entry.baseURL ?? null,
    api_key_configured: Boolean(entry.encryptedApiKey || entry.apiKey || entry.authToken),
    feature: 'ai_ops_briefing',
    ai_ops_enabled_by_provider: false,
  };
}

function parseProvider(value: unknown): SupportedAiOpsProvider | null {
  if (value === 'openai' || value === 'anthropic' || value === 'gemini') {
    return value;
  }
  return null;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requireWebSession(c: Context) {
  if (c.get('authKind') === 'session') {
    return null;
  }
  return c.json(
    {
      error: 'WEB_SESSION_REQUIRED',
      code: 'WEB_SESSION_REQUIRED',
      message: 'This endpoint requires the authenticated web session cookie.',
    },
    403,
  );
}

async function readBody(c: Context): Promise<ProviderBody | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function buildEntryFromBody(
  body: ProviderBody,
  existing: LLMProviderEntry | null,
):
  | { entry: LLMProviderEntry; provider: SupportedAiOpsProvider }
  | { error: string; message: string } {
  const provider = parseProvider(body.provider);
  if (!provider) {
    return { error: 'INVALID_FIELD', message: 'provider must be openai, anthropic, or gemini' };
  }

  const apiKey = readString(body.api_key);
  const model = readString(body.model) ?? existing?.defaultModel ?? defaultModelFor(provider);
  const baseURL = provider === 'openai' ? readString(body.base_url) : undefined;

  if (apiKey) {
    return {
      provider,
      entry: buildEncryptedAiOpsProviderEntry({
        provider,
        apiKey,
        defaultModel: model,
        baseURL,
      }),
    };
  }

  if (
    !existing ||
    existing.provider !== provider ||
    !(existing.encryptedApiKey || existing.apiKey)
  ) {
    return {
      error: 'MISSING_FIELD',
      message: 'api_key is required when connecting a new AI provider',
    };
  }

  return {
    provider,
    entry: {
      provider,
      encryptedApiKey: existing.encryptedApiKey,
      apiKeyIv: existing.apiKeyIv,
      apiKey: existing.apiKey,
      authToken: existing.authToken,
      defaultModel: model,
      ...(baseURL ? { baseURL } : {}),
      createdAt: existing.createdAt ?? new Date().toISOString(),
    },
  };
}

function validateBaseUrl(
  entry: LLMProviderEntry,
): { ok: true } | { ok: false; error: string; message: string } {
  const safety = checkLlmProviderBaseUrlSafety(entry.baseURL);
  if (safety.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    error: 'INVALID_FIELD',
    message: `base_url is not a safe provider target: ${safety.reason ?? 'unsafe URL'}`,
  };
}

function applyAiOpsProviderConfig(ctx: AppContext, entry: LLMProviderEntry): OpenLanderConfig {
  const current = loadConfig();
  const existingProviders = current.llm.providers ?? {};
  const nextProviders: Record<string, LLMProviderEntry> = {
    ...existingProviders,
    [AI_OPS_PROVIDER_ID]: entry,
  };
  const defaultRoute =
    current.llm.defaultRoute && nextProviders[current.llm.defaultRoute.providerId]
      ? current.llm.defaultRoute
      : { providerId: '__none__' };
  const nextLlm: OpenLanderConfig['llm'] = {
    ...current.llm,
    providers: nextProviders,
    defaultRoute,
    routes: {
      ...(current.llm.routes ?? {}),
      aiOpsBriefing: {
        providerId: AI_OPS_PROVIDER_ID,
        model: entry.defaultModel,
      },
    },
  };

  const nextConfig: OpenLanderConfig = {
    ...current,
    llm: nextLlm,
  };

  saveConfig(nextConfig);
  ctx.config.llm = nextConfig.llm;
  ctx.modelRegistry.updateConfig(normalizeLlmConfig(ctx.config.llm));
  return nextConfig;
}

function removeAiOpsProviderConfig(ctx: AppContext): OpenLanderConfig {
  const current = loadConfig();
  const providers = Object.fromEntries(
    Object.entries(current.llm.providers ?? {}).filter(([id]) => id !== AI_OPS_PROVIDER_ID),
  );
  const routes = Object.fromEntries(
    Object.entries(current.llm.routes ?? {}).filter(([feature]) => feature !== 'aiOpsBriefing'),
  );
  const remainingProviderIds = Object.keys(providers);
  const defaultRoute =
    current.llm.defaultRoute && providers[current.llm.defaultRoute.providerId]
      ? current.llm.defaultRoute
      : { providerId: remainingProviderIds[0] ?? '__none__' };
  const nextLlm: OpenLanderConfig['llm'] = {
    ...current.llm,
    providers,
    defaultRoute,
    routes,
  };

  const nextConfig: OpenLanderConfig = {
    ...current,
    llm: nextLlm,
  };

  saveConfig(nextConfig);
  ctx.config.llm = nextConfig.llm;
  ctx.modelRegistry.updateConfig(normalizeLlmConfig(ctx.config.llm));
  return nextConfig;
}

function serializeHealth(status: Awaited<ReturnType<typeof testLlmProviderEntry>>) {
  return {
    ok: status.ok,
    latency_ms: status.latencyMs ?? null,
    checked_at: status.checkedAt.toISOString(),
    error: status.error ? sanitizeLlmErrorMessage(status.error) : null,
  };
}

export function createAiProviderRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/settings/ai-providers', (c) => {
    const rejected = requireWebSession(c);
    if (rejected) return rejected;

    return c.json({
      status: 'ok',
      provider: serializeEntry(getAiOpsEntry(ctx.config)),
      message:
        'Provider setup only connects an LLM for AI Ops summaries. Project AI Ops remains opt-in.',
    });
  });

  api.put('/settings/ai-providers/ai-ops-briefing', async (c) => {
    const rejected = requireWebSession(c);
    if (rejected) return rejected;

    const body = await readBody(c);
    if (!body) {
      return c.json({ error: 'INVALID_BODY', message: 'Request body must be valid JSON' }, 400);
    }

    const built = buildEntryFromBody(body, getAiOpsEntry(ctx.config));
    if ('error' in built) {
      return c.json({ error: built.error, message: built.message }, 400);
    }
    const baseUrlSafety = validateBaseUrl(built.entry);
    if (!baseUrlSafety.ok) {
      return c.json({ error: baseUrlSafety.error, message: baseUrlSafety.message }, 400);
    }

    try {
      applyAiOpsProviderConfig(ctx, built.entry);
      return c.json({
        status: 'saved',
        provider: serializeEntry(built.entry),
        ai_ops_enabled_by_provider: false,
        _agent_guidance: {
          message:
            'AI provider saved. This does not enable AI Ops; enable Briefing on a Project when you want OpenLander to create read-only briefings.',
        },
      });
    } catch (err) {
      log.warn({ err }, 'Failed to save AI provider');
      return c.json({ error: 'SAVE_FAILED', message: 'Failed to save AI provider' }, 500);
    }
  });

  api.post('/settings/ai-providers/ai-ops-briefing/test', async (c) => {
    const rejected = requireWebSession(c);
    if (rejected) return rejected;

    const body = await readBody(c);
    if (!body) {
      return c.json({ error: 'INVALID_BODY', message: 'Request body must be valid JSON' }, 400);
    }

    const built = buildEntryFromBody(body, getAiOpsEntry(ctx.config));
    if ('error' in built) {
      return c.json({ error: built.error, message: built.message }, 400);
    }
    const baseUrlSafety = validateBaseUrl(built.entry);
    if (!baseUrlSafety.ok) {
      return c.json({ error: baseUrlSafety.error, message: baseUrlSafety.message }, 400);
    }

    const health = await testLlmProviderEntry(built.entry);
    return c.json({
      status: health.ok ? 'ok' : 'failed',
      provider: serializeEntry(built.entry),
      health: serializeHealth(health),
      ai_ops_enabled_by_provider: false,
    });
  });

  api.delete('/settings/ai-providers/ai-ops-briefing', (c) => {
    const rejected = requireWebSession(c);
    if (rejected) return rejected;

    try {
      removeAiOpsProviderConfig(ctx);
      return c.json({
        status: 'deleted',
        provider: serializeEntry(null),
        ai_ops_enabled_by_provider: false,
      });
    } catch (err) {
      log.warn({ err }, 'Failed to delete AI provider');
      return c.json({ error: 'DELETE_FAILED', message: 'Failed to delete AI provider' }, 500);
    }
  });

  return api;
}
