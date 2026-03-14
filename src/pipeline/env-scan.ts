import { createModuleLogger } from '../lib/logger.js';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { detectEnvFile } from './env-inject.js';

const log = createModuleLogger('env-scan');

export interface EnvVarUsage {
  key: string;
  files: Array<{ path: string; line: number }>;
}

export interface EnvScanResult {
  vars: EnvVarUsage[];
  hasEnvExample: boolean;
  language: string;
  serviceHints: string[];
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
}

export function scanForEnvUsage(projectPath: string): EnvScanResult {
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
      if (SKIP_DIRS.has(entry)) continue;
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

      for (const pattern of patterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = pattern.exec(content)) !== null) {
          const key = match[1];
          if (!key || SYSTEM_VARS.has(key)) continue;
          const line = content.slice(0, match.index).split('\n').length;
          findings.push({ key, path: relPath, line });
        }
      }

      if (isNode) {
        NODE_DESTRUCTURE.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = NODE_DESTRUCTURE.exec(content)) !== null) {
          const raw = match[1] ?? '';
          const line = content.slice(0, match.index).split('\n').length;
          for (const part of raw.split(',')) {
            const key = part.trim().split(':')[0]?.trim();
            if (!key || SYSTEM_VARS.has(key)) continue;
            findings.push({ key, path: relPath, line });
          }
        }
      }
    }
  }

  try {
    scanDir(projectPath);
  } catch (err) {
    log.warn({ err }, 'Error during env scan');
  }

  // Deduplicate: group by key, merge file references
  const byKey = new Map<string, Array<{ path: string; line: number }>>();
  for (const { key, path, line } of findings) {
    const list = byKey.get(key) ?? [];
    if (!list.some((e) => e.path === path && e.line === line)) {
      list.push({ path, line });
    }
    byKey.set(key, list);
  }

  const vars: EnvVarUsage[] = Array.from(byKey.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, files]) => ({ key, files }));

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
