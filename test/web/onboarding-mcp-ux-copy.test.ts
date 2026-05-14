import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('onboarding MCP UX copy', () => {
  const projectView = read('web/src/pages/ProjectView.tsx');
  const serviceDetail = read('web/src/pages/ServiceDetailV2.tsx');
  const servicesPage = read('web/src/pages/ServicesPage.tsx');
  const promptSets = read('web/src/components/agent-guide/prompt-sets.ts');
  const en = read('web/src/i18n/en.ts');
  const ko = read('web/src/i18n/ko.ts');

  it('surfaces service_id as the preferred MCP target in service UI', () => {
    expect(projectView).toContain("t('projectDetail.servicesGuide.banner')");
    expect(projectView).toContain("t('projectDetail.servicesGuide.serviceId'");
    expect(serviceDetail).toContain("sourceRows.push(['MCP service_id', service.id])");
  });

  it('explains managed services separately from deployable services', () => {
    expect(servicesPage).toContain('<ServicesIntro />');
    expect(en).toContain('Managed services are databases, caches, and shared infrastructure');
    expect(ko).toContain('Managed Service는 데이터베이스, 캐시, 공유 인프라입니다');
  });

  it('keeps agent guide prompts aligned with the service model', () => {
    expect(promptSets).toContain('A project is the group; a service is the deployable app');
    expect(promptSets).toContain('Managed services are infrastructure');
    expect(promptSets).toContain('wire DATABASE_URL');
  });
});
