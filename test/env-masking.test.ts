import { describe, it, expect } from 'vitest';

import { EnvManager } from '../src/pipeline/env.js';

describe('Environment Variable Masking', () => {
  it('masks long values: prefix + **** + suffix', () => {
    expect(EnvManager.mask('sk-1234567890abcdef')).toBe('sk-****cdef');
  });

  it('masks medium values', () => {
    expect(EnvManager.mask('my-secret-key')).toBe('my-****-key');
  });

  it('fully masks short values (<= 8 chars)', () => {
    expect(EnvManager.mask('short')).toBe('****');
    expect(EnvManager.mask('12345678')).toBe('****');
  });

  it('masks exactly 9-char values', () => {
    expect(EnvManager.mask('123456789')).toBe('123****6789');
  });

  it('masks API keys properly', () => {
    expect(EnvManager.mask('sk-proj-abc123def456')).toBe('sk-****f456');
  });

  it('masks database URLs', () => {
    expect(EnvManager.mask('postgresql://user:pass@host:5432/db')).toBe('pos****2/db');
  });
});
