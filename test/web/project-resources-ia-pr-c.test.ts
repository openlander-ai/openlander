import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('Project resources IA', () => {
  const projectViewSource = readRepoFile('web/src/pages/ProjectView.tsx');
  const topologySource = readRepoFile('web/src/lib/projectTopology.ts');
  const topologyZodSource = readRepoFile('web/src/lib/api/topology-zod.ts');
  const infraMapSource = readRepoFile('web/src/components/Shell/InfraMap.tsx');

  it('keeps the Services tab id as a compatibility alias while rendering Resources copy', () => {
    expect(projectViewSource).toContain("type ProjectTabId = 'services' | 'settings'");
    expect(projectViewSource).toContain("label: t('projectDetail.tabs.services')");
    expect(projectViewSource).toContain("panelId=\"projectpanel-services\"");
    expect(projectViewSource).not.toContain('Add service');
    expect(projectViewSource).toContain("t('projectDetail.addService.title')");
  });

  it('uses canonical group-service rows for resource cards so Compose stays one card', () => {
    expect(projectViewSource).toContain('const [groupServiceNodes, setGroupServiceNodes]');
    expect(projectViewSource).toContain('listGroupServices(projectId)');
    expect(projectViewSource).toContain('const resourceServiceNodes = groupServiceNodes ?? services');
    expect(projectViewSource).toContain(
      "service.kind === 'compose' || service.buildMethod === 'compose'",
    );
  });

  it('maps resource badges to product nouns', () => {
    expect(projectViewSource).toContain("? 'Compose' : 'Application'");
    expect(projectViewSource).toContain("if (normalized === 'redis') return 'Cache'");
    expect(projectViewSource).toContain("if (normalized === 'minio') return 'Storage'");
    expect(projectViewSource).toContain("return 'Database'");
    expect(projectViewSource).toContain("case 'Compose':");
    expect(projectViewSource).toContain("return 'vocab.compose'");
    expect(projectViewSource).toContain("case 'Cache':");
    expect(projectViewSource).toContain("return 'vocab.cache'");
    expect(projectViewSource).toContain("case 'Storage':");
    expect(projectViewSource).toContain("return 'vocab.storage'");
  });

  it('extends the display topology kind contract for resource labels', () => {
    expect(topologySource).toContain(
      "export type ServiceKind = 'Application' | 'Compose' | 'Database' | 'Cache' | 'Storage'",
    );
    expect(topologySource).toContain(
      "svc.kind === 'Database' || svc.kind === 'Cache' || svc.kind === 'Storage'",
    );
    expect(topologyZodSource).toContain(
      "z.enum(['Application', 'Compose', 'Database', 'Cache', 'Storage'])",
    );
  });

  it('uses resource wording in the Project topology strip', () => {
    expect(infraMapSource).toContain('No resources yet');
    expect(infraMapSource).toContain('· 1 resource');
    expect(infraMapSource).toContain('{services.length} resources');
    expect(infraMapSource).toContain('Click to open resource');
    expect(infraMapSource).not.toContain('Click to open service');
  });
});
