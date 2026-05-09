import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

import type { AppContext } from '../../src/app.js';
import type { AIFeaturesConfig } from '../../src/config/index.js';
import { createSetupRoutes } from '../../src/web/api/setup-routes.js';

vi.mock('../../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn().mockResolvedValue({ path: '/tmp/fake-clone' }),
}));

function deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
  const result = { ...target };
  for (const key of Object.keys(source) as Array<keyof T>) {
    const sourceVal = source[key];
    const targetVal = target[key];
    if (
      sourceVal !== undefined &&
      sourceVal !== null &&
      typeof sourceVal === 'object' &&
      !Array.isArray(sourceVal) &&
      typeof targetVal === 'object' &&
      targetVal !== null &&
      !Array.isArray(targetVal)
    ) {
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Partial<Record<string, unknown>>,
      ) as T[keyof T];
    } else if (sourceVal !== undefined) {
      result[key] = sourceVal as T[keyof T];
    }
  }
  return result;
}

const AI_DEFAULTS: AIFeaturesConfig = {
  autoRecovery: { enabled: false },
  buildDebugger: { enabled: false },
  webAgent: { enabled: false },
  envDetection: { enabled: false },
  secretScan: { enabled: false },
  rollbackSuggestion: { enabled: false },
  operationalMonitoring: { enabled: false },
  codingPlan: { enabled: false },
};

const ALL_FEATURE_KEYS: Array<keyof AIFeaturesConfig> = [
  'autoRecovery',
  'buildDebugger',
  'webAgent',
  'envDetection',
  'secretScan',
  'rollbackSuggestion',
  'operationalMonitoring',
  'codingPlan',
];

describe('AI Features Config Defaults', () => {
  it('all 8 AI feature toggles default to disabled', () => {
    for (const key of ALL_FEATURE_KEYS) {
      expect(AI_DEFAULTS[key].enabled).toBe(false);
    }
    expect(Object.keys(AI_DEFAULTS)).toHaveLength(8);
  });

  it('deep merge preserves defaults when ai section is missing from saved config', () => {
    const defaults = { language: 'en', ai: { ...AI_DEFAULTS } } as Record<string, unknown>;
    const saved = { language: 'ko' } as Partial<typeof defaults>;

    const merged = deepMerge(defaults, saved);
    expect(merged.language).toBe('ko');
    expect(merged.ai).toEqual(AI_DEFAULTS);
  });

  it('deep merge preserves unmentioned feature keys when partial ai section provided', () => {
    const defaults = { ai: { ...AI_DEFAULTS } } as Record<string, unknown>;
    const saved = { ai: { autoRecovery: { enabled: false } } } as Partial<typeof defaults>;

    const merged = deepMerge(defaults, saved);
    const ai = merged.ai as AIFeaturesConfig;
    expect(ai.autoRecovery.enabled).toBe(false);
    expect(ai.buildDebugger.enabled).toBe(false);
    expect(ai.webAgent.enabled).toBe(false);
    expect(ai.envDetection.enabled).toBe(false);
    expect(ai.secretScan.enabled).toBe(false);
    expect(ai.rollbackSuggestion.enabled).toBe(false);
    expect(ai.operationalMonitoring.enabled).toBe(false);
  });

  it('existing non-ai config values preserved after deep merge with ai section', () => {
    const defaults = {
      language: 'en',
      server: { port: 10114, host: '0.0.0.0' },
      ai: { ...AI_DEFAULTS },
    } as Record<string, unknown>;

    const saved = {
      language: 'ko',
      server: { port: 3000 },
      ai: { secretScan: { enabled: false } },
    } as Partial<typeof defaults>;

    const merged = deepMerge(defaults, saved);
    expect(merged.language).toBe('ko');
    expect((merged.server as Record<string, unknown>).port).toBe(3000);
    expect((merged.server as Record<string, unknown>).host).toBe('0.0.0.0');
    const ai = merged.ai as AIFeaturesConfig;
    expect(ai.secretScan.enabled).toBe(false);
    expect(ai.autoRecovery.enabled).toBe(false);
  });
});

describe('AI Features API Endpoints', () => {
  let app: Hono;

  beforeEach(() => {
    const ctx = {
      db: {
        isPasswordSet: vi.fn().mockResolvedValue(false),
      },
      docker: {
        status: vi.fn().mockResolvedValue({ state: 'running' }),
      },
      traefik: {
        isRunning: vi.fn().mockResolvedValue(true),
      },
      config: {
        language: 'en',
        ai: { ...AI_DEFAULTS },
        gitProviders: { github: { token: '', username: '' } },
      },
    } as unknown as AppContext;
    app = new Hono();
    app.route('/api', createSetupRoutes(ctx));
  });

  it('GET /api/setup/ai-features is disabled in 0.1', async () => {
    const res = await app.request('/api/setup/ai-features');
    expect(res.status).toBe(410);

    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe('FEATURE_DISABLED');
    expect(body.message).toContain('disabled in OpenLander 0.1');
  });

  it('PUT /api/setup/ai-features is disabled in 0.1', async () => {
    const res = await app.request('/api/setup/ai-features', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoRecovery: { enabled: false },
        webAgent: { enabled: false },
      }),
    });

    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe('FEATURE_DISABLED');
  });
});
