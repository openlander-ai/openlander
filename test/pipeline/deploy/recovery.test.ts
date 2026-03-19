import { describe, expect, it } from 'vitest';

import {
  RecoveryOrchestrator,
  type FailureContext,
  type RecoveryEngine,
} from '../../../src/pipeline/deploy/recovery.js';

function createFailureContext(overrides: Partial<FailureContext>): FailureContext {
  const classify: RecoveryEngine['classify'] = () => ({
    tier: 3,
    category: 'source-error',
    message: 'fallback',
    autoFixable: false,
    suggestible: false,
    errorSummary: 'fallback',
  });
  const attemptTier1Fix: RecoveryEngine['attemptTier1Fix'] = async () => ({
    fixed: false,
    action: 'none',
    retryNeeded: false,
  });
  const extractErrorSummary: RecoveryEngine['extractErrorSummary'] = () => 'summary';

  return {
    projectId: 'p1',
    projectName: 'demo-app',
    imageTag: 'openlander/demo-app:latest',
    clonePath: '/tmp/repo',
    buildLogWithError: 'build failed',
    failedStep: 'build',
    retryCount: 0,
    buildRecovery: {
      classify,
      attemptTier1Fix,
      extractErrorSummary,
    },
    emit: async () => undefined,
    ...overrides,
  };
}

describe('RecoveryOrchestrator', () => {
  it('returns retry action for Tier 1 auto-fix', async () => {
    const context = createFailureContext({
      retryCount: 1,
      buildRecovery: {
        classify: () => ({
          tier: 1,
          category: 'cache-corrupt',
          message: 'cache error',
          autoFixable: true,
          suggestible: false,
          errorSummary: 'cache error',
        }),
        attemptTier1Fix: async () => ({
          fixed: true,
          action: 'Enabled no-cache rebuild mode for next retry.',
          retryNeeded: true,
        }),
        extractErrorSummary: () => 'cache error',
      },
    });

    const orchestrator = new RecoveryOrchestrator();
    const result = await orchestrator.handleBuildFailure(context);

    expect(result.type).toBe('retry');
    if (result.type === 'retry') {
      expect(result.retryCount).toBe(2);
      expect(result.noCacheBuild).toBe(true);
      expect(result.logMessage).toContain('Tier 1 auto-fix');
    }
  });

  it('emits manual suggestion for Tier 2 suggestible failures', async () => {
    const emitted: Array<{ eventName: string; payload: Record<string, unknown> }> = [];
    const context = createFailureContext({
      buildRecovery: {
        classify: () => ({
          tier: 2,
          category: 'missing-dependency',
          message: 'dependency missing',
          autoFixable: false,
          suggestible: true,
          errorSummary: 'dependency missing',
          suggestedAction: 'Install or declare the missing dependency, then rebuild.',
        }),
        attemptTier1Fix: async () => ({
          fixed: false,
          action: 'none',
          retryNeeded: false,
        }),
        extractErrorSummary: () => 'dependency missing',
      },
      emit: async (eventName, payload) => {
        emitted.push({ eventName, payload });
      },
    });

    const orchestrator = new RecoveryOrchestrator();
    const result = await orchestrator.handleBuildFailure(context);

    expect(result).toEqual({
      type: 'suggest',
      suggestion: 'Install or declare the missing dependency, then rebuild.',
    });
    expect(emitted).toEqual([
      {
        eventName: 'build:suggest',
        payload: {
          projectId: 'p1',
          suggestion: 'Install or declare the missing dependency, then rebuild.',
        },
      },
    ]);
  });

  it('returns exhausted when Tier 1 retries are maxed out', async () => {
    let tier1FixAttempted = false;
    const context = createFailureContext({
      retryCount: 2,
      buildRecovery: {
        classify: () => ({
          tier: 1,
          category: 'network-error',
          message: 'network failed',
          autoFixable: true,
          suggestible: false,
          errorSummary: 'network failed',
        }),
        attemptTier1Fix: async () => {
          tier1FixAttempted = true;
          return {
            fixed: true,
            action: 'retry',
            retryNeeded: true,
          };
        },
        extractErrorSummary: () => 'network failed',
      },
    });

    const orchestrator = new RecoveryOrchestrator();
    const result = await orchestrator.handleBuildFailure(context);

    expect(result).toEqual({ type: 'exhausted' });
    expect(tier1FixAttempted).toBe(false);
  });

  it('returns exhausted and informs user when Tier 2.5 has no debugger', async () => {
    const emitted: Array<{ eventName: string; payload: Record<string, unknown> }> = [];
    const context = createFailureContext({
      buildRecovery: {
        classify: () => ({
          tier: 2.5,
          category: 'dockerfile-content',
          message: 'dockerfile invalid',
          autoFixable: true,
          suggestible: false,
          errorSummary: 'dockerfile invalid',
        }),
        attemptTier1Fix: async () => ({
          fixed: false,
          action: 'none',
          retryNeeded: false,
        }),
        extractErrorSummary: () => 'dockerfile invalid',
      },
      emit: async (eventName, payload) => {
        emitted.push({ eventName, payload });
      },
    });

    const orchestrator = new RecoveryOrchestrator(undefined);
    const result = await orchestrator.handleBuildFailure(context);

    expect(result).toEqual({ type: 'exhausted' });
    expect(emitted).toEqual([
      {
        eventName: 'build:inform',
        payload: {
          projectId: 'p1',
          summary: 'Dockerfile error detected but no LLM configured. Fix Dockerfile manually.',
          tier: 3,
        },
      },
    ]);
  });
});
