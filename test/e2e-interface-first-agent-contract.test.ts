import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('interface-first Agent RC gate contract', () => {
  const spec = readRepoFile('e2e/quality-gate/interface-first-agent.spec.ts');
  const smokeScript = readRepoFile('scripts/rc-cold-agent-smoke.sh');

  it('keeps the external Agent golden scenario in the RC smoke lane', () => {
    expect(smokeScript).toContain('e2e/quality-gate/interface-first-agent.spec.ts');
  });

  it('covers portfolio isolation, handoff, evidence, and weekly reporting', () => {
    for (const action of [
      'bootstrap_engagement',
      'link_project_to_engagement',
      'get_engagement',
      'apply_project_manifest',
      'plan_delivery',
      'create_evidence_upload',
      'record_project_update',
      'start_delivery_run',
      'record_delivery_run_progress',
      'resume_delivery_run',
      'generate_weekly_report',
      'publish_weekly_report',
    ]) {
      expect(spec).toContain(`'${action}'`);
    }
  });
});
