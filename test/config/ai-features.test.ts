import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

import type { AppContext } from '../../src/app.js';
import type { AIFeaturesConfig } from '../../src/config/index.js';
import { Database } from '../../src/db/index.js';
import { createSetupRoutes } from '../../src/web/api/setup-routes.js';
import { createMockContext } from '../helpers/web-route-mocks.js';

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
  autoRecovery: { enabled: true },
  buildDebugger: { enabled: true },
  webAgent: { enabled: true },
  envDetection: { enabled: true },
  secretScan: { enabled: true },
  rollbackSuggestion: { enabled: true },
  operationalMonitoring: { enabled: true },
};

const ALL_FEATURE_KEYS: Array<keyof AIFeaturesConfig> = [
  'autoRecovery',
  'buildDebugger',
  'webAgent',
  'envDetection',
  'secretScan',
  'rollbackSuggestion',
  'operationalMonitoring',
];

describe('AI Features Config Defaults', () => {
  it('all 7 AI feature toggles default to enabled', () => {
    for (const key of ALL_FEATURE_KEYS) {
      expect(AI_DEFAULTS[key].enabled).toBe(true);
    }
    expect(Object.keys(AI_DEFAULTS)).toHaveLength(7);
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
    expect(ai.buildDebugger.enabled).toBe(true);
    expect(ai.webAgent.enabled).toBe(true);
    expect(ai.envDetection.enabled).toBe(true);
    expect(ai.secretScan.enabled).toBe(true);
    expect(ai.rollbackSuggestion.enabled).toBe(true);
    expect(ai.operationalMonitoring.enabled).toBe(true);
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
    expect(ai.autoRecovery.enabled).toBe(true);
  });
});

describe('AI Features API Endpoints', () => {
  let app: Hono;
  let db: Database;
  let tmpDir: string;
  let ctx: AppContext;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-ai-features-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    ctx = createMockContext(db);
    ctx.config = {
      ...ctx.config,
      ai: { ...AI_DEFAULTS },
    };
    app = new Hono();
    app.route('/api', createSetupRoutes(ctx));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/setup/ai-features returns 200 with all 7 features', async () => {
    const res = await app.request('/api/setup/ai-features');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { features: Record<string, unknown> };
    expect(Object.keys(body.features)).toHaveLength(7);

    for (const key of ALL_FEATURE_KEYS) {
      const feature = body.features[key] as { enabled: boolean; available: boolean };
      expect(feature.enabled).toBe(true);
      expect(feature.available).toBe(false);
    }
  });

  it('GET /api/setup/ai-features reports available=true when model exists', async () => {
    ctx.model = {} as AppContext['model'];

    const res = await app.request('/api/setup/ai-features');
    expect(res.status).toBe(200);

    const body = (await res.json()) as { features: Record<string, unknown> };
    for (const key of ALL_FEATURE_KEYS) {
      const feature = body.features[key] as { enabled: boolean; available: boolean };
      expect(feature.available).toBe(true);
    }
  });

  it('PUT /api/setup/ai-features updates enabled state and returns updated object', async () => {
    vi.spyOn(await import('../../src/config/index.js'), 'loadConfig').mockReturnValue({
      ...ctx.config,
    });
    vi.spyOn(await import('../../src/config/index.js'), 'updateConfig').mockImplementation(
      (partial) => {
        const merged = deepMerge(
          ctx.config as unknown as Record<string, unknown>,
          partial as Record<string, unknown>,
        ) as unknown as AppContext['config'];
        return merged;
      },
    );

    const res = await app.request('/api/setup/ai-features', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        autoRecovery: { enabled: false },
        webAgent: { enabled: false },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { features: Record<string, unknown> };
    expect((body.features.autoRecovery as { enabled: boolean }).enabled).toBe(false);
    expect((body.features.webAgent as { enabled: boolean }).enabled).toBe(false);
    expect((body.features.buildDebugger as { enabled: boolean }).enabled).toBe(true);
    expect((body.features.secretScan as { enabled: boolean }).enabled).toBe(true);
  });
});
