import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('live Delivery Workspace RC gate contract', () => {
  const spec = readRepoFile('e2e/quality-gate/delivery-workspace-live.spec.ts');
  const smokeScript = readRepoFile('scripts/rc-cold-agent-smoke.sh');
  const releaseWorkflow = readRepoFile('.github/workflows/release-gate.yml');
  const teardown = readRepoFile('e2e/quality-gate/global-teardown.ts');

  it('keeps the immutable Receipt scenario in the RC smoke lane', () => {
    expect(smokeScript).toContain('e2e/quality-gate/delivery-workspace-live.spec.ts');
    expect(releaseWorkflow).toContain("OPENLANDER_E2E_EPHEMERAL: '1'");
    expect(spec).toContain("process.env['OPENLANDER_E2E_EPHEMERAL'] !== '1'");
  });

  it('covers the evidence, Production deploy, admin finalization, and PDF hash boundaries', () => {
    for (const pathFragment of [
      '/artifacts',
      '/feedback',
      '/work-items/drafts',
      '/approvals',
      '/gates/review/result',
      '/gates/qa/result',
      '/deployments',
      '/readiness',
      '/receipt/preview',
      '/receipt/finalize',
      '/receipt/download',
    ]) {
      expect(spec).toContain(pathFragment);
    }
    expect(spec).toContain('loginAsAdmin');
    expect(spec).toContain("createHash('sha256')");
    expect(spec).toContain('toBe(receipt.pdf_sha256)');
  });

  it('preserves finalized Receipt rows until the ephemeral database is destroyed', () => {
    expect(teardown).toContain("project.name.startsWith('qg-delivery-live-')");
    expect(teardown).toContain("process.env['OPENLANDER_E2E_EPHEMERAL'] === '1'");
  });
});
