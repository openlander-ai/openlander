import { describe, expect, it } from 'vitest';

import { dispatchRecovery, type RecoveryCategory } from '../src/pipeline/recovery-dispatch.js';

function classifyRuntimeError(error?: string): RecoveryCategory | null {
  if (!error || error.trim().length === 0) {
    return null;
  }

  return dispatchRecovery('runtime', error).category;
}

describe('Crash scenario classification', () => {
  it('classifies DNS failure error', () => {
    const category = classifyRuntimeError('getaddrinfo ENOTFOUND nonexistent-host-12345');
    expect(category).toBe('network_dns');
  });

  it('classifies OOM error', () => {
    const category = classifyRuntimeError(
      'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory',
    );
    expect(category).toBe('resource_oom');
  });

  it('classifies port conflict error', () => {
    const category = classifyRuntimeError('listen EADDRINUSE: address already in use :::3000');
    expect(category).toBe('port_conflict');
  });

  it('classifies immediate exit as generic runtime (unknown crash subtype)', () => {
    const category = classifyRuntimeError('Fatal startup error');
    expect(category).toBe('runtime_generic');
  });

  it('healthy scenario produces no error classification', () => {
    const category = classifyRuntimeError(undefined);
    expect(category).toBeNull();
  });
});
