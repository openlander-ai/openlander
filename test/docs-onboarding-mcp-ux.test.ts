import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('onboarding and MCP UX docs', () => {
  it('documents the project/service/managed-service model publicly without internal paths', () => {
    const deployGuide = read('docs/wiki/Deploy-Guide.md');
    const services = read('docs/wiki/Services.md');
    const mcp = read('docs/wiki/MCP-Tools-Reference.md');
    const all = `${deployGuide}\n${services}\n${mcp}`;

    expect(deployGuide).toContain('Project group');
    expect(deployGuide).toContain('Deployable service');
    expect(services).toContain('Managed service');
    expect(mcp).toContain('Agent routing rule of thumb');
    expect(mcp).toContain('openlander_monitor.diagnose_service');
    expect(mcp).toContain('Prefer `service_id`');
    expect(all).not.toContain('/Users/idongbin');
    expect(all).not.toContain('openlander-internal');
    expect(all).not.toContain('qa/reports');
  });

  it('documents optional public access prerequisites', () => {
    const mcp = read('docs/wiki/MCP-Tools-Reference.md');

    expect(mcp).toContain('requires a configured tunnel backend');
    expect(mcp).toMatch(/v0\.1 does not create\s+Cloudflare records automatically/);
    expect(mcp).toContain('DNS to point at the OpenLander host or reverse proxy');
  });
});
