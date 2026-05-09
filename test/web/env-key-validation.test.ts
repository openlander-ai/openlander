/**
 * Tests the shared env-key validation contract between the frontend
 * (`web/src/lib/env-key.ts`) and the backend
 * (`src/web/api/helpers/env-route-validation.ts`). The backend rejects bad keys
 * with a 400; without client-side parity, users see the raw English
 * regex echoed back through the form's error toast.
 *
 * The pattern test below also pins the regex shape so a future
 * refactor that loosens one side without the other breaks CI.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ENV_KEY_PATTERN, findInvalidEnvKey, isValidEnvKey } from '../../web/src/lib/env-key.js';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('isValidEnvKey', () => {
  it.each([
    'PORT',
    'DATABASE_URL',
    '_LEADING_UNDERSCORE',
    'a',
    'a1',
    '_',
    'KEY_WITH_DIGITS_123',
    // Object.prototype member names are valid env keys per the regex.
    // The save handler must NOT false-positive on these as duplicates
    // (Codex CCG round 1 P1 — was using `key in envMap` on a plain object).
    'constructor',
    'toString',
    '__proto__',
    'hasOwnProperty',
  ])('accepts %s', (key) => {
    expect(isValidEnvKey(key)).toBe(true);
  });

  it.each([
    '',
    '1LEADING_DIGIT',
    'KEY-WITH-DASH',
    'KEY WITH SPACE',
    'KEY.WITH.DOT',
    'KEY:VALUE',
    'KEY=',
    '한글키',
    'KEY/SLASH',
  ])('rejects %s', (key) => {
    expect(isValidEnvKey(key)).toBe(false);
  });

  it('findInvalidEnvKey returns the first bad key, or null if all are valid', () => {
    expect(findInvalidEnvKey(['PORT', 'NODE_ENV'])).toBeNull();
    expect(findInvalidEnvKey(['PORT', '1BAD', 'NODE_ENV'])).toBe('1BAD');
    expect(findInvalidEnvKey(['BAD-KEY'])).toBe('BAD-KEY');
  });
});

describe('ENV_KEY_PATTERN parity with backend', () => {
  // Pin both sides to the same regex source. If a future change
  // loosens or tightens one without the other, the form's preview
  // diverges from the backend's actual rejection set.
  it('matches the regex literal in src/web/api/helpers/env-route-validation.ts', () => {
    const backend = readRepoFile('src/web/api/helpers/env-route-validation.ts');
    expect(backend).toContain('export const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/');
  });

  it('frontend ENV_KEY_PATTERN is the same regex source', () => {
    expect(ENV_KEY_PATTERN.source).toBe('^[A-Za-z_][A-Za-z0-9_]*$');
  });
});

describe('ServiceDetailV2 env save handler', () => {
  const pageSource = readRepoFile('web/src/pages/ServiceDetailV2.tsx');

  it('imports the shared env-key validator', () => {
    expect(pageSource).toMatch(/import \{ isValidEnvKey \} from '@\/lib\/env-key'/);
  });

  it('blocks the submit with a localized error before calling the API', () => {
    expect(pageSource).toMatch(/!isValidEnvKey\(key\)/);
    expect(pageSource).toContain("t('projectDetail.env.invalidKey')");
    // The check must short-circuit the function, not just log.
    expect(pageSource).toMatch(
      /!isValidEnvKey\(key\)\) \{[\s\S]*?setEnvError\([\s\S]*?invalidKey[\s\S]*?\);\s*return;/,
    );
  });

  it('uses Map for duplicate detection — no prototype-pollution false positives', () => {
    // Codex CCG round 1 P1: `key in envMap` on a plain object false-flags
    // `constructor`, `toString`, `__proto__` etc. as duplicates because
    // they exist on Object.prototype. Map.has() reads only own keys.
    expect(pageSource).toMatch(/const envMap = new Map<string, string>\(\)/);
    expect(pageSource).toMatch(/envMap\.has\(key\)/);
    expect(pageSource).toMatch(/envMap\.set\(key, row\.value\)/);
    // Only inspect non-comment lines so the explanatory comment that
    // names the bug doesn't false-trip the assertion.
    const codeOnly = pageSource
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('//') && !line.trimStart().startsWith('*'))
      .join('\n');
    expect(codeOnly).not.toMatch(/key in envMap/);
  });

  it('paste-import refuses bad keys instead of letting them land in the form', () => {
    // Codex CCG round 1 P2: parseEnvContent does not validate key
    // shape, so bad .env paste used to silently land in the form and
    // fail later at Save. Now refused at import with the same
    // localized invalid-key error.
    expect(pageSource).toMatch(/parsed\.find\(\(entry\) => !isValidEnvKey\(entry\.key\)\)/);
  });
});

describe('i18n keys are present in both locales', () => {
  for (const locale of ['en', 'ko']) {
    it(`${locale}: projectDetail.env.invalidKey is defined and references {key}`, () => {
      const dict = readRepoFile(`web/src/i18n/${locale}.ts`);
      expect(dict).toMatch(/invalidKey:\s*[\s\S]*?\{key\}/);
    });
  }
});
