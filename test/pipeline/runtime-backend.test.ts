import { describe, expect, it } from 'vitest';

import { Docker } from '../../src/pipeline/docker.js';
import type { RuntimeBackend } from '../../src/pipeline/runtime/index.js';

describe('RuntimeBackend', () => {
  it('treats the Docker facade as the default runtime backend', () => {
    const backend: RuntimeBackend = new Docker();

    expect(backend.kind).toBe('docker');
    expect(backend.backendName).toBe('docker');
  });
});
