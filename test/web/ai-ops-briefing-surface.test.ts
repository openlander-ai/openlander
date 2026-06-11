import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('AI Ops briefing web surface', () => {
  const panelSource = readRepoFile('web/src/components/ai-ops/AiOpsBriefingPanel.tsx');
  const projectSettingsSource = readRepoFile('web/src/components/project/SettingsTab.tsx');
  const serviceDetailSource = readRepoFile('web/src/pages/ServiceDetailV2.tsx');
  const apiSource = readRepoFile('web/src/lib/api/ai-ops.ts');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('mounts the same read-only briefing panel on Project and Service detail surfaces', () => {
    expect(projectSettingsSource).toContain(
      '<AiOpsBriefingPanel scope="project" projectId={project.id} />',
    );
    expect(serviceDetailSource).toContain('<AiOpsBriefingPanel');
    expect(serviceDetailSource).toContain('scope="service"');
    expect(panelSource).toContain("t('aiOps.noAutomation')");
    expect(panelSource).not.toMatch(/restartService|redeployService|rollback|updateServiceEnvVars/);
  });

  it('uses Project and Service AI Ops API wrappers instead of direct fetch calls', () => {
    expect(apiSource).toContain('/api/projects/${projectId}/ai-ops');
    expect(apiSource).toContain('/api/projects/${projectId}/services/${serviceId}/ai-ops');
    expect(apiSource).toContain('/api/ai-ops/briefings/${briefingId}');
    expect(panelSource).toContain('getProjectAiOps');
    expect(panelSource).toContain('updateProjectAiOps');
    expect(panelSource).toContain('getServiceAiOps');
    expect(panelSource).toContain('updateServiceAiOps');
    expect(panelSource).not.toContain('fetch(');
  });

  it('adds AI Ops i18n keys in both locales', () => {
    for (const source of [enSource, koSource]) {
      for (const key of [
        'aiOps:',
        'title:',
        'projectDescription:',
        'serviceDescription:',
        'noAutomation:',
        'resolvedMode:',
        'recentBriefings:',
        'suggestedCall:',
        'evidence:',
      ]) {
        expect(source).toContain(key);
      }
      expect(source).toContain("off: 'Off'");
      expect(source).toContain("briefing: 'Briefing'");
      expect(source).toContain("inherit: 'Inherit'");
    }
  });
});
