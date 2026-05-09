import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename } from 'node:path';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('diff-analysis');

type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExec: ExecFn = promisify(execFile);

export interface DiffAnalysis {
  changedFiles: string[];
  buildImpactFiles: string[];
  summary: string;
  envTemplateChanged: boolean;
  dockerChanged: boolean;
  depsChanged: boolean;
  previousSha: string;
  currentSha: string;
  totalChangedFiles: number;
}

export const BUILD_IMPACT_PATTERNS: readonly string[] = [
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.dockerignore',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'Pipfile.lock',
  'setup.py',
  'setup.cfg',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  '.env.example',
  '.env.sample',
  '.env.template',
  'next.config.js',
  'next.config.mjs',
  'next.config.ts',
  'vite.config.ts',
  'vite.config.js',
  'tsconfig.json',
  'nginx.conf',
  '.nvmrc',
  '.node-version',
  '.python-version',
  '.tool-versions',
  'Procfile',
] as const;

const ENV_TEMPLATE_FILES = new Set(['.env.example', '.env.sample', '.env.template']);
const DOCKER_FILES = new Set([
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
  '.dockerignore',
]);
const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lockb',
  'requirements.txt',
  'pyproject.toml',
  'Pipfile',
  'Pipfile.lock',
  'setup.py',
  'setup.cfg',
  'go.mod',
  'go.sum',
  'Cargo.toml',
  'Cargo.lock',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
]);
const IMPACT_SET = new Set(BUILD_IMPACT_PATTERNS);

export async function analyzeBuildDiff(
  clonePath: string,
  previousCommitSha: string,
  execFn: ExecFn = defaultExec,
): Promise<DiffAnalysis | null> {
  let currentSha: string;

  try {
    const { stdout } = await execFn('git', ['rev-parse', 'HEAD'], { cwd: clonePath });
    currentSha = stdout.trim();
  } catch (error) {
    log.debug({ error, clonePath }, 'Failed to resolve current HEAD sha');
    return null;
  }

  if (previousCommitSha === currentSha) {
    return null;
  }

  let diffStdout: string;
  const diffArgs = ['diff', '--name-only', `${previousCommitSha}..HEAD`];

  try {
    const { stdout } = await execFn('git', diffArgs, { cwd: clonePath });
    diffStdout = stdout;
  } catch (err) {
    log.debug({ err, previousCommitSha, currentSha }, 'Git diff failed');
    try {
      await execFn('git', ['fetch', '--depth=50', 'origin'], { cwd: clonePath, timeout: 30_000 });
      const { stdout } = await execFn('git', diffArgs, { cwd: clonePath });
      diffStdout = stdout;
    } catch (error) {
      log.debug({ error, previousCommitSha, currentSha }, 'Diff analysis skipped in shallow clone');
      return null;
    }
  }

  const changedFiles = diffStdout
    .split('\n')
    .map((file) => file.trim())
    .filter((file) => file.length > 0);

  const buildImpactFiles = changedFiles.filter((file) => IMPACT_SET.has(basename(file)));
  const fileBasenames = buildImpactFiles.map((file) => basename(file));

  const envTemplateChanged = fileBasenames.some((name) => ENV_TEMPLATE_FILES.has(name));
  const dockerChanged = fileBasenames.some((name) => DOCKER_FILES.has(name));
  const depsChanged = fileBasenames.some((name) => DEPENDENCY_FILES.has(name));

  const totalChangedFiles = changedFiles.length;
  const summary =
    buildImpactFiles.length > 0
      ? `${String(totalChangedFiles)} files changed, ${String(buildImpactFiles.length)} build-impacting`
      : `${String(totalChangedFiles)} files changed (none build-impacting)`;

  return {
    changedFiles,
    buildImpactFiles,
    summary,
    envTemplateChanged,
    dockerChanged,
    depsChanged,
    previousSha: previousCommitSha,
    currentSha,
    totalChangedFiles,
  };
}

export function formatDiffForPrompt(analysis: DiffAnalysis): string {
  const shortPrevSha = analysis.previousSha.slice(0, 7);
  const shortCurrentSha = analysis.currentSha.slice(0, 7);

  if (analysis.buildImpactFiles.length === 0) {
    return [
      '## Recent Changes (since last deploy)',
      `Commits: ${shortPrevSha} -> ${shortCurrentSha} | ${String(analysis.totalChangedFiles)} files changed (none build-impacting)`,
    ].join('\n');
  }

  const impactLines = analysis.buildImpactFiles.map((file) => {
    const name = basename(file);
    let label = '(config change)';

    if (ENV_TEMPLATE_FILES.has(name)) {
      label = '(env template change)';
    } else if (DOCKER_FILES.has(name)) {
      label = '(Docker config change)';
    } else if (DEPENDENCY_FILES.has(name)) {
      label = '(dependency change)';
    }

    return `- ${file} ${label}`;
  });

  return [
    '## Recent Changes (since last deploy)',
    `Commits: ${shortPrevSha} -> ${shortCurrentSha} | ${String(analysis.totalChangedFiles)} files changed, ${String(analysis.buildImpactFiles.length)} build-impacting`,
    '',
    'Build-impacting changes:',
    ...impactLines,
  ].join('\n');
}
