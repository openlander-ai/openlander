import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanForEnvUsage, scanRepoEnvVars } from '../src/pipeline/env-scan.js';

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

  // Optional detection tests
  it('detects optional: true for process.env.KEY || "default"', () => {
    writeFileSync(join(tmp, 'app.ts'), "const x = process.env.DATABASE_URL || 'localhost';");
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'DATABASE_URL');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(true);
  });

  it('detects optional: true for process.env.KEY ?? "fallback"', () => {
    writeFileSync(join(tmp, 'app.ts'), "const x = process.env.API_KEY ?? 'default-key';");
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'API_KEY');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(true);
  });

  it('detects optional: true for process.env.KEY || 3000 (numeric literal)', () => {
    writeFileSync(join(tmp, 'app.ts'), 'const port = process.env.SERVER_PORT || 3000;');
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'SERVER_PORT');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(true);
  });

  it('detects optional: true for process.env.KEY || path.join(...)', () => {
    writeFileSync(
      join(tmp, 'app.ts'),
      "const PUBLIC_DIR = process.env.PUBLIC_DIR || path.join(__dirname, '..', 'public');",
    );
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'PUBLIC_DIR');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(true);
  });

  it('detects optional: true for bracket env access with path.resolve fallback', () => {
    writeFileSync(
      join(tmp, 'app.ts'),
      "const PUBLIC_ROOT = process.env['PUBLIC_ROOT'] ?? path.resolve('public');",
    );
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'PUBLIC_ROOT');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(true);
  });

  it('detects optional: false for bare process.env.KEY', () => {
    writeFileSync(join(tmp, 'app.ts'), 'const x = process.env.REQUIRED_VAR;');
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'REQUIRED_VAR');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(false);
  });

  it('detects optional: false for process.env.KEY || functionCall()', () => {
    writeFileSync(join(tmp, 'app.ts'), 'const x = process.env.CONFIG || getDefault();');
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'CONFIG');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(false);
  });

  it('detects optional: true for os.environ.get("KEY", "default")', () => {
    writeFileSync(join(tmp, 'app.py'), "val = os.environ.get('REDIS_URL', 'localhost')");
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'REDIS_URL');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(true);
  });

  it('detects optional: false for os.environ.get("KEY") without default', () => {
    writeFileSync(join(tmp, 'app.py'), "val = os.environ.get('SECRET_KEY')");
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'SECRET_KEY');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(false);
  });

  it('detects optional: true for const { KEY = "default" } = process.env', () => {
    writeFileSync(join(tmp, 'app.ts'), "const { DB_HOST = 'localhost' } = process.env;");
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'DB_HOST');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(true);
  });

  it('detects optional: false when ANY usage lacks fallback', () => {
    writeFileSync(join(tmp, 'a.ts'), "const x = process.env.MIXED_VAR || 'default';");
    writeFileSync(join(tmp, 'b.ts'), 'const y = process.env.MIXED_VAR;');
    const r = scanForEnvUsage(tmp);
    const v = r.vars.find((v) => v.key === 'MIXED_VAR');
    expect(v).toBeDefined();
    expect(v?.optional).toBe(false);
  });

  it('detects env config schema keys used through dynamic process.env lookup', () => {
    writeFileSync(
      join(tmp, 'server.js'),
      `
const schema = [
  { key: 'JWT_SECRET', kind: 'minlen', min: 16 },
  { key: 'APP_BASE_URL', kind: 'url' },
  { key: 'EXCHANGE_API_KEY', kind: 'prefix', prefix: 'key_' },
  { key: 'OPTIONAL_FLAG', kind: 'optional' },
];
for (const item of schema) {
  const value = process.env[item.key];
}
`,
    );

    const r = scanForEnvUsage(tmp);
    const jwt = r.vars.find((v) => v.key === 'JWT_SECRET');
    const appBase = r.vars.find((v) => v.key === 'APP_BASE_URL');
    const exchangeKey = r.vars.find((v) => v.key === 'EXCHANGE_API_KEY');
    const optional = r.vars.find((v) => v.key === 'OPTIONAL_FLAG');

    expect(jwt).toBeDefined();
    expect(jwt?.optional).toBe(false);
    expect(jwt?.requirement).toMatchObject({ kind: 'minlen', min: 16, source: 'schema' });
    expect(appBase).toBeDefined();
    expect(appBase?.optional).toBe(false);
    expect(appBase?.requirement).toMatchObject({ kind: 'url', source: 'schema' });
    expect(exchangeKey).toBeDefined();
    expect(exchangeKey?.requirement).toMatchObject({
      kind: 'prefix',
      prefix: 'key_',
      source: 'schema',
    });
    expect(optional).toBeDefined();
    expect(optional?.optional).toBe(true);
    expect(optional?.requirement).toBeUndefined();
  });
});

describe('scanRepoEnvVars', () => {
  it('merges source, template, committed env, and docker ARG entries by key', () => {
    writeFileSync(join(tmp, 'app.ts'), "const db = process.env.DATABASE_URL || 'sqlite://local';");
    writeFileSync(join(tmp, '.env.example'), 'DATABASE_URL=\nEXAMPLE_ONLY=\n');
    writeFileSync(join(tmp, '.env'), 'DOTENV_ONLY=local\nDATABASE_URL=\n');
    writeFileSync(join(tmp, 'Dockerfile'), 'FROM node:22\nARG ARG_ONLY\nARG DATABASE_URL\n');

    const result = scanRepoEnvVars(tmp);
    const keys = result.vars.map((v) => v.key);

    expect(keys).toContain('DATABASE_URL');
    expect(keys).toContain('EXAMPLE_ONLY');
    expect(keys).toContain('DOTENV_ONLY');
    expect(keys).toContain('ARG_ONLY');
    expect(result.hasEnvExample).toBe(true);
    expect(result.language).toBe('node');

    const dbVar = result.vars.find((v) => v.key === 'DATABASE_URL');
    expect(dbVar).toBeDefined();
    expect(dbVar?.optional).toBe(false);
    expect(dbVar?.files.map((f) => f.path)).toContain('app.ts');
    expect(dbVar?.files.map((f) => f.path)).toContain('.env.example');
    expect(dbVar?.files.some((f) => f.path.includes('Dockerfile ARG'))).toBe(true);
  });

  it('auto-detects Dockerfile paths when dockerfilePath is not provided', () => {
    mkdirSync(join(tmp, 'apps', 'api'), { recursive: true });
    writeFileSync(join(tmp, 'apps', 'api', 'Dockerfile'), 'FROM node:22\nARG API_TOKEN\n');

    const result = scanRepoEnvVars(tmp, { scanSourceCode: false, scanDotEnv: false });

    expect(result.vars.some((v) => v.key === 'API_TOKEN')).toBe(true);
  });

  it('respects scanDotEnv and scanSourceCode options', () => {
    writeFileSync(join(tmp, 'app.ts'), 'const x = process.env.SOURCE_ONLY;');
    writeFileSync(join(tmp, '.env'), 'DOTENV_KEY=value\n');

    const result = scanRepoEnvVars(tmp, { scanSourceCode: false, scanDotEnv: false });

    expect(result.vars).toEqual([]);
    expect(result.language).toBe('unknown');
    expect(result.serviceHints).toEqual([]);
  });
});
