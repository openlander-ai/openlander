import { afterEach, describe, expect, it, vi } from 'vitest';

import { getProject } from '../../web/src/lib/api/projects.js';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('project API mapping', () => {
  it('maps direct project detail snake_case timestamps to frontend fields', async () => {
    globalThis.fetch = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          id: 'archived-project',
          name: 'archived-project',
          status: 'stopped',
          visibility: 'internal',
          created_at: '2026-05-30T01:02:03.000Z',
          updated_at: '2026-05-31T04:05:06.000Z',
          archived_at: '2026-05-31T04:05:06.000Z',
          environments: [],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const project = await getProject('archived-project');

    expect(project.createdAt).toBe('2026-05-30T01:02:03.000Z');
    expect(project.updatedAt).toBe('2026-05-31T04:05:06.000Z');
    expect(project.archived_at).toBe('2026-05-31T04:05:06.000Z');
  });
});
