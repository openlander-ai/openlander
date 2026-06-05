import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');

const USER_FACING_MCP_RUNTIME_FILES = [
  'src/mcp/prompts.ts',
  'src/mcp/server.ts',
  'src/mcp/composite-tools.ts',
  'src/tools/defs/deploy-plan.ts',
  'src/tools/defs/deployable-service.ts',
  'src/tools/defs/env.ts',
  'src/tools/defs/infra.ts',
  'src/tools/defs/monitoring.ts',
  'src/tools/defs/platform-actions.ts',
  'src/tools/defs/project-ops.ts',
  'src/tools/defs/schemas.ts',
  'src/tools/defs/service.ts',
  'src/pipeline/deploy-core.ts',
  'src/pipeline/deploy-plan/engine.ts',
] as const;

function readRepoFile(path: string): string {
  return readFileSync(resolve(REPO_ROOT, path), 'utf8');
}

describe('public MCP/runtime vocabulary', () => {
  it('keeps composite-first guidance for new app Database/Cache provisioning', () => {
    const promptSource = readRepoFile('src/mcp/prompts.ts');
    const serverSource = readRepoFile('src/mcp/server.ts');
    const projectOpsSource = readRepoFile('src/tools/defs/project-ops.ts');
    const serviceSource = readRepoFile('src/tools/defs/service.ts');

    for (const source of [promptSource, serverSource, projectOpsSource]) {
      expect(source).toContain('create_project');
    }
    for (const source of [promptSource, serverSource, projectOpsSource, serviceSource]) {
      expect(source).toContain('create_service');
      expect(source).toContain('target_project_id');
    }

    expect(promptSource).toContain('OpenLander owns the target Project');
    expect(promptSource).toContain('same target Project/network');
    expect(serverSource).toContain('OpenLander owns the target Project');
    expect(promptSource).not.toContain('call `create_project` first');
    expect(serverSource).not.toContain('create_project first');
  });

  it('does not use legacy product nouns in MCP/runtime copy', () => {
    const oldNouns = [
      /project group/i,
      /deployable service/i,
      /managed service/i,
      /\bCreate service\b/,
      /\bAdd service\b/,
    ];

    for (const file of USER_FACING_MCP_RUNTIME_FILES) {
      const source = readRepoFile(file);
      for (const pattern of oldNouns) {
        expect(source, `${file} should not contain ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
