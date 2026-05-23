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

  it('explains managed services separately from deployable services', () => {
    expect(promptSets).toContain('Infrastructure services are provisioned by the agent');
    expect(projectView).toContain('kind="add-managed-db"');
  });

  it('keeps agent guide prompts aligned with the service model', () => {
    expect(promptSets).toContain('A project is the group; a service is the deployable app');
    expect(promptSets).toContain('Infrastructure services are provisioned by the agent');
    expect(promptSets).toContain('wire DATABASE_URL');
  });
});
