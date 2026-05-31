import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readSources(dir: string): Array<{ path: string; source: string }> {
  const entries: Array<{ path: string; source: string }> = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      entries.push(...readSources(path));
    } else if (path.endsWith('.ts')) {
      entries.push({ path, source: readFileSync(path, 'utf8') });
    }
  }
  return entries;
}

describe('MCP response contract', () => {
  it('documents the stable action-link envelope for tool responses', () => {
    const agents = readFileSync('AGENTS.md', 'utf8');
    const reference = readFileSync('docs/wiki/MCP-Tools-Reference.md', 'utf8');

    for (const field of ['status_call', 'diagnostic_call', 'suggested_call', 'poll_call']) {
      expect(agents).toContain(field);
      expect(reference).toContain(field);
    }
    expect(agents).toContain('MCP Response Contract');
    expect(reference).toContain('Status responses stay intentionally small');
  });

  it('does not introduce one-off next-action fields outside the approved envelope', () => {
    const forbidden = ['retry_call', 'build_log_call', 'next_call'];
    const sources = [...readSources('src/tools'), ...readSources('src/mcp')];

    for (const { path, source } of sources) {
      for (const field of forbidden) {
        expect(
          source,
          `${path} should use status_call/diagnostic_call/suggested_call, not ${field}`,
        ).not.toContain(field);
      }
    }
  });
});
