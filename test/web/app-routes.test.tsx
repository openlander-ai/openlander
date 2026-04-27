import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

describe('App Routes', () => {
  it('includes /services/:id route', async () => {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(
      join(__dirname, '..', '..', 'web', 'src', 'App.tsx'),
      'utf-8',
    );

    // V4 rewrite: ServiceDetail was replaced with ServiceDetailV2. The route
    // still binds /services/:id but now mounts the InfraMap-backed v2 page,
    // imported lazily so the route bundle ships separately.
    expect(content).toContain('path="/services/:id"');
    expect(content).toContain('<ServiceDetailV2 />');
    expect(content).toContain("import('@/pages/ServiceDetailV2')");
  });
});
