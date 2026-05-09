import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanForEnvUsage } from '../../src/pipeline/env-scan.js';

describe('scanForEnvUsage', () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'openlander-env-scan-'));

    mkdirSync(join(root, 'services', 'api', 'src'), { recursive: true });
    mkdirSync(join(root, 'web', 'src'), { recursive: true });

    writeFileSync(
      join(root, 'services', 'api', 'src', 'config.ts'),
      `const db = process.env.DATABASE_URL;\nconst secret = process.env.API_SECRET;\n`,
    );

    writeFileSync(
      join(root, 'web', 'src', 'app.tsx'),
      `const apiUrl = process.env.NEXT_PUBLIC_API_URL;\n`,
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('scans full repo when no scopeDir is provided', () => {
    const result = scanForEnvUsage(root);
    const keys = result.vars.map((v) => v.key).sort();

    expect(keys).toContain('DATABASE_URL');
    expect(keys).toContain('API_SECRET');
    expect(keys).toContain('NEXT_PUBLIC_API_URL');
  });

  it('scopes scan to services/api when scopeDir is provided', () => {
    const result = scanForEnvUsage(root, 'services/api');
    const keys = result.vars.map((v) => v.key).sort();

    expect(keys).toContain('DATABASE_URL');
    expect(keys).toContain('API_SECRET');
    expect(keys).not.toContain('NEXT_PUBLIC_API_URL');
  });

  it('scopes scan to web when scopeDir is provided', () => {
    const result = scanForEnvUsage(root, 'web');
    const keys = result.vars.map((v) => v.key).sort();

    expect(keys).toContain('NEXT_PUBLIC_API_URL');
    expect(keys).not.toContain('DATABASE_URL');
    expect(keys).not.toContain('API_SECRET');
  });

  it('returns empty vars for non-existent scopeDir', () => {
    const result = scanForEnvUsage(root, 'nonexistent');

    expect(result.vars).toHaveLength(0);
  });

  it('preserves file paths relative to projectPath when scoped', () => {
    const result = scanForEnvUsage(root, 'services/api');
    const dbVar = result.vars.find((v) => v.key === 'DATABASE_URL');

    expect(dbVar).toBeDefined();
    expect(dbVar?.files[0]?.path).toBe('services/api/src/config.ts');
  });

  it('detects language correctly when scoped to Node.js directory', () => {
    const result = scanForEnvUsage(root, 'services/api');

    expect(result.language).toBe('node');
  });
});
