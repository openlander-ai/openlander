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

  it('detects process.env bracket access', () => {
    writeFileSync(join(tmp, 'app.ts'), "const x = process.env['API_KEY'];");
    const r = scanForEnvUsage(tmp);
    expect(r.vars.map((v) => v.key)).toContain('API_KEY');
  });

  it('detects destructured process.env', () => {
    writeFileSync(join(tmp, 'app.ts'), 'const { STRIPE_KEY, SENDGRID_KEY } = process.env;');
    const r = scanForEnvUsage(tmp);
    const keys = r.vars.map((v) => v.key);
    expect(keys).toContain('STRIPE_KEY');
    expect(keys).toContain('SENDGRID_KEY');
  });

  it('detects python os.environ bracket access', () => {
    writeFileSync(join(tmp, 'app.py'), "import os\ndb = os.environ['DATABASE_URL']");
    const r = scanForEnvUsage(tmp);
    expect(r.vars.map((v) => v.key)).toContain('DATABASE_URL');
  });

  it('detects python os.environ.get', () => {
    writeFileSync(join(tmp, 'app.py'), "import os\nval = os.environ.get('REDIS_URL')");
    const r = scanForEnvUsage(tmp);
    expect(r.vars.map((v) => v.key)).toContain('REDIS_URL');
  });

  it('deduplicates same key across multiple files', () => {
    writeFileSync(join(tmp, 'a.ts'), 'const x = process.env.SHARED_KEY;');
    writeFileSync(join(tmp, 'b.ts'), 'const y = process.env.SHARED_KEY;');
    const r = scanForEnvUsage(tmp);
    const matches = r.vars.filter((v) => v.key === 'SHARED_KEY');
    expect(matches).toHaveLength(1);
    expect(matches[0]!.files).toHaveLength(2);
  });

  it('reports correct language for node-only project', () => {
    writeFileSync(join(tmp, 'app.ts'), 'const x = process.env.MY_VAR;');
    const r = scanForEnvUsage(tmp);
    expect(r.language).toBe('node');
  });

  it('reports correct language for python-only project', () => {
    writeFileSync(join(tmp, 'app.py'), "import os\nx = os.getenv('MY_VAR')");
    const r = scanForEnvUsage(tmp);
    expect(r.language).toBe('python');
  });

  it('reports mixed language for node+python project', () => {
    writeFileSync(join(tmp, 'app.ts'), 'const x = process.env.NODE_VAR;');
    writeFileSync(join(tmp, 'app.py'), "import os\nx = os.getenv('PY_VAR')");
    const r = scanForEnvUsage(tmp);
    expect(r.language).toBe('mixed');
  });

  it('skips .git directory', () => {
    mkdirSync(join(tmp, '.git'), { recursive: true });
    writeFileSync(join(tmp, '.git', 'hook.js'), 'process.env.GIT_SECRET');
    writeFileSync(join(tmp, 'app.ts'), 'const x = process.env.REAL_VAR;');
    const r = scanForEnvUsage(tmp);
    expect(r.vars.map((v) => v.key)).not.toContain('GIT_SECRET');
    expect(r.vars.map((v) => v.key)).toContain('REAL_VAR');
  });
});
