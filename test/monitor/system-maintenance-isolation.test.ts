import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const sourcePath = fileURLToPath(
  new URL('../../src/monitor/system-maintenance-monitor.ts', import.meta.url),
);

describe('SystemMaintenanceMonitor Docker isolation', () => {
  it('keeps automatic disk-pressure handling audit-only on a shared Docker socket', async () => {
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain('auditDiskThresholdCleanup()');
    expect(source).not.toContain('diskThresholdCleanup()');
    expect(source).not.toContain('pruneDanglingImages()');
    expect(source).not.toContain('pruneBuildCache()');
    expect(source).not.toContain('pruneUnusedImages()');
  });
});
