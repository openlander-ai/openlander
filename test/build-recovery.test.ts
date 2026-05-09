import { describe, expect, it } from 'vitest';

import { BuildRecovery, type BuildContext } from '../src/pipeline/build-recovery.js';

describe('BuildRecovery', () => {
  const recovery = new BuildRecovery();

  const context: BuildContext = {
    projectId: 'p1',
    projectName: 'app',
    imageTag: 'app:latest',
    clonePath: '/tmp/app',
    buildLog: 'failed',
    failedStep: 'build',
  };

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

  it('classifies Node version incompatibility as Tier 2.5 dockerfile-content', () => {
    const result = recovery.classify(
      'error: Node.js version not supported. requires >= 20.9.0',
      context,
    );
    expect(result.tier).toBe(2.5);
    expect(result.category).toBe('dockerfile-content');
    expect(result.autoFixable).toBe(true);
  });

  it('classifies Dockerfile process failure as Tier 2.5 dockerfile-content', () => {
    const result = recovery.classify(
      'failed to solve: process "/bin/sh -c npm run build" did not complete successfully: dockerfile parse error',
      context,
    );
    expect(result.tier).toBe(2.5);
    expect(result.category).toBe('dockerfile-content');
  });

  it('classifies engine incompatible as Tier 2.5 dockerfile-content', () => {
    const result = recovery.classify(
      'npm ERR! engine incompatible: wanted node >=20 but got 18.20.4',
      context,
    );
    expect(result.tier).toBe(2.5);
    expect(result.category).toBe('dockerfile-content');
  });

  it('classifies base image not found as Tier 2.5 dockerfile-content', () => {
    const result = recovery.classify('ERROR: base image not found: node:19-alpine-slim', context);
    expect(result.tier).toBe(2.5);
    expect(result.category).toBe('dockerfile-content');
  });
});
