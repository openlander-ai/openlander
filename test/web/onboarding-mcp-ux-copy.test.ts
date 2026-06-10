import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('onboarding MCP UX copy', () => {
  const projectView = read('web/src/pages/ProjectView.tsx');
  const serviceDetail = read('web/src/pages/ServiceDetailV2.tsx');
  const promptSets = read('web/src/components/agent-guide/prompt-sets.ts');

  it('surfaces service_id as the preferred MCP target in service UI', () => {
    expect(projectView).toContain("t('projectDetail.servicesGuide.banner')");
    expect(projectView).toContain("t('projectDetail.servicesGuide.serviceId'");
    expect(serviceDetail).toContain('/projects/:p/infrastructure/:id');
  });

  it('explains Database/Cache/Storage resources separately from workloads', () => {
    expect(promptSets).toContain(
      'Database, Cache, and Storage resources are provisioned first',
    );
    expect(projectView).toContain('kind="add-managed-db"');
  });

  it('keeps agent guide prompts aligned with the service model', () => {
    expect(promptSets).toContain(
      'A Project is the workspace; Applications and Compose stacks are the workloads inside it.',
    );
    expect(promptSets).toContain('Database/Cache/Storage resources');
    expect(promptSets).toContain('wire DATABASE_URL');
  });

  it('does not tell users that agents can perform human-only or external domain work', () => {
    expect(promptSets).toContain('Permanent Project/Application deletion is human UI-only');
    expect(promptSets).toContain('DNS and TLS stay outside OpenLander in v0.1');
    expect(promptSets).not.toContain('TLS issuance');
    expect(promptSets).not.toContain('Move the existing domain off');
    expect(promptSets).not.toContain('over to staging');
  });
});
