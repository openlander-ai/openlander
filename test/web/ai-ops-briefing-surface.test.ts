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

  it('keeps Project and Service policy controls explicit and default-off friendly', () => {
    expect(panelSource).toContain("useState<AiOpsProjectMode>('off')");
    expect(panelSource).toContain("useState<AiOpsServiceOverrideMode>('inherit')");
    expect(panelSource).toContain("useState<AiOpsProjectMode>('off')");
    expect(panelSource).toContain("const projectModeButtons: Array<{ value: AiOpsProjectMode");
    expect(panelSource).toContain("{ value: 'off', label: t('aiOps.mode.off') }");
    expect(panelSource).toContain("{ value: 'briefing', label: t('aiOps.mode.briefing') }");
    expect(panelSource).toContain("const serviceModeButtons: Array<{ value: AiOpsServiceOverrideMode");
    expect(panelSource).toContain("{ value: 'inherit', label: t('aiOps.mode.inherit') }");
    expect(panelSource).toMatch(/scope === 'service'\s+\? void saveServiceMode/);
    expect(panelSource).toContain('void saveProjectMode');
  });

  it('uses Project and Service AI Ops API wrappers instead of direct fetch calls', () => {
    expect(apiSource).toContain('/api/projects/${projectId}/ai-ops');
    expect(apiSource).toContain('/api/projects/${projectId}/services/${serviceId}/ai-ops');
    expect(apiSource).toContain('/api/projects/${projectId}/ai-ops/briefings');
    expect(apiSource).toContain('/api/projects/${projectId}/services/${serviceId}/ai-ops/briefings');
    expect(apiSource).toContain('/api/ai-ops/briefings/${briefingId}');
    expect(panelSource).toContain('getProjectAiOps');
    expect(panelSource).toContain('updateProjectAiOps');
    expect(panelSource).toContain('getServiceAiOps');
    expect(panelSource).toContain('updateServiceAiOps');
    expect(panelSource).toContain('listServiceAiOpsBriefings');
    expect(panelSource).toContain('getAiOpsBriefing');
    expect(panelSource).not.toContain('fetch(');
  });

  it('matches the backend policy and budget response contracts', () => {
    expect(apiSource).toContain("source: 'project' | 'service_override'");
    expect(apiSource).not.toContain('projectMode: AiOpsProjectMode');
    expect(apiSource).not.toContain('serviceOverrideMode: AiOpsServiceOverrideMode');
    expect(apiSource).toContain('llmSummaryAllowed: boolean');
    expect(apiSource).toContain('deterministicBriefingAllowed: true');
    expect(apiSource).toContain(
      "reason: 'allowed' | 'project_daily_limit_exceeded' | 'instance_daily_limit_exceeded'",
    );
    expect(apiSource).not.toContain('decision: { allowed: boolean');
  });

  it('renders briefing cards and a detail drawer with usage, suggested call, and redacted evidence slots', () => {
    expect(panelSource).toContain('briefings.slice(0, 5).map');
    expect(panelSource).toContain('onClick={() => void openBriefing(briefing)}');
    expect(panelSource).toContain('setSelectedBriefing(detail.briefing)');
    expect(panelSource).toContain("label={t('aiOps.tokens')}");
    expect(panelSource).toContain("label={t('aiOps.cost')}");
    expect(panelSource).toContain("label={t('aiOps.llmCalls')}");
    expect(panelSource).toContain("label={t('aiOps.suggestedCall')}");
    expect(panelSource).toContain("label={t('aiOps.evidence')}");
    expect(panelSource).toContain('formatJson(selectedBriefing.suggested_call)');
    expect(panelSource).toContain('formatJson(selectedBriefing.evidence)');
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
        'tokens:',
        'cost:',
        'llmCalls:',
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
