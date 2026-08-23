import { createModuleLogger } from '../lib/logger.js';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scanDockerfileArgs, scanEnvFile } from '../lib/env-parser.js';
import { findDockerfiles } from '../lib/repo-scanner.js';
import { detectEnvFile } from './env-inject.js';
import {
  inferEnvValueRequirement,
  requirementFromNodeSchemaObject,
  type EnvValueRequirement,
} from './env-requirements.js';

const log = createModuleLogger('env-scan');

export interface EnvVarUsage {
  key: string;
  files: Array<{ path: string; line: number }>;
  optional: boolean;
  /** True only when source contains an explicit runtime validation contract. */
  blocking?: boolean;
  requirement?: EnvValueRequirement;
}

export interface EnvScanResult {
  vars: EnvVarUsage[];
  hasEnvExample: boolean;
  language: string;
  serviceHints: string[];
}

export interface ScanRepoOptions {
  /** Dockerfile path(s) for ARG detection. Auto-detected if not provided. */
  dockerfilePath?: string;
  /** Scan source code for process.env/os.environ (default: true) */
  scanSourceCode?: boolean;
  /** Scan committed .env file for values (default: true) */
  scanDotEnv?: boolean;
}

export function scanRepoEnvVars(clonePath: string, opts: ScanRepoOptions = {}): EnvScanResult {
  const scanSourceCode = opts.scanSourceCode ?? true;
  const scanDotEnv = opts.scanDotEnv ?? true;

  const mergedByKey = new Map<
    string,
    {
      files: Array<{ path: string; line: number }>;
      optionalFlags: boolean[];
      blockingFlags: boolean[];
      requirement?: EnvValueRequirement;
    }
  >();
  const addUsage = (usage: EnvVarUsage): void => {
    const entry = mergedByKey.get(usage.key) ?? {
      files: [],
      optionalFlags: [],
      blockingFlags: [],
    };
    for (const file of usage.files) {
      if (
        !entry.files.some((existing) => existing.path === file.path && existing.line === file.line)
      ) {
        entry.files.push(file);
      }
    }
    entry.optionalFlags.push(usage.optional);
    entry.blockingFlags.push(usage.blocking === true);
    entry.requirement ??= usage.requirement ?? inferEnvValueRequirement(usage.key);
    mergedByKey.set(usage.key, entry);
  };

  const envTemplates = ['.env.example', '.env.sample', '.env.template'];
  let hasEnvExample = false;
  let language = 'unknown';
  let serviceHints: string[] = [];

  if (scanSourceCode) {
    const sourceResult = scanForEnvUsage(clonePath);
    hasEnvExample = sourceResult.hasEnvExample;
    language = sourceResult.language;
    serviceHints = sourceResult.serviceHints;
    for (const usage of sourceResult.vars) {
      addUsage(usage);
    }
  }

  for (const tpl of envTemplates) {
    const tplPath = join(clonePath, tpl);
    if (!existsSync(tplPath)) {
      continue;
    }

    hasEnvExample = true;
    const parsed = scanEnvFile(tplPath, tpl);
    for (const envEntry of parsed) {
      addUsage({
        key: envEntry.key,
        files: [{ path: envEntry.source, line: 0 }],
        optional: !envEntry.required,
        blocking: envEntry.required,
      });
    }
  }

  if (scanDotEnv) {
    const envPath = join(clonePath, '.env');
    if (existsSync(envPath)) {
      const parsed = scanEnvFile(envPath, '.env');
      for (const envEntry of parsed) {
        addUsage({
          key: envEntry.key,
          files: [{ path: envEntry.source, line: 0 }],
          optional: !envEntry.required,
          blocking: envEntry.required,
        });
      }
    }
  }

  const dockerfilePaths = opts.dockerfilePath
    ? [opts.dockerfilePath]
    : findDockerfiles(clonePath).map((dockerfilePath) => relative(clonePath, dockerfilePath));
  for (const dockerfilePath of dockerfilePaths) {
    const parsed = scanDockerfileArgs(clonePath, dockerfilePath);
    for (const envEntry of parsed) {
      addUsage({
        key: envEntry.key,
        files: [{ path: envEntry.source, line: 0 }],
        optional: !envEntry.required,
        blocking: envEntry.required,
      });
    }
  }

  const vars: EnvVarUsage[] = Array.from(mergedByKey.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { files, optionalFlags, blockingFlags, requirement }]) => ({
      key,
      files,
      optional: optionalFlags.every((flag) => flag),
      blocking: blockingFlags.some((flag) => flag),
      requirement,
    }));

  return {
    vars,
    hasEnvExample,
    language,
    serviceHints,
  };
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'out',
  '__pycache__',
  '.venv',
  'venv',
  '.cache',
  'coverage',
  'test',
  'tests',
  '__tests__',
  'e2e',
  'test-crash-scenarios',
  'fixtures',
  '__fixtures__',
  'mocks',
  '__mocks__',
  'test-results',
  'playwright-report',
  'docs',
  'examples',
  'scripts',
  'tools',
]);

const SYSTEM_VARS = new Set([
  'NODE_ENV',
  'PORT',
  'HOST',
  'HOME',
  'PATH',
  'PWD',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'HOSTNAME',
  'CI',
  'DEBUG',
  'PYTHONDONTWRITEBYTECODE',
  'PYTHONUNBUFFERED',
  'PYTHONPATH',
  'npm_config_yes',
  'npm_lifecycle_event',
]);

const NODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);
const PYTHON_EXTENSIONS = new Set(['.py']);
const COMPOSE_FILENAMES = [
  'docker-compose.yml',
  'docker-compose.yaml',
  'compose.yml',
  'compose.yaml',
];
const KNOWN_SERVICE_HINTS = [
  'postgres',
  'postgresql',
  'mysql',
  'mariadb',
  'redis',
  'mongo',
  'mongodb',
  'rabbitmq',
];

// Node.js: process.env.KEY, process.env['KEY']
const NODE_PATTERNS = [
  /process\.env\.([A-Z_][A-Z0-9_]*)/g,
  /process\.env\[['"]([A-Z_][A-Z0-9_]*)['"]]/g,
];
// Node.js: const { A, B } = process.env
const NODE_DESTRUCTURE = /const\s*\{([^}]+)\}\s*=\s*process\.env/g;
// Node.js config schemas often validate env dynamically:
// [{ key: 'JWT_SECRET', kind: 'minlen' }, ...] + process.env[s.key].
const NODE_ENV_SCHEMA_KEY =
  /\{\s*key\s*:\s*['"]([A-Z_][A-Z0-9_]*)['"][^}]*\bkind\s*:\s*['"](required|url|int|enum|prefix|minlen|optional)['"][^}]*\}/g;

// Python: os.environ['KEY'], os.environ.get('KEY'), os.getenv('KEY')
const PYTHON_PATTERNS = [
  /os\.environ\[['"]([A-Z_][A-Z0-9_]*)['"]]/g,
  /os\.environ\.get\(['"]([A-Z_][A-Z0-9_]*)['"]/g,
  /os\.getenv\(['"]([A-Z_][A-Z0-9_]*)['"]/g,
];

interface Finding {
  key: string;
  path: string;
  line: number;
  optional: boolean;
  blocking: boolean;
  requirement?: EnvValueRequirement;
}

/**
 * Mark JavaScript/TypeScript positions that are executable code. Regex-based
 * env detection still works for bracket access while ignoring examples in
 * comments and string literals. Template expressions remain executable.
 */
function buildNodeCodeMask(content: string): Uint8Array {
  const mask = new Uint8Array(content.length);
  let mode: 'code' | 'single' | 'double' | 'template' | 'line-comment' | 'block-comment' = 'code';
  let templateExpressionDepth = 0;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (mode === 'line-comment') {
      if (char === '\n') {
        mode = 'code';
        mask[index] = 1;
      }
      continue;
    }
    if (mode === 'block-comment') {
      if (char === '*' && next === '/') {
        index += 1;
        mode = 'code';
      }
      continue;
    }
    if (mode === 'single' || mode === 'double') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if ((mode === 'single' && char === "'") || (mode === 'double' && char === '"')) {
        mode = 'code';
      }
      continue;
    }
    if (mode === 'template') {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === '`') {
        mode = 'code';
        continue;
      }
      if (char === '$' && next === '{') {
        index += 1;
        templateExpressionDepth += 1;
        mode = 'code';
      }
      continue;
    }

    mask[index] = 1;
    if (char === '/' && next === '/') {
      mask[index] = 0;
      index += 1;
      mode = 'line-comment';
      continue;
    }
    if (char === '/' && next === '*') {
      mask[index] = 0;
      index += 1;
      mode = 'block-comment';
      continue;
    }
    if (char === "'") {
      mask[index] = 0;
      mode = 'single';
      continue;
    }
    if (char === '"') {
      mask[index] = 0;
      mode = 'double';
      continue;
    }
    if (char === '`') {
      mask[index] = 0;
      mode = 'template';
      continue;
    }
    if (templateExpressionDepth > 0) {
      if (char === '{') {
        templateExpressionDepth += 1;
      } else if (char === '}') {
        templateExpressionDepth -= 1;
        if (templateExpressionDepth === 0) {
          mask[index] = 0;
          mode = 'template';
        }
      }
    }
  }

  return mask;
}

function detectNodeFallback(content: string, key: string, matchIndex: number): boolean {
  const contextStart = Math.max(0, matchIndex - 10);
  const contextEnd = Math.min(content.length, matchIndex + 150);
  const context = content.slice(contextStart, contextEnd);

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const envAccess = `(?:process\\.env\\.${escapedKey}|process\\.env\\[['"]${escapedKey}['"]\\])`;
  const literalFallback = `(?:['"][^'"]*['"]|\\d+|true|false|null)`;
  const pathFallback = `(?:(?:path\\.)?(?:join|resolve)|path\\.(?:posix|win32)\\.(?:join|resolve))\\s*\\(`;
  const fallbackRegex = new RegExp(
    `${envAccess}\\s*(?:\\|\\||\\?\\?)\\s*(?:${literalFallback}|${pathFallback})`,
  );

  return fallbackRegex.test(context);
}

function detectNodeDestructureFallback(destructureMatch: string, key: string): boolean {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const keyPattern = new RegExp(`\\b${escapedKey}\\s*=\\s*['"][^'"]*['"]`);
  return keyPattern.test(destructureMatch);
}

function detectPythonFallback(content: string, key: string, matchIndex: number): boolean {
  const contextStart = Math.max(0, matchIndex - 10);
  const contextEnd = Math.min(content.length, matchIndex + 150);
  const context = content.slice(contextStart, contextEnd);

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const fallbackRegex = new RegExp(
    `os\\.environ\\.get\\(['"]${escapedKey}['"],\\s*['"][^'"]*['"]\\)|os\\.getenv\\(['"]${escapedKey}['"],\\s*['"][^'"]*['"]\\)`,
  );

  return fallbackRegex.test(context);
}

export function scanForEnvUsage(projectPath: string, scopeDir?: string): EnvScanResult {
  const findings: Finding[] = [];
  let hasNode = false;
  let hasPython = false;

  function scanDir(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch (_err) {
      return;
    }

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue;
      const fullPath = join(dir, entry);

      let isDir = false;
      try {
        isDir = statSync(fullPath).isDirectory();
      } catch (_err) {
        continue;
      }

      if (isDir) {
        scanDir(fullPath);
        continue;
      }

      const dotIdx = entry.lastIndexOf('.');
      if (dotIdx === -1) continue;
      const ext = entry.slice(dotIdx);
      const isNode = NODE_EXTENSIONS.has(ext);
      const isPython = PYTHON_EXTENSIONS.has(ext);
      if (!isNode && !isPython) continue;

      if (isNode) hasNode = true;
      if (isPython) hasPython = true;

      let content: string;
      try {
        content = readFileSync(fullPath, 'utf8');
      } catch (err) {
        log.debug({ err, path: fullPath }, 'Failed to scan directory');
        continue;
      }

      const relPath = relative(projectPath, fullPath);
      const patterns = isNode ? NODE_PATTERNS : PYTHON_PATTERNS;
      const nodeCodeMask = isNode ? buildNodeCodeMask(content) : undefined;

      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
          if (nodeCodeMask && nodeCodeMask[match.index] !== 1) continue;
          const key = match[1];
          if (!key || SYSTEM_VARS.has(key)) continue;
          const line = content.slice(0, match.index).split('\n').length;
          const optional = isNode
            ? detectNodeFallback(content, key, match.index)
            : detectPythonFallback(content, key, match.index);
          findings.push({
            key,
            path: relPath,
            line,
            optional,
            blocking: isPython && pattern === PYTHON_PATTERNS[0],
            requirement: inferEnvValueRequirement(key),
          });
        }
      }

      if (isNode) {
        NODE_DESTRUCTURE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = NODE_DESTRUCTURE.exec(content)) !== null) {
          if (nodeCodeMask?.[match.index] !== 1) continue;
          const raw = match[1] ?? '';
          const line = content.slice(0, match.index).split('\n').length;
          for (const part of raw.split(',')) {
            let key = part.trim().split(':')[0]?.trim();
            if (!key) continue;
            key = key.split('=')[0]?.trim() ?? key;
            if (!key || SYSTEM_VARS.has(key)) continue;
            const optional = detectNodeDestructureFallback(raw, key);
            findings.push({
              key,
              path: relPath,
              line,
              optional,
              blocking: false,
              requirement: inferEnvValueRequirement(key),
            });
          }
        }

        NODE_ENV_SCHEMA_KEY.lastIndex = 0;
        while ((match = NODE_ENV_SCHEMA_KEY.exec(content)) !== null) {
          if (nodeCodeMask?.[match.index] !== 1) continue;
          const key = match[1];
          const kind = match[2];
          if (!key || !kind || SYSTEM_VARS.has(key)) continue;
          const line = content.slice(0, match.index).split('\n').length;
          findings.push({
            key,
            path: relPath,
            line,
            optional: kind === 'optional',
            blocking: kind !== 'optional',
            requirement:
              requirementFromNodeSchemaObject(match[0], kind) ?? inferEnvValueRequirement(key),
          });
        }
      }
    }
  }

  const scanRoot = scopeDir ? join(projectPath, scopeDir) : projectPath;
  try {
    scanDir(scanRoot);
  } catch (err) {
    log.warn({ err }, 'Error during env scan');
  }

  const byKey = new Map<
    string,
    {
      files: Array<{ path: string; line: number }>;
      optionalFlags: boolean[];
      blockingFlags: boolean[];
      requirement?: EnvValueRequirement;
    }
  >();
  for (const { key, path, line, optional, blocking, requirement } of findings) {
    const entry = byKey.get(key) ?? { files: [], optionalFlags: [], blockingFlags: [] };
    if (!entry.files.some((e) => e.path === path && e.line === line)) {
      entry.files.push({ path, line });
      entry.optionalFlags.push(optional);
      entry.blockingFlags.push(blocking);
    }
    entry.requirement ??= requirement ?? inferEnvValueRequirement(key);
    byKey.set(key, entry);
  }

  const vars: EnvVarUsage[] = Array.from(byKey.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, { files, optionalFlags, blockingFlags, requirement }]) => ({
      key,
      files,
      optional: optionalFlags.every((flag) => flag),
      blocking: blockingFlags.some((flag) => flag),
      requirement,
    }));

  const language =
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    hasNode && hasPython ? 'mixed' : hasNode ? 'node' : hasPython ? 'python' : 'unknown';

  return {
    vars,
    hasEnvExample: detectEnvFile(projectPath) !== null,
    language,
    serviceHints: detectServiceHints(projectPath),
  };
}

function detectServiceHints(projectPath: string): string[] {
  const detected = new Set<string>();

  for (const fileName of COMPOSE_FILENAMES) {
    const composePath = join(projectPath, fileName);
    let content: string;
    try {
      content = readFileSync(composePath, 'utf8');
    } catch (_err) {
      continue;
    }

    const normalized = content.toLowerCase();
    for (const service of KNOWN_SERVICE_HINTS) {
      if (normalized.includes(service)) {
        detected.add(service);
      }
    }
  }

  return Array.from(detected).sort((a, b) => a.localeCompare(b));
}
