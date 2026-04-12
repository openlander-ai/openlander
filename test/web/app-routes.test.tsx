import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

describe('App Routes', () => {
  it('includes /services/:id route', async () => {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile(
      join(__dirname, '..', '..', 'web', 'src', 'App.tsx'),
      'utf-8',
    );

    expect(content).toContain('<Route path="/services/:id" element={<ServiceDetail />} />');
    expect(content).toContain("import { ServiceDetail } from '@/pages/ServiceDetail'");
  });
});
