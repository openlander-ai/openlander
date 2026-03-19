import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { createSharedToolRegistry } from './shared-tool-registry.js';

const { mockCloneRepo } = vi.hoisted(() => ({
  mockCloneRepo: vi.fn(),
}));

vi.mock('../../src/pipeline/git.js', () => ({
  cloneRepo: mockCloneRepo,
}));

function createMockContext(): { ctx: AppContext } {
  const ctx = {
    config: {
      git: { sshKeyPath: '' },
    },
  } as unknown as AppContext;

  return { ctx };
}

function getTool(ctx: AppContext, name: string, target: 'agent' | 'mcp' = 'agent') {
  const tool = createSharedToolRegistry(ctx, { target }).find((entry) => entry.name === name);
  expect(tool).toBeDefined();
  return tool!;
}

describe('Server Tools (post-registry cleanup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not expose removed registry-only server tools', () => {
    const { ctx } = createMockContext();
    const names = createSharedToolRegistry(ctx).map((tool) => tool.name);

    expect(names).not.toContain('list_all_containers');
    expect(names).not.toContain('scan_ports');
    expect(names).not.toContain('get_container_stats');
  });

  it('exposes scan_project for agent target and hides it for mcp target', () => {
    const { ctx } = createMockContext();

    const agentNames = createSharedToolRegistry(ctx, { target: 'agent' }).map((tool) => tool.name);
    const mcpNames = createSharedToolRegistry(ctx, { target: 'mcp' }).map((tool) => tool.name);

    expect(agentNames).toContain('scan_project');
    expect(mcpNames).not.toContain('scan_project');
  });

  it('scan_project detects dockerfiles and compose files while excluding hidden/vendor paths', async () => {
    const tempRepo = mkdtempSync(join(tmpdir(), 'server-tools-scan-project-'));
    mkdirSync(join(tempRepo, '.git'), { recursive: true });
    mkdirSync(join(tempRepo, 'service-a'), { recursive: true });
    mkdirSync(join(tempRepo, 'node_modules', 'left-pad'), { recursive: true });
    mkdirSync(join(tempRepo, 'vendor', 'bin'), { recursive: true });
    writeFileSync(join(tempRepo, 'Dockerfile'), 'FROM alpine\n');
    writeFileSync(join(tempRepo, 'service-a', 'Dockerfile'), 'FROM node:22\n');
    writeFileSync(join(tempRepo, '.git', 'Dockerfile'), 'FROM busybox\n');
    writeFileSync(join(tempRepo, 'node_modules', 'left-pad', 'Dockerfile'), 'FROM busybox\n');
    writeFileSync(join(tempRepo, 'vendor', 'bin', 'Dockerfile'), 'FROM busybox\n');
    writeFileSync(join(tempRepo, 'docker-compose.yml'), 'services: {}\n');

    try {
      mockCloneRepo.mockResolvedValueOnce({ path: tempRepo, commitSha: 'abc123' });
      const { ctx } = createMockContext();
      const tool = getTool(ctx, 'scan_project', 'agent');

      const result = await tool.execute(
        { repo_url: 'https://github.com/example/repo', branch: 'main' },
        { target: 'agent' },
      );

      expect(result).toEqual({
        isMonorepo: true,
        dockerfiles: ['Dockerfile', 'service-a/Dockerfile'],
        composeFiles: ['docker-compose.yml'],
        clonePath: tempRepo,
      });
      expect(mockCloneRepo).toHaveBeenCalledWith({
        repoUrl: 'https://github.com/example/repo',
        branch: 'main',
        sshKeyPath: undefined,
      });
    } finally {
      rmSync(tempRepo, { recursive: true, force: true });
    }
  });
});
