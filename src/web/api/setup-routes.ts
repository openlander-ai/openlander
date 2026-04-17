import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { loadConfig, saveConfig, updateConfig, normalizeLlmConfig } from '../../config/index.js';
import { loadDecryptedToken } from '../../auth/token-store.js';
import type { AIFeaturesConfig, LLMRoute, AIModelFeature } from '../../config/index.js';
import type { LLMConfig } from '../../llm/index.js';
import type { LLMProviderType } from '../../llm/providers.js';
import { LLM_PROVIDERS } from '../../llm/providers.js';
import { createModuleLogger } from '../../lib/logger.js';
import { createCloudflareSetupRoutes } from './setup/cloudflare-routes.js';
import { createGithubSetupRoutes } from './setup/github-routes.js';
import { createMcpSetupRoutes } from './setup/mcp-routes.js';
import {
  getLlmRuntimeStatus,
  reloadAgent,
  resolveDefaultLlmProvider,
  runLlmConnectivityTest,
  syncLlmRuntime,
} from './setup/shared.js';

const log = createModuleLogger('setup-routes');

function isValidProvider(provider: string): provider is LLMProviderType {
  return LLM_PROVIDERS.includes(provider as LLMProviderType);
}

// Benchmark-based provider scores (1-5). Sources: MMLU, BFCL v3, ReliabilityBench, MCPMark (2025-2026)
//                          reasoning  speed  toolUse  cost
// anthropic (sonnet-4)     MMLU 90%   44t/s  BFCL 70% $3.00/1M
// openai (gpt-4o)          MMLU 88%   80t/s  BFCL~85% $2.50/1M
// gemini (2.5-flash)       MMLU 85%   200t/s RBench96% $0.30/1M
// deepseek (V3)            MMLU 89%   48t/s  82%      $0.28/1M
// xai (grok-3-mini-fast)   MMLU~80%   190t/s 78%      $0.60/1M
// mistral (large)          MMLU 86%   90t/s  88%      $2.00/1M
// zai (glm-4.7)            MMLU~82%   120t/s 71%      $0.60/1M
const PROVIDER_SCORES: Record<
  string,
  { reasoning: number; speed: number; toolUse: number; cost: number }
> = {
  anthropic: { reasoning: 5, speed: 2, toolUse: 5, cost: 5 },
  openai: { reasoning: 5, speed: 3, toolUse: 5, cost: 4 },
  gemini: { reasoning: 4, speed: 5, toolUse: 4, cost: 1 },
  xai: { reasoning: 3, speed: 5, toolUse: 3, cost: 2 },
  deepseek: { reasoning: 5, speed: 3, toolUse: 3, cost: 1 },
  mistral: { reasoning: 4, speed: 3, toolUse: 4, cost: 3 },
  zai: { reasoning: 4, speed: 3, toolUse: 3, cost: 2 },
  'zai-coding': { reasoning: 4, speed: 3, toolUse: 3, cost: 2 },
};

const FEATURE_WEIGHTS: Record<
  string,
  {
    primary: keyof (typeof PROVIDER_SCORES)['gemini'];
    secondary: keyof (typeof PROVIDER_SCORES)['gemini'];
  }
> = {
  codingPlan: { primary: 'reasoning', secondary: 'toolUse' },
  autoRecovery: { primary: 'toolUse', secondary: 'reasoning' },
  buildDebugger: { primary: 'reasoning', secondary: 'speed' },
  webAgent: { primary: 'toolUse', secondary: 'reasoning' },
  envDetection: { primary: 'speed', secondary: 'reasoning' },
  secretScan: { primary: 'speed', secondary: 'reasoning' },
  rollbackSuggestion: { primary: 'speed', secondary: 'reasoning' },
  operationalMonitoring: { primary: 'speed', secondary: 'toolUse' },
};

type ModelTier = 'flagship' | 'balanced' | 'lite';

const FEATURE_TIER: Record<string, ModelTier> = {
  codingPlan: 'flagship',
  autoRecovery: 'flagship',
  webAgent: 'flagship',
  buildDebugger: 'balanced',
  rollbackSuggestion: 'balanced',
  envDetection: 'lite',
  secretScan: 'lite',
  operationalMonitoring: 'lite',
};

const PROVIDER_MODEL_TIERS: Record<string, Record<ModelTier, string>> = {
  anthropic: {
    flagship: 'claude-sonnet-4-20250514',
    balanced: 'claude-sonnet-4-20250514',
    lite: 'claude-haiku-4-5-20251001',
  },
  openai: { flagship: 'gpt-4o', balanced: 'gpt-4o', lite: 'gpt-4o-mini' },
  gemini: { flagship: 'gemini-2.5-pro', balanced: 'gemini-2.5-flash', lite: 'gemini-2.5-flash' },
  xai: { flagship: 'grok-3-fast', balanced: 'grok-3-mini-fast', lite: 'grok-3-mini-fast' },
  deepseek: { flagship: 'deepseek-reasoner', balanced: 'deepseek-chat', lite: 'deepseek-chat' },
  mistral: {
    flagship: 'mistral-large-latest',
    balanced: 'mistral-medium-latest',
    lite: 'mistral-small-latest',
  },
  zai: { flagship: 'glm-5.1', balanced: 'glm-4.7', lite: 'glm-4.7-flash' },
  'zai-coding': { flagship: 'glm-5.1', balanced: 'glm-4.7', lite: 'glm-4.7-flash' },
};

export function createSetupRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/setup/status', async (c) => {
    const [dockerStatus, traefikOk] = await Promise.all([
      ctx.docker.status(),
      ctx.traefik.isRunning().catch(() => false),
    ]);

    const config = loadConfig();
    const dockerOk = dockerStatus.state === 'running';
    const llmStatus = getLlmRuntimeStatus(config, ctx.llmVerified);
    const hasPassword = ctx.db.isPasswordSet();

    const ready = dockerOk && hasPassword;

    let dockerMessage: string;
    if (dockerStatus.state === 'running') {
      dockerMessage = 'Docker is running.';
    } else if (dockerStatus.state === 'not_installed') {
      dockerMessage = 'Docker is not installed. Install it to continue.';
    } else if (dockerStatus.state === 'not_running') {
      dockerMessage = 'Docker is installed but the daemon is not running. Start it to continue.';
    } else if (dockerStatus.groupFixed) {
      dockerMessage =
        'Permission fixed! Restart OpenLander for the change to take effect. (Ctrl+C, then `openlander start`)';
    } else {
      dockerMessage =
        'Docker is installed but your user lacks permission. Add yourself to the docker group.';
    }

    return c.json({
      ready,
      hasPassword,
      docker: {
        ok: dockerOk,
        state: dockerStatus.state,
        groupFixed:
          dockerStatus.state === 'permission_denied' ? dockerStatus.groupFixed : undefined,
        message: dockerMessage,
      },
      traefik: {
        ok: traefikOk,
        message: traefikOk
          ? 'Traefik is running'
          : 'Traefik is not running. Click "Start Traefik" to set it up.',
      },
      llm: {
        ok: llmStatus.configured,
        provider: llmStatus.provider,
        model: llmStatus.model,
        message:
          llmStatus.state === 'offline'
            ? 'No LLM configured. Connect a provider and token/API key.'
            : llmStatus.state === 'online'
              ? `${llmStatus.provider} (${llmStatus.model})`
              : `${llmStatus.provider} (${llmStatus.model}) configured, but the latest connection test failed.`,
      },
      github: {
        ok: Boolean(config.gitProviders.github.token),
        username: config.gitProviders.github.username || null,
        message: config.gitProviders.github.token
          ? `Connected as ${config.gitProviders.github.username || 'unknown'}`
          : 'No GitHub token configured. Add one to browse and deploy private repos.',
      },
      language: config.language,
    });
  });

  api.post('/setup/llm', async (c) => {
    const body = await c.req.json<{
      provider: string;
      api_key?: string;
      auth_token?: string;
      model?: string;
    }>();

    const provider = body.provider;
    const rawApiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
    const rawAuthToken = typeof body.auth_token === 'string' ? body.auth_token.trim() : '';
    const isOauthProvider = provider === 'openai';

    if (!provider) {
      return c.json({ error: 'MISSING_FIELD', message: 'provider is required' }, 400);
    }

    const validProviders = [...LLM_PROVIDERS];
    if (!isValidProvider(provider)) {
      return c.json(
        {
          error: 'INVALID_PROVIDER',
          message: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
        },
        400,
      );
    }

    const modelDefaults: Record<string, string> = {
      gemini: 'gemini-2.5-flash',
      anthropic: 'claude-sonnet-4-20250514',
      openai: 'gpt-4o',
      xai: 'grok-3-mini-fast',
      deepseek: 'deepseek-chat',
      mistral: 'mistral-large-latest',
      zai: 'glm-4.7',
      'zai-coding': 'glm-4.7',
    };

    const model = body.model || modelDefaults[provider] || 'gemini-2.5-flash';
    const storedOauthToken = isOauthProvider
      ? (loadDecryptedToken(ctx.db, provider)?.accessToken ?? '')
      : '';
    const authToken = rawAuthToken || storedOauthToken;

    if (isOauthProvider && !rawApiKey && !authToken) {
      return c.json({ error: 'MISSING_FIELD', message: 'api_key or auth token is required' }, 400);
    }

    if (!isOauthProvider && !rawApiKey) {
      return c.json({ error: 'MISSING_FIELD', message: 'api_key is required' }, 400);
    }

    const apiKey = !isOauthProvider || rawApiKey ? rawApiKey : '';
    const resolvedAuthToken = isOauthProvider && !apiKey ? authToken : '';

    const updated = updateConfig({
      llm: {
        provider: provider,
        apiKey,
        authToken: resolvedAuthToken,
        model,
      },
    });
    ctx.config = updated;

    try {
      await syncLlmRuntime(ctx);

      const verifyResult = await runLlmConnectivityTest({
        provider: provider,
        apiKey,
        authToken: resolvedAuthToken || undefined,
        model,
      });
      if (verifyResult.ok) {
        ctx.llmVerified = true;
      } else {
        ctx.llmVerified = false;
      }

      return c.json({
        status: 'configured',
        provider: body.provider,
        model,
        hot_reloaded: true,
        llmVerified: ctx.llmVerified,
        message: ctx.llmVerified
          ? 'LLM configured and verified.'
          : (verifyResult.error ??
            'LLM configured but connectivity test failed. Check your API key.'),
      });
    } catch (error) {
      ctx.llmVerified = false;
      await syncLlmRuntime(ctx).catch(() => undefined);
      return c.json({
        status: 'configured',
        provider: body.provider,
        model,
        hot_reloaded: false,
        message: 'LLM config saved. Restart the server to activate.',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  api.post('/setup/llm/test', async (c) => {
    const body = await c.req
      .json<{
        provider_id?: string;
        provider?: string;
        api_key?: string;
        auth_token?: string;
        model?: string;
      }>()
      .catch(
        (): {
          provider_id?: string;
          provider?: string;
          api_key?: string;
          auth_token?: string;
          model?: string;
        } => ({}),
      );

    const config = loadConfig();
    const providerId = typeof body.provider_id === 'string' ? body.provider_id.trim() : '';
    let persistVerification = false;

    let provider: LLMConfig['provider'];
    let model: string;
    let apiKey = '';
    let authToken: string | undefined;
    if (providerId) {
      const normalized = normalizeLlmConfig(config.llm);
      const entry = normalized.providers[providerId];
      if (!entry) {
        return c.json({ ok: false, providerId, error: 'Provider not found' }, 404);
      }

      provider = entry.provider;
      model = body.model ?? entry.defaultModel;
      apiKey = body.api_key?.trim() || entry.apiKey || '';
      authToken = body.auth_token?.trim() || entry.authToken;
      persistVerification = normalized.defaultRoute.providerId === providerId;
    } else {
      const useStoredDefault =
        !body.provider && !body.api_key && !body.auth_token && !body.model && !body.provider_id;
      const resolvedDefault = useStoredDefault ? resolveDefaultLlmProvider(config) : null;

      provider = (body.provider ||
        resolvedDefault?.provider ||
        config.llm.provider) as LLMConfig['provider'];
      model = body.model || resolvedDefault?.model || config.llm.model;
      apiKey = body.api_key?.trim() || resolvedDefault?.apiKey || config.llm.apiKey;
      authToken =
        body.auth_token?.trim() || resolvedDefault?.authToken || config.llm.authToken || undefined;
      persistVerification = useStoredDefault;
    }

    if (!apiKey && !authToken) {
      return c.json(
        { ok: false, providerId: providerId || undefined, error: 'No API key configured' },
        400,
      );
    }

    const result = await runLlmConnectivityTest({
      provider,
      apiKey,
      authToken,
      model,
    });
    if (persistVerification) {
      ctx.llmVerified = result.ok;
    }

    if (result.ok) {
      return c.json({
        ok: true,
        providerId: providerId || undefined,
        provider,
        model,
        latencyMs: result.latencyMs ?? 0,
      });
    }

    return c.json({
      ok: false,
      providerId: providerId || undefined,
      provider,
      model,
      error: result.error ?? 'Connection failed',
    });
  });

  api.delete('/setup/llm', async (c) => {
    const config = loadConfig();
    const updated = {
      ...config,
      llm: {
        ...config.llm,
        provider: 'gemini' as const,
        apiKey: '',
        authToken: '',
        model: 'gemini-2.5-flash',
        providers: {},
        defaultRoute: { providerId: '__none__' },
        routes: {},
      },
    };
    saveConfig(updated);
    ctx.config = updated;

    ctx.llmVerified = false;
    await syncLlmRuntime(ctx);
    log.info('LLM configuration removed');

    return c.json({ status: 'removed', message: 'LLM configuration cleared.' });
  });

  api.post('/setup/traefik', async (c) => {
    try {
      const isRunning = await ctx.traefik.isRunning();
      if (isRunning) {
        return c.json({ status: 'already_running', message: 'Traefik is already running.' });
      }

      await ctx.traefik.start();
      return c.json({ status: 'started', message: 'Traefik started successfully.' });
    } catch (error) {
      return c.json(
        {
          status: 'failed',
          message: 'Failed to start Traefik.',
          error: error instanceof Error ? error.message : String(error),
        },
        500,
      );
    }
  });

  api.post('/setup/language', async (c) => {
    const body = await c.req.json<{ language: string }>();

    if (body.language !== 'en' && body.language !== 'ko') {
      return c.json({ error: 'INVALID_LANGUAGE', message: 'Language must be "en" or "ko"' }, 400);
    }

    const language = body.language;
    updateConfig({ language });
    ctx.config.language = language;

    if (ctx.agent) {
      try {
        const llmModel = await reloadAgent(ctx, {
          provider: ctx.config.llm.provider,
          apiKey: ctx.config.llm.apiKey,
          model: ctx.config.llm.model,
          authToken: ctx.config.llm.authToken || undefined,
          language,
        });

        if (ctx.buildDebugger) {
          const { BuildDebugger } = await import('../../pipeline/build-debugger.js');
          ctx.buildDebugger = new BuildDebugger(llmModel, language);
        }
      } catch (err) {
        log.error({ err, language }, 'Agent hot-reload failed');
      }
    }

    return c.json({ status: 'saved', language });
  });

  api.get('/setup/ai-features', (c) => {
    const config = ctx.config;
    const hasModel = ctx.model !== null;

    const featureKeys: Array<keyof AIFeaturesConfig> = [
      'autoRecovery',
      'buildDebugger',
      'webAgent',
      'envDetection',
      'secretScan',
      'rollbackSuggestion',
      'operationalMonitoring',
      'codingPlan',
    ];

    const features: Record<
      string,
      { enabled: boolean; available: boolean; providerId?: string; model?: string }
    > = {};
    for (const key of featureKeys) {
      const toggle = config.ai[key];
      features[key] = {
        enabled: toggle.enabled,
        available: hasModel,
        ...(toggle.providerId !== undefined && { providerId: toggle.providerId }),
        ...(toggle.model !== undefined && { model: toggle.model }),
      };
    }

    return c.json({ features });
  });

  api.put('/setup/ai-features', async (c) => {
    const body =
      await c.req.json<
        Partial<
          Record<keyof AIFeaturesConfig, { enabled: boolean; providerId?: string; model?: string }>
        >
      >();

    const config = loadConfig();
    const merged: AIFeaturesConfig = { ...config.ai };
    for (const [key, value] of Object.entries(body)) {
      if (key in merged) {
        const existing = merged[key as keyof AIFeaturesConfig];
        merged[key as keyof AIFeaturesConfig] = {
          ...existing,
          enabled: value.enabled,
          ...(value.providerId !== undefined && { providerId: value.providerId }),
          ...(value.model !== undefined && { model: value.model }),
        };
      }
    }

    const updated = updateConfig({ ai: merged });
    ctx.config = updated;

    const normalizedLlm = normalizeLlmConfig(updated.llm);
    const newRoutes: Partial<Record<AIModelFeature, LLMRoute>> = {};
    const featureRoutingKeys: AIModelFeature[] = [
      'autoRecovery',
      'buildDebugger',
      'webAgent',
      'envDetection',
      'operationalMonitoring',
      'codingPlan',
      'secretScan',
      'rollbackSuggestion',
    ];
    for (const fk of featureRoutingKeys) {
      const toggle = updated.ai[fk];
      if (toggle.providerId) {
        newRoutes[fk] = { providerId: toggle.providerId, model: toggle.model };
      }
    }
    ctx.modelRegistry.updateConfig({
      providers: normalizedLlm.providers,
      defaultRoute: normalizedLlm.defaultRoute,
      routes: { ...normalizedLlm.routes, ...newRoutes },
    });

    const hasModel = ctx.model !== null;
    const featureKeys: Array<keyof AIFeaturesConfig> = [
      'autoRecovery',
      'buildDebugger',
      'webAgent',
      'envDetection',
      'secretScan',
      'rollbackSuggestion',
      'operationalMonitoring',
      'codingPlan',
    ];

    const features: Record<
      string,
      { enabled: boolean; available: boolean; providerId?: string; model?: string }
    > = {};
    for (const key of featureKeys) {
      const toggle = updated.ai[key];
      features[key] = {
        enabled: toggle.enabled,
        available: hasModel,
        ...(toggle.providerId !== undefined && { providerId: toggle.providerId }),
        ...(toggle.model !== undefined && { model: toggle.model }),
      };
    }

    return c.json({ features });
  });

  api.get('/setup/providers', (c) => {
    const config = loadConfig();
    const providers = config.llm.providers ?? {};
    const allHealth = ctx.providerHealth.getAllHealth();

    const masked = Object.entries(providers).map(([id, entry]) => {
      const health = allHealth.get(id);
      const cbStatus = ctx.modelRegistry.getCircuitBreakerStatusByProvider(id);
      return {
        id,
        provider: entry.provider,
        defaultModel: entry.defaultModel,
        hasApiKey: !!(entry.apiKey || entry.authToken),
        apiKeyPreview: entry.apiKey
          ? entry.apiKey.substring(0, 6) + '······'
          : entry.authToken
            ? '(oauth)'
            : '',
        createdAt: entry.createdAt ?? null,
        health: health
          ? {
              ok: health.ok,
              latencyMs: health.latencyMs,
              error: health.error,
              checkedAt: health.checkedAt.toISOString(),
            }
          : null,
        circuitBreaker: cbStatus,
      };
    });

    return c.json({ providers: masked });
  });

  api.post('/setup/providers/default', async (c) => {
    const body = await c.req.json<{ providerId?: string }>();
    const providerId = typeof body.providerId === 'string' ? body.providerId.trim() : '';

    if (!providerId) {
      return c.json({ error: 'MISSING_FIELD', message: 'providerId is required' }, 400);
    }

    const config = loadConfig();
    const providers = config.llm.providers ?? {};
    if (!(providerId in providers)) {
      return c.json({ error: 'NOT_FOUND', message: `Provider "${providerId}" not found` }, 404);
    }

    const previousDefaultProviderId = normalizeLlmConfig(config.llm).defaultRoute.providerId;
    const updated = updateConfig({ llm: { defaultRoute: { providerId } } });
    ctx.config = updated;

    if (providerId !== previousDefaultProviderId) {
      ctx.llmVerified = false;
    }

    await syncLlmRuntime(ctx);

    return c.json({ status: 'updated', providerId });
  });

  api.post('/setup/providers', async (c) => {
    const body = await c.req.json<{
      id: string;
      provider: string;
      apiKey?: string;
      authToken?: string;
      defaultModel: string;
    }>();

    if (!body.id || !body.provider || !body.defaultModel) {
      return c.json(
        { error: 'MISSING_FIELD', message: 'id, provider, and defaultModel are required' },
        400,
      );
    }

    const validProviders = [...LLM_PROVIDERS];
    if (!isValidProvider(body.provider)) {
      return c.json(
        {
          error: 'INVALID_PROVIDER',
          message: `Invalid provider. Must be one of: ${validProviders.join(', ')}`,
        },
        400,
      );
    }

    if (!body.apiKey && !body.authToken) {
      return c.json({ error: 'MISSING_FIELD', message: 'apiKey or authToken is required' }, 400);
    }

    const existingConfig = loadConfig();
    if (existingConfig.llm.providers?.[body.id]) {
      return c.json(
        { error: 'DUPLICATE_PROVIDER_ID', message: 'Provider with this ID already exists' },
        400,
      );
    }

    const testResult = await runLlmConnectivityTest({
      provider: body.provider,
      model: body.defaultModel,
      apiKey: body.apiKey,
      authToken: body.authToken,
    });

    if (!testResult.ok) {
      return c.json(
        {
          error: 'CONNECTION_FAILED',
          message: testResult.error ?? 'Connection test failed. Check your API key and try again.',
          latencyMs: testResult.latencyMs,
        },
        400,
      );
    }

    const config = loadConfig();
    const previousDefaultProviderId = normalizeLlmConfig(config.llm).defaultRoute.providerId;
    const existingProviders = config.llm.providers ?? {};

    const updatedProviders = {
      ...existingProviders,
      [body.id]: {
        provider: body.provider,
        apiKey: body.apiKey,
        authToken: body.authToken,
        defaultModel: body.defaultModel,
        createdAt: new Date().toISOString(),
      },
    };

    const existingDefaultRoute = config.llm.defaultRoute;
    const hasValidExistingDefault =
      !!existingDefaultRoute &&
      existingDefaultRoute.providerId !== '__none__' &&
      existingDefaultRoute.providerId in updatedProviders;
    const defaultRoute = hasValidExistingDefault ? existingDefaultRoute : { providerId: body.id };

    const updated = updateConfig({
      llm: { providers: updatedProviders, defaultRoute },
    });
    ctx.config = updated;

    const normalizedUpdated = normalizeLlmConfig(updated.llm);
    const activeProviderId = normalizedUpdated.defaultRoute.providerId;
    if (activeProviderId !== previousDefaultProviderId || activeProviderId === body.id) {
      ctx.llmVerified = false;
    }

    await syncLlmRuntime(ctx);

    const latestConfig = loadConfig();
    const allProviders = latestConfig.llm.providers ?? {};
    const recommendations = computeRecommendations(allProviders);
    applyRecommendations(recommendations);
    await syncLlmRuntime(ctx);

    return c.json({
      status: 'added',
      id: body.id,
      verified: true,
      latencyMs: testResult.latencyMs,
      recommendations,
    });
  });

  api.delete('/setup/providers/:id', async (c) => {
    const id = c.req.param('id');
    const config = loadConfig();
    const providers = config.llm.providers ?? {};

    if (!(id in providers)) {
      return c.json({ error: 'NOT_FOUND', message: `Provider "${id}" not found` }, 404);
    }

    if (Object.keys(providers).length === 1) {
      const updated = {
        ...config,
        llm: {
          ...config.llm,
          provider: 'gemini' as const,
          apiKey: '',
          authToken: '',
          model: 'gemini-2.5-flash',
          providers: {},
          defaultRoute: { providerId: '__none__' },
          routes: {},
        },
      };
      saveConfig(updated);
      ctx.config = updated;
      ctx.llmVerified = false;
      await syncLlmRuntime(ctx);
      log.info({ providerId: id }, 'Last LLM provider removed, AI disconnected');
      return c.json({ status: 'removed', id, llmDisconnected: true });
    }

    const defaultProviderId = config.llm.defaultRoute?.providerId;
    if (defaultProviderId === id) {
      return c.json(
        {
          error: 'DEFAULT_PROVIDER',
          message: 'Cannot delete the default provider. Reassign defaultRoute first.',
          suggestion: '다른 제공자를 기본으로 먼저 지정한 후 삭제하세요.',
        },
        400,
      );
    }

    const { [id]: _removed, ...remainingProviders } = providers;

    const existingRoutes = config.llm.routes ?? {};
    const cleanedRoutes = Object.fromEntries(
      Object.entries(existingRoutes).filter(([, route]) => route.providerId !== id),
    );

    // Use saveConfig directly — deepMerge cannot remove keys from Record fields
    const updated = {
      ...config,
      llm: { ...config.llm, providers: remainingProviders, routes: cleanedRoutes },
    };
    saveConfig(updated);
    ctx.config = updated;

    const aiConfig = updated.ai;
    const aiKeys: Array<keyof typeof aiConfig> = [
      'autoRecovery',
      'buildDebugger',
      'webAgent',
      'envDetection',
      'operationalMonitoring',
      'codingPlan',
    ];
    let aiUpdated = false;
    const newAiConfig = { ...aiConfig };
    for (const key of aiKeys) {
      if (newAiConfig[key].providerId === id) {
        newAiConfig[key] = { ...newAiConfig[key], providerId: undefined, model: undefined };
        aiUpdated = true;
      }
    }
    if (aiUpdated) {
      const updatedWithAi = updateConfig({ ai: newAiConfig });
      ctx.config = updatedWithAi;
    }

    await syncLlmRuntime(ctx);

    return c.json({ status: 'removed', id });
  });

  function computeRecommendations(
    providers: Record<string, { provider: string; defaultModel: string }>,
  ): Record<string, { providerId: string; model: string }> {
    const recommendations: Record<string, { providerId: string; model: string }> = {};
    const providerEntries = Object.entries(providers);

    for (const [feature, weights] of Object.entries(FEATURE_WEIGHTS)) {
      let bestScore = -1;
      let bestProviderId = '';
      let bestModel = '';

      const tier = FEATURE_TIER[feature] ?? 'balanced';

      for (const [id, entry] of providerEntries) {
        const scores = PROVIDER_SCORES[entry.provider];
        if (!scores) continue;

        const score =
          scores[weights.primary] * 3 + scores[weights.secondary] * 2 - scores.cost * 0.1;
        if (score > bestScore) {
          bestScore = score;
          bestProviderId = id;
          bestModel = PROVIDER_MODEL_TIERS[entry.provider]?.[tier] ?? entry.defaultModel;
        }
      }

      if (bestProviderId) {
        recommendations[feature] = { providerId: bestProviderId, model: bestModel };
      }
    }

    return recommendations;
  }

  function applyRecommendations(
    recommendations: Record<string, { providerId: string; model: string }>,
  ): void {
    const config = loadConfig();
    const aiConfig = { ...config.ai };
    const routes: Record<string, LLMRoute> = { ...(config.llm.routes ?? {}) };

    for (const [feature, rec] of Object.entries(recommendations)) {
      const key = feature as keyof typeof aiConfig;
      aiConfig[key] = { ...aiConfig[key], providerId: rec.providerId, model: rec.model };
      routes[feature] = { providerId: rec.providerId, model: rec.model };
    }

    const updated = updateConfig({ ai: aiConfig, llm: { routes } });
    ctx.config = updated;
  }

  api.post('/setup/providers/auto-recommend', (c) => {
    const config = loadConfig();
    const providers = config.llm.providers ?? {};

    if (Object.keys(providers).length === 0) {
      return c.json({ error: 'NO_PROVIDERS', message: 'No providers registered' }, 400);
    }

    const recommendations = computeRecommendations(providers);
    return c.json({ recommendations });
  });

  api.post('/setup/complete', (c) => {
    const config = loadConfig();
    saveConfig(config);
    return c.json({ status: 'complete', message: 'Setup marked as complete.' });
  });

  api.route('/', createCloudflareSetupRoutes(ctx));
  api.route('/', createGithubSetupRoutes(ctx));
  api.route('/', createMcpSetupRoutes(ctx));

  return api;
}
