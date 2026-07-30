import { describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { serviceToolDefs } from '../../src/tools/defs/service.js';

describe('managed service backup contract', () => {
  it('serializes backup createdAt values as ISO strings', async () => {
    const createdAt = new Date('2026-07-30T03:04:05.678Z');
    const appCtx = {
      serviceManager: {
        list: vi.fn(async () => [
          { id: 'db-1', name: 'primary-db', kind: 'postgres', type: 'postgresql' },
        ]),
        listBackups: vi.fn(async () => [{ backupId: 'backup-1', createdAt, sizeBytes: 42 }]),
      },
    } as unknown as AppContext;
    const tool = serviceToolDefs.find((definition) => definition.name === 'list_service_backups');
    expect(tool).toBeDefined();

    const result = await tool!.execute({ service_name: 'primary-db' }, { appCtx, target: 'mcp' });

    expect(result).toMatchObject({
      service: 'primary-db',
      backups: [{ backupId: 'backup-1', createdAt: '2026-07-30T03:04:05.678Z', sizeBytes: 42 }],
    });
  });
});
