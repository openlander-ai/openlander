import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFile } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import {
  BUILD_IMPACT_PATTERNS,
  analyzeBuildDiff,
  formatDiffForPrompt,
  type DiffAnalysis,
} from '../src/pipeline/diff-analysis.js';

const mockExecFile = vi.mocked(execFile);

type ExecStep = {
  file: string;
  args: string[];
  stdout?: string;
  stderr?: string;
  error?: Error;
};

function mockExecSequence(steps: ExecStep[]): void {
  const queue = [...steps];

  mockExecFile.mockImplementation(((
    file: string,
    args: readonly string[],
    options:
      | {
          cwd?: string;
          timeout?: number;
        }
      | ((error: Error | null, result: { stdout: string; stderr: string }) => void),
    callback?: (error: Error | null, result: { stdout: string; stderr: string }) => void,
  ) => {
    const cb = (typeof options === 'function' ? options : callback) as
      | ((error: Error | null, result: { stdout: string; stderr: string }) => void)
      | undefined;

    if (!cb) {
      return undefined as never;
    }

    const next = queue.shift();
    if (!next) {
      cb(new Error('Unexpected execFile call'), { stdout: '', stderr: '' });
      return undefined as never;
    }

    expect(file).toBe(next.file);
    expect(args).toEqual(next.args);

    if (next.error) {
      cb(next.error, { stdout: '', stderr: next.stderr ?? '' });
      return undefined as never;
    }

    cb(null, { stdout: next.stdout ?? '', stderr: next.stderr ?? '' });
    return undefined as never;
  }) as unknown as typeof execFile);
}

describe('BUILD_IMPACT_PATTERNS', () => {
  it('includes all expected Docker files', () => {
    expect(BUILD_IMPACT_PATTERNS).toContain('Dockerfile');
    expect(BUILD_IMPACT_PATTERNS).toContain('docker-compose.yml');
    expect(BUILD_IMPACT_PATTERNS).toContain('docker-compose.yaml');
    expect(BUILD_IMPACT_PATTERNS).toContain('.dockerignore');
  });

  it('includes all expected dependency files', () => {
    expect(BUILD_IMPACT_PATTERNS).toContain('package.json');
    expect(BUILD_IMPACT_PATTERNS).toContain('requirements.txt');
    expect(BUILD_IMPACT_PATTERNS).toContain('go.mod');
    expect(BUILD_IMPACT_PATTERNS).toContain('Cargo.toml');
  });

  it('includes env template files', () => {
    expect(BUILD_IMPACT_PATTERNS).toContain('.env.example');
    expect(BUILD_IMPACT_PATTERNS).toContain('.env.sample');
    expect(BUILD_IMPACT_PATTERNS).toContain('.env.template');
  });
});

describe('analyzeBuildDiff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    mockExecFile.mockReset();
  });

  it('returns null if HEAD resolution fails', async () => {
    mockExecSequence([
      {
        file: 'git',
        args: ['rev-parse', 'HEAD'],
        error: new Error('git failed'),
      },
    ]);

    const result = await analyzeBuildDiff('/tmp/repo', 'prev-sha');
    expect(result).toBeNull();
  });

  it('returns null if previous sha equals current sha', async () => {
    mockExecSequence([
      {
        file: 'git',
        args: ['rev-parse', 'HEAD'],
        stdout: 'same-sha\n',
      },
    ]);

    const result = await analyzeBuildDiff('/tmp/repo', 'same-sha');
    expect(result).toBeNull();
  });

  it('returns DiffAnalysis with correct flags for dependency changes', async () => {
    mockExecSequence([
      { file: 'git', args: ['rev-parse', 'HEAD'], stdout: 'current-sha\n' },
      {
        file: 'git',
        args: ['diff', '--name-only', 'prev-sha..HEAD'],
        stdout: 'src/index.ts\npackage.json\n',
      },
    ]);

    const result = await analyzeBuildDiff('/tmp/repo', 'prev-sha');

    expect(result).not.toBeNull();
    expect(result?.depsChanged).toBe(true);
    expect(result?.dockerChanged).toBe(false);
    expect(result?.envTemplateChanged).toBe(false);
    expect(result?.buildImpactFiles).toEqual(['package.json']);
    expect(result?.summary).toBe('2 files changed, 1 build-impacting');
  });

  it('returns DiffAnalysis with correct flags for Docker changes', async () => {
    mockExecSequence([
      { file: 'git', args: ['rev-parse', 'HEAD'], stdout: 'current-sha\n' },
      {
        file: 'git',
        args: ['diff', '--name-only', 'prev-sha..HEAD'],
        stdout: 'Dockerfile\nREADME.md\n',
      },
    ]);

    const result = await analyzeBuildDiff('/tmp/repo', 'prev-sha');

    expect(result).not.toBeNull();
    expect(result?.dockerChanged).toBe(true);
    expect(result?.depsChanged).toBe(false);
    expect(result?.envTemplateChanged).toBe(false);
    expect(result?.buildImpactFiles).toEqual(['Dockerfile']);
  });

  it('returns DiffAnalysis with correct flags for env template changes', async () => {
    mockExecSequence([
      { file: 'git', args: ['rev-parse', 'HEAD'], stdout: 'current-sha\n' },
      {
        file: 'git',
        args: ['diff', '--name-only', 'prev-sha..HEAD'],
        stdout: '.env.example\nsrc/main.ts\n',
      },
    ]);

    const result = await analyzeBuildDiff('/tmp/repo', 'prev-sha');

    expect(result).not.toBeNull();
    expect(result?.envTemplateChanged).toBe(true);
    expect(result?.dockerChanged).toBe(false);
    expect(result?.depsChanged).toBe(false);
    expect(result?.buildImpactFiles).toEqual(['.env.example']);
  });

  it('filters build-impacting files from all changed files', async () => {
    mockExecSequence([
      { file: 'git', args: ['rev-parse', 'HEAD'], stdout: 'current-sha\n' },
      {
        file: 'git',
        args: ['diff', '--name-only', 'prev-sha..HEAD'],
        stdout: 'src/index.ts\npackage.json\ndocs/readme.md\ndeploy/Dockerfile\n.env.template\n',
      },
    ]);

    const result = await analyzeBuildDiff('/tmp/repo', 'prev-sha');

    expect(result).not.toBeNull();
    expect(result?.changedFiles).toEqual([
      'src/index.ts',
      'package.json',
      'docs/readme.md',
      'deploy/Dockerfile',
      '.env.template',
    ]);
    expect(result?.buildImpactFiles).toEqual([
      'package.json',
      'deploy/Dockerfile',
      '.env.template',
    ]);
    expect(result?.totalChangedFiles).toBe(5);
  });

  it('falls back to fetch + retry on shallow clone failure', async () => {
    mockExecSequence([
      { file: 'git', args: ['rev-parse', 'HEAD'], stdout: 'current-sha\n' },
      {
        file: 'git',
        args: ['diff', '--name-only', 'prev-sha..HEAD'],
        error: new Error('shallow clone diff failed'),
      },
      {
        file: 'git',
        args: ['fetch', '--depth=50', 'origin'],
        stdout: '',
      },
      {
        file: 'git',
        args: ['diff', '--name-only', 'prev-sha..HEAD'],
        stdout: 'vite.config.ts\n',
      },
    ]);

    const result = await analyzeBuildDiff('/tmp/repo', 'prev-sha');

    expect(result).not.toBeNull();
    expect(result?.buildImpactFiles).toEqual(['vite.config.ts']);
    expect(result?.summary).toBe('1 files changed, 1 build-impacting');
  });

  it('returns null when both diff attempts fail', async () => {
    mockExecSequence([
      { file: 'git', args: ['rev-parse', 'HEAD'], stdout: 'current-sha\n' },
      {
        file: 'git',
        args: ['diff', '--name-only', 'prev-sha..HEAD'],
        error: new Error('first diff failed'),
      },
      {
        file: 'git',
        args: ['fetch', '--depth=50', 'origin'],
        stdout: '',
      },
      {
        file: 'git',
        args: ['diff', '--name-only', 'prev-sha..HEAD'],
        error: new Error('second diff failed'),
      },
    ]);

    const result = await analyzeBuildDiff('/tmp/repo', 'prev-sha');
    expect(result).toBeNull();
  });
});

describe('formatDiffForPrompt', () => {
  function makeAnalysis(overrides: Partial<DiffAnalysis> = {}): DiffAnalysis {
    return {
      changedFiles: ['package.json', 'src/index.ts'],
      buildImpactFiles: ['package.json'],
      summary: '2 files changed, 1 build-impacting',
      envTemplateChanged: false,
      dockerChanged: false,
      depsChanged: true,
      previousSha: 'abcdef1234567890',
      currentSha: '1234567890abcdef',
      totalChangedFiles: 2,
      ...overrides,
    };
  }

  it('formats output with build-impacting files and labels', () => {
    const formatted = formatDiffForPrompt(makeAnalysis());

    expect(formatted).toContain('## Recent Changes (since last deploy)');
    expect(formatted).toContain('Commits: abcdef1 -> 1234567 | 2 files changed, 1 build-impacting');
    expect(formatted).toContain('Build-impacting changes:');
    expect(formatted).toContain('- package.json (dependency change)');
  });

  it('formats output without impact files', () => {
    const formatted = formatDiffForPrompt(
      makeAnalysis({
        changedFiles: ['src/index.ts', 'README.md'],
        buildImpactFiles: [],
        summary: '2 files changed (none build-impacting)',
        depsChanged: false,
        totalChangedFiles: 2,
      }),
    );

    expect(formatted).toContain('## Recent Changes (since last deploy)');
    expect(formatted).toContain(
      'Commits: abcdef1 -> 1234567 | 2 files changed (none build-impacting)',
    );
    expect(formatted).not.toContain('Build-impacting changes:');
  });

  it('shows correct file labels: dependency, Docker, env template, config', () => {
    const formatted = formatDiffForPrompt(
      makeAnalysis({
        changedFiles: ['package.json', 'Dockerfile', '.env.example', 'vite.config.ts'],
        buildImpactFiles: ['package.json', 'Dockerfile', '.env.example', 'vite.config.ts'],
        depsChanged: true,
        dockerChanged: true,
        envTemplateChanged: true,
        summary: '4 files changed, 4 build-impacting',
        totalChangedFiles: 4,
      }),
    );

    expect(formatted).toContain('- package.json (dependency change)');
    expect(formatted).toContain('- Dockerfile (Docker config change)');
    expect(formatted).toContain('- .env.example (env template change)');
    expect(formatted).toContain('- vite.config.ts (config change)');
  });
});
