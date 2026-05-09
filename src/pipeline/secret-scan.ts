import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative } from 'node:path';

import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('secret-scan');

export interface SecretFinding {
  file: string;
  line: number;
  pattern: string;
  type: string;
}

interface SecretPattern {
  type: string;
  regex: RegExp;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { type: 'aws_key', regex: /AKIA[0-9A-Z]{16}/ },
  { type: 'github_token', regex: /gh[ps]_[a-zA-Z0-9]{36}/ },
  { type: 'github_token', regex: /gho_[a-zA-Z0-9]{36}/ },
  { type: 'github_token', regex: /ghu_[a-zA-Z0-9]{36}/ },
  { type: 'github_token', regex: /ghr_[a-zA-Z0-9]{36}/ },
  { type: 'openai_key', regex: /sk-[a-zA-Z0-9]{20,}/ },
  { type: 'stripe_key', regex: /sk_live_[a-zA-Z0-9]{20,}/ },
  { type: 'stripe_key', regex: /sk_test_[a-zA-Z0-9]{20,}/ },
  { type: 'db_url', regex: /(postgres|mysql|mongodb):\/\/[^@\s]+:[^@\s]+@/ },
  { type: 'private_key', regex: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { type: 'openai_key', regex: /sk-proj-[a-zA-Z0-9_-]{20,}/ },
  { type: 'github_pat', regex: /github_pat_[a-zA-Z0-9_]{20,}/ },
  { type: 'aws_temp_key', regex: /ASIA[0-9A-Z]{16}/ },
  { type: 'slack_token', regex: /xoxb-[0-9]+-[a-zA-Z0-9]+/ },
  { type: 'slack_token', regex: /xoxp-[0-9]+-[a-zA-Z0-9]+/ },
  { type: 'slack_token', regex: /xoxs-[0-9]+-[a-zA-Z0-9]+/ },
];

const SKIP_DIRS = new Set(['.env', 'node_modules', '.git', 'dist', 'build']);
const SKIP_EXTENSIONS = new Set([
  '.lock',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.svg',
  '.mp3',
  '.mp4',
  '.zip',
  '.tar',
  '.gz',
]);

function maskValue(value: string): string {
  if (value.length <= 8) return '****';
  return value.slice(0, 4) + '...' + value.slice(-4);
}

function shouldSkipFile(filePath: string): boolean {
  const base = filePath.split('/').pop() ?? '';
  if (base.startsWith('.env')) return true;
  if (SKIP_EXTENSIONS.has(extname(filePath).toLowerCase())) return true;
  return false;
}

function walkDir(dir: string, basePath: string): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue;

      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          files.push(...walkDir(fullPath, basePath));
        } else if (stat.isFile() && stat.size < 1_000_000) {
          const relPath = relative(basePath, fullPath);
          if (!shouldSkipFile(relPath)) {
            files.push(fullPath);
          }
        }
      } catch (_err) {
        continue;
      }
    }
  } catch (_err) {
    return files;
  }

  return files;
}

export function scanForSecrets(projectPath: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const files = walkDir(projectPath, projectPath);

  for (const filePath of files) {
    try {
      const content = readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      const relPath = relative(projectPath, filePath);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!line) continue;

        for (const pattern of SECRET_PATTERNS) {
          if (pattern.type === 'openai_key' && relPath.includes('.env')) continue;

          const match = pattern.regex.exec(line);
          if (match) {
            findings.push({
              file: relPath,
              line: i + 1,
              pattern: maskValue(match[0]),
              type: pattern.type,
            });
            break;
          }
        }
      }
    } catch (_err) {
      continue;
    }
  }

  log.info({ count: findings.length, projectPath }, 'Secret scan completed');
  return findings;
}
