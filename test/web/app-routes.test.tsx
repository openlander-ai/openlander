import { describe, expect, it } from 'vitest';

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

const describeApp = isBunRuntime ? describe.skip : describe;

describeApp('App Routes', () => {
  it('includes /services/:id route', async () => {
    const fs = await import('node:fs/promises');
    const content = await fs.readFile('/home/lee/OpenLander/web/src/App.tsx', 'utf-8');

    expect(content).toContain('<Route path="/services/:id" element={<ServiceDetail />} />');
    expect(content).toContain("import { ServiceDetail } from '@/pages/ServiceDetail'");
  });
});
