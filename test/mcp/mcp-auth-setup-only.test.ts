import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Pins the intent of the one MCP auth path that allows unauthenticated requests:
 * it exists ONLY for the first-boot setup window (no admin password yet). If a future
 * change widens it into a general "auth off" state, or removes the Bearer enforcement
 * once a password is set, this guard fails on purpose.
 */
function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('MCP auth: no-password open state is intentional setup-only', () => {
  const src = readWorkspaceFile('src/mcp/server.ts');

  it('opens MCP only while no admin password is set, documented as setup-only', () => {
    expect(src).toContain('if (!(await authService.isPasswordSet()))');
    expect(src).toMatch(/setup-only/i);
  });

  it('enforces Bearer auth once a password exists', () => {
    expect(src).toContain("!authHeader.startsWith('Bearer ')");
    expect(src).toContain('Unauthorized');
  });
});
