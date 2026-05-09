import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function gitCheckIgnore(path: string): boolean {
  const result = spawnSync('git', ['check-ignore', '--no-index', path], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  return result.status === 0;
}

describe('public release tree hygiene', () => {
  it('does not ignore source directories named logs', () => {
    const gitignore = readFileSync('.gitignore', 'utf8');

    expect(gitignore).toContain('/logs/');
    expect(gitignore).not.toMatch(/(^|\n)logs\/(\n|$)/);
    expect(gitCheckIgnore('logs/stdio-server.log')).toBe(true);
    expect(gitCheckIgnore('web/src/components/logs/LogViewer.tsx')).toBe(false);
    expect(gitCheckIgnore('web/src/components/logs/StaticLogViewer.tsx')).toBe(false);
  });

  it('computes release minor Docker tags without shell-interpreted backticks', () => {
    const workflow = readFileSync('.github/workflows/release-publish.yml', 'utf8');

    expect(workflow).toContain("process.stdout.write(major + '.' + minor)");
    expect(workflow).not.toContain('console.log(`${major}.${minor}`)');
    expect(workflow).toContain('--tag "${IMAGE_NAME}:${{ steps.version.outputs.major_minor }}"');
  });

  it('publishes multi-architecture runtime images', () => {
    const workflow = readFileSync('.github/workflows/release-publish.yml', 'utf8');
    const releaseProcess = readFileSync('docs/release/RELEASE_PROCESS.md', 'utf8');
    const readme = readFileSync('README.md', 'utf8');

    expect(workflow).toContain('--platform linux/amd64,linux/arm64');
    expect(workflow).not.toContain('--platform linux/amd64 \\');
    expect(releaseProcess).toContain('linux/amd64` and `linux/arm64');
    expect(readme).toContain('Published runtime images support');
    expect(readme).toContain('`linux/amd64` and `linux/arm64`');
  });

  it('extracts release notes with a simple changelog heading prefix scan', () => {
    const workflow = readFileSync('.github/workflows/release-publish.yml', 'utf8');

    expect(workflow).toContain('const headingPrefix = `## [${version}]`;');
    expect(workflow).toContain('line.startsWith(headingPrefix)');
    expect(workflow).not.toContain('new RegExp(`^##');
  });

  it('keeps public release config examples aligned with the Postgres runtime', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8');
    const envExample = readFileSync('.env.example', 'utf8');
    const readme = readFileSync('README.md', 'utf8');

    expect(changelog).toContain('## [0.1.0] — 2026-05-09');
    expect(changelog).not.toContain('## [0.1.0] — TBD');
    expect(envExample).toContain('OPENLANDER_POSTGRES_PASSWORD');
    expect(envExample).toContain('OPENLANDER_DATABASE_URL');
    expect(envExample).not.toContain('OPENLANDER_DB_PATH');
    expect(envExample).not.toContain('SQLite database file path');
    expect(readme).toContain(
      'curl -fsSLO https://raw.githubusercontent.com/openlander-ai/openlander/v0.1.0/docker-compose.runtime.yml',
    );
    expect(readme).toContain('OPENLANDER_IMAGE=ghcr.io/openlander-ai/openlander:0.1.0');
    expect(readme).toContain('source checkout or local build is required');
  });
});
