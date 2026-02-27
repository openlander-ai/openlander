import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BuildRecovery, type BuildContext } from '../src/pipeline/build-recovery.js';
import type { Docker } from '../src/pipeline/docker.js';
import type { Database } from '../src/db/index.js';
import type { EventBus } from '../src/events/index.js';

describe('BuildRecovery', () => {
  let pruneContainers: ReturnType<typeof vi.fn>;
  let pruneImages: ReturnType<typeof vi.fn>;
  let updateProject: ReturnType<typeof vi.fn>;
  let emit: ReturnType<typeof vi.fn>;
  let recovery: BuildRecovery;

  const context: BuildContext = {
    projectId: 'p1',
    projectName: 'app',
    imageTag: 'app:latest',
    clonePath: '/tmp/app',
    buildLog: 'failed',
    failedStep: 'build',
  };

  beforeEach(() => {
    pruneContainers = vi.fn().mockResolvedValue(undefined);
    pruneImages = vi.fn().mockResolvedValue(undefined);
    updateProject = vi.fn();
    emit = vi.fn().mockResolvedValue(undefined);

    const docker = {
      getClient: vi.fn().mockReturnValue({
        pruneContainers,
        pruneImages,
      }),
    } as unknown as Docker;

    const db = {
      updateProject,
    } as unknown as Database;

    const events = {
      emit,
    } as unknown as EventBus;

    recovery = new BuildRecovery(docker, db, events);
  });

  it('classifies port conflict as Tier 1 auto-fixable', () => {
    const result = recovery.classify('bind: address already in use', context);
    expect(result.tier).toBe(1);
    expect(result.category).toBe('port-conflict');
    expect(result.autoFixable).toBe(true);
  });

  it('classifies disk full as Tier 1 auto-fixable', () => {
    const result = recovery.classify('write /tmp: no space left on device', context);
    expect(result.tier).toBe(1);
    expect(result.category).toBe('disk-full');
    expect(result.autoFixable).toBe(true);
  });

  it('classifies TypeScript compile errors as Tier 3 compile-error', () => {
    const result = recovery.classify(
      'src/index.ts:12:3 - error TS2322: Type x is not assignable',
      context,
    );
    expect(result.tier).toBe(3);
    expect(result.category).toBe('compile-error');
  });

  it('classifies network timeout as Tier 1 network-error', () => {
    const result = recovery.classify(
      'npm ERR! connection timed out while fetching package',
      context,
    );
    expect(result.tier).toBe(1);
    expect(result.category).toBe('network-error');
  });

  it('classifies base image missing as Tier 2 suggestible', () => {
    const result = recovery.classify(
      'manifest unknown: no matching manifest for linux/amd64',
      context,
    );
    expect(result.tier).toBe(2);
    expect(result.category).toBe('base-image');
    expect(result.suggestible).toBe(true);
  });

  it('classifies unknown errors as Tier 3 source-error', () => {
    const result = recovery.classify(
      'unexpected application failure with custom stack trace',
      context,
    );
    expect(result.tier).toBe(3);
    expect(result.category).toBe('source-error');
  });

  it('extracts concise error summary from noisy logs', () => {
    const noisyLog = [
      'downloading layer 1/4',
      'extracting files',
      'Step 5/10 : RUN npm run build',
      'error TS2304: Cannot find name Config',
      '12/13 complete',
      'fatal: build failed due to missing import',
      '=> CACHED',
    ].join('\n');

    const summary = recovery.extractErrorSummary(noisyLog);
    expect(summary).toContain('error TS2304: Cannot find name Config');
    expect(summary).toContain('fatal: build failed due to missing import');
    expect(summary).not.toContain('downloading layer 1/4');
    expect(summary).not.toContain('=> CACHED');
  });

  it('runs Tier 1 disk-full fix by pruning Docker resources', async () => {
    const classified = recovery.classify('ENOSPC: no space left on device', context);

    const result = await recovery.attemptTier1Fix(classified, context);

    expect(result.fixed).toBe(true);
    expect(result.retryNeeded).toBe(true);
    expect(pruneContainers).toHaveBeenCalledOnce();
    expect(pruneImages).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledWith(
      'build:autofix',
      expect.objectContaining({ projectId: 'p1', category: 'disk-full' }),
    );
  });
});
