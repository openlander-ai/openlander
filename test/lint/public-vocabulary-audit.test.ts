import { readdirSync, readFileSync, statSync } from 'node:fs';
import path, { resolve } from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..');

const LAUNCH_DOC_PATHS = ['README.md', 'docs/wiki', 'docs/guides'] as const;

const EXCLUDED_PUBLIC_DOC_PATHS = [
  'docs/release/**',
  'docs/i18n-policy.md',
  'docs/assets/**',
] as const;

const USER_FACING_SOURCE_PATHS = [
  'src/mcp',
  'src/llm',
  'src/tools/defs',
  'src/pipeline/deploy-plan',
  'src/pipeline/deploy-core.ts',
  'src/errors.ts',
  'src/web/api/system-routes.ts',
  'web/src/i18n',
  'web/src/components/agent-guide',
  'web/src/components/service/CreateServiceDialog.tsx',
  'web/src/components/project',
  'web/src/components/Shell',
  'web/src/pages',
] as const;

const WEB_API_RUNTIME_COPY_PATHS = ['src/web/api'] as const;

const FORBIDDEN_PUBLIC_NOUNS = [
  /\bproject groups?\b/i,
  /\bdeployable services?\b/i,
  /\bmanaged services?\b/i,
  /\bmanaged DBs?\b/i,
  /\bcreate services?\b/i,
  /\badd services?\b/i,
] as const;

const SCANNED_EXTENSIONS = new Set(['.md', '.ts', '.tsx']);

function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

function collectFiles(relativePath: string): string[] {
  const absolutePath = repoPath(relativePath);
  const stat = statSync(absolutePath);
  if (stat.isFile()) {
    return SCANNED_EXTENSIONS.has(path.extname(relativePath)) ? [relativePath] : [];
  }

  const out: string[] = [];
  for (const entry of readdirSync(absolutePath)) {
    const child = path.join(relativePath, entry);
    const childStat = statSync(repoPath(child));
    if (childStat.isDirectory()) {
      out.push(...collectFiles(child));
    } else if (SCANNED_EXTENSIONS.has(path.extname(child))) {
      out.push(child);
    }
  }
  return out;
}

function assertNoForbiddenVocabulary(files: readonly string[]): void {
  const failures: string[] = [];
  for (const file of files) {
    const source = readFileSync(repoPath(file), 'utf8');
    for (const pattern of FORBIDDEN_PUBLIC_NOUNS) {
      const match = source.match(pattern);
      if (match) {
        failures.push(`${file}: ${match[0]}`);
      }
    }
  }

  expect(failures).toEqual([]);
}

function collectStringLiterals(file: string): string[] {
  const source = readFileSync(repoPath(file), 'utf8');
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const literals: string[] = [];

  function visit(node: ts.Node): void {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      literals.push(node.text);
    } else if (ts.isTemplateExpression(node)) {
      literals.push(node.head.text);
      for (const span of node.templateSpans) {
        literals.push(span.literal.text);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return literals;
}

function assertNoForbiddenVocabularyInStringLiterals(files: readonly string[]): void {
  const failures: string[] = [];
  for (const file of files) {
    for (const literal of collectStringLiterals(file)) {
      for (const pattern of FORBIDDEN_PUBLIC_NOUNS) {
        const match = literal.match(pattern);
        if (match) {
          failures.push(`${file}: ${match[0]}`);
        }
      }
    }
  }

  expect(failures).toEqual([]);
}

describe('public vocabulary audit', () => {
  it('documents public doc paths excluded from launch-facing copy scans', () => {
    expect(EXCLUDED_PUBLIC_DOC_PATHS).toEqual([
      'docs/release/**',
      'docs/i18n-policy.md',
      'docs/assets/**',
    ]);
  });

  it('keeps launch-facing docs on the Project/Application/Compose/resource model', () => {
    const files = LAUNCH_DOC_PATHS.flatMap(collectFiles);
    expect(files).toEqual(
      expect.arrayContaining([
        'README.md',
        'docs/wiki/Deploy-Guide.md',
        'docs/wiki/MCP-Tools-Reference.md',
        'docs/wiki/Services.md',
        'docs/wiki/Web-Dashboard.md',
        'docs/guides/leaky-services.md',
      ]),
    );
    assertNoForbiddenVocabulary(files);
  });

  it('keeps MCP/runtime/web copy free of old public nouns', () => {
    const files = USER_FACING_SOURCE_PATHS.flatMap(collectFiles);
    assertNoForbiddenVocabulary(files);
  });

  it('keeps web API runtime string copy free of old public nouns', () => {
    const files = WEB_API_RUNTIME_COPY_PATHS.flatMap(collectFiles);
    expect(files).toEqual(
      expect.arrayContaining([
        'src/web/api/routes.ts',
        'src/web/api/system-routes.ts',
        'src/web/api/project-compat-routes.ts',
      ]),
    );
    assertNoForbiddenVocabularyInStringLiterals(files);
  });
});
