import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanForEnvUsage } from '../src/pipeline/env-scan.js';

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'env-scan-'));
});
afterEach(() => {
  rmSync(tmp, { recursive: true });
});

describe('scanForEnvUsage', () => {
  it('detects process.env dot access', () => {
    writeFileSync(join(tmp, 'app.ts'), 'const x = process.env.DATABASE_URL;');
    const r = scanForEnvUsage(tmp);
    expect(r.vars.map((v) => v.key)).toContain('DATABASE_URL');
  });
  it('filters system vars like PORT', () => {
    writeFileSync(
      join(tmp, 'app.ts'),
      'const p = process.env.PORT; const d = process.env.DATABASE_URL;',
    );
    const r = scanForEnvUsage(tmp);
    expect(r.vars.map((v) => v.key)).not.toContain('PORT');
    expect(r.vars.map((v) => v.key)).toContain('DATABASE_URL');
  });
  it('skips node_modules', () => {
    mkdirSync(join(tmp, 'node_modules', 'lib'), { recursive: true });
    writeFileSync(join(tmp, 'node_modules', 'lib', 'x.js'), 'process.env.HIDDEN_VAR');
    writeFileSync(join(tmp, 'app.ts'), 'const x = process.env.REAL_VAR;');
    const r = scanForEnvUsage(tmp);
    expect(r.vars.map((v) => v.key)).not.toContain('HIDDEN_VAR');
    expect(r.vars.map((v) => v.key)).toContain('REAL_VAR');
  });
  it('detects python os.getenv', () => {
    writeFileSync(join(tmp, 'app.py'), "import os\nsk = os.getenv('SECRET_KEY')");
    const r = scanForEnvUsage(tmp);
    expect(r.vars.map((v) => v.key)).toContain('SECRET_KEY');
  });
});
