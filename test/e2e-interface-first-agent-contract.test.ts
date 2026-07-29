import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('interface-first Agent RC gate contract', () => {
  const spec = readRepoFile('e2e/quality-gate/interface-first-agent.spec.ts');
  const goldenSpec = readRepoFile('e2e/quality-gate/agent-fde-golden.spec.ts');
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
      'get_project_context',
      'plan_delivery',
      'get_delivery',
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

  it('keeps the complete external Agent FDE golden path in the ephemeral RC lane', () => {
    expect(smokeScript).toContain('e2e/quality-gate/agent-fde-golden.spec.ts');
    expect(goldenSpec).toContain("process.env['OPENLANDER_E2E_EPHEMERAL'] !== '1'");
  });

  it('protects failure correction, immutable Promotion, reporting, and completion evidence', () => {
    for (const action of [
      'bootstrap_engagement',
      'deploy_app',
      'apply_project_manifest',
      'plan_delivery',
      'start_delivery_run',
      'run_quality_gates',
      'update_application_source',
      'record_delivery_run_progress',
      'resume_delivery_run',
      'create_release',
      'promote_release',
      'evaluate_promotion',
      'generate_weekly_report',
      'publish_weekly_report',
      'complete_delivery',
      'archive_engagement',
    ]) {
      expect(goldenSpec).toContain(`'${action}'`);
    }

    expect(goldenSpec).toContain("status: 'failed', exit_code: 1");
    expect(goldenSpec).toContain("status: 'passed',");
    expect(goldenSpec).toContain('expectEnvironmentDigest(');
    expect(goldenSpec).toContain('expect(await receiptSha256(projectId, deliveryId)).toBe(');
  });
});
