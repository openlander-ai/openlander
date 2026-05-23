import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

// Project detail "Ask Agent" secondary action (v0.1.4 follow-up to #139).
//
// OpenLander is agent-first: managed databases/caches are provisioned by the
// MCP agent, not by a native DB wizard. The project page keeps its native
// Add Service dialog for git/image deployables and offers a secondary
// affordance that opens the managed-db agent guide instead.
describe('Project detail — Ask Agent (managed db) secondary action', () => {
  const projectView = readRepoFile('web/src/pages/ProjectView.tsx');

  it('opens the managed-db agent guide, never the deployable add-service guide', () => {
    expect(projectView).toContain('AgentGuideDialog');
    expect(projectView).toContain('kind="add-managed-db"');
    expect(projectView).not.toContain('kind="add-service"');
  });

  it('keeps the native Add Service dialog for git/image deployables', () => {
    expect(projectView).toContain('<AddServiceDialog');
    expect(projectView).toContain('setAddServiceOpen(true)');
  });

  it('drives the secondary action from its own dialog state', () => {
    expect(projectView).toContain('setAgentGuideOpen(true)');
    expect(projectView).toContain('open={agentGuideOpen}');
  });
});
