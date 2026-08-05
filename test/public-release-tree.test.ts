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

  it('computes stable and prerelease Docker tags without shell-interpreted backticks', () => {
    const workflow = readFileSync('.github/workflows/release-publish.yml', 'utf8');
    const packageJson = readFileSync('package.json', 'utf8');
    const releaseProcess = readFileSync('docs/release/RELEASE_PROCESS.md', 'utf8');
    const agentInstructions = readFileSync('AGENTS.md', 'utf8');
    const pkg = JSON.parse(packageJson) as { scripts: Record<string, string> };
    const rawRelease = spawnSync('npm', ['run', 'release', '--silent'], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });

    expect(workflow).toContain('major_minor="$major.$minor"');
    expect(workflow).toContain('prerelease_channel="${prerelease%%.*}"');
    expect(workflow).not.toContain('console.log(`${major}.${minor}`)');
    expect(workflow).toContain('--tag "${IMAGE_NAME}:${{ steps.version.outputs.major_minor }}"');
    expect(workflow).toContain(
      '--tag "${IMAGE_NAME}:${{ steps.version.outputs.prerelease_channel }}"',
    );
    expect(workflow).toContain('echo "Tag $GITHUB_REF_NAME is not a SemVer release tag"');
    expect(pkg.scripts['release:rc']).toBe('release-it --preRelease=rc');
    expect(pkg.scripts['release:final']).toBe('release-it');
    expect(pkg.scripts.release).not.toContain('release-it');
    expect(pkg.scripts.release).toContain('process.exit(1)');
    expect(rawRelease.status).not.toBe(0);
    expect(`${rawRelease.stdout}${rawRelease.stderr}`).toMatch(/release:rc|release:final/);
    expect(releaseProcess).toContain('npm run release:rc');
    expect(releaseProcess).toContain('npm run release:final');
    expect(releaseProcess).not.toContain('`npm run release` uses release-it');
    expect(releaseProcess).toMatch(/raw `release` script intentionally exits/i);
    expect(releaseProcess).toMatch(/git diff .*rc\.N\.\.HEAD/);
    expect(releaseProcess).toContain('No dependency graph changes are allowed');
    expect(releaseProcess).toContain('If any smoke item fails');
    expect(releaseProcess).toContain('Inspect the pack output');
    expect(agentInstructions).toContain('npm run release:final` or `npm run release:rc');
    expect(agentInstructions).not.toContain('Automated by `npm run release`');
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
    const compose = readFileSync('docker-compose.runtime.yml', 'utf8');
    const envExample = readFileSync('.env.example', 'utf8');
    const readme = readFileSync('README.md', 'utf8');
    const installScript = readFileSync('install.sh', 'utf8');
    const controlCli = readFileSync('openlanderctl', 'utf8');
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      files: string[];
    };

    expect(changelog).toContain('## [0.1.0] — 2026-05-09');
    expect(changelog).not.toContain('## [0.1.0] — TBD');
    expect(envExample).toContain('OPENLANDER_POSTGRES_PASSWORD');
    expect(envExample).toContain('OPENLANDER_DATABASE_URL');
    expect(envExample).not.toContain('OPENLANDER_DB_PATH');
    expect(envExample).not.toContain('SQLite database file path');
    expect(compose).toContain('OPENLANDER_POSTGRES_PASSWORD:-openlander');
    expect(compose).toContain('OPENLANDER_IMAGE:-ghcr.io/openlander-ai/openlander:latest');
    expect(compose).toContain('${OPENLANDER_PORT:-10114}:10114');
    expect(compose).toContain('OPENLANDER_PUBLIC_HOST: ${OPENLANDER_PUBLIC_HOST:-}');
    expect(readme).toContain(
      'https://raw.githubusercontent.com/openlander-ai/openlander/main/install.sh',
    );
    expect(readme).toContain('sudo bash -s update');
    expect(readme).toContain('Want to inspect it first?');
    expect(readme).not.toContain('OPENLANDER_POSTGRES_PASSWORD=change-me');
    expect(readme).not.toContain("cat > .env <<'EOF'");
    expect(readme).toContain('ghcr.io/openlander-ai/openlander:latest');
    expect(readme).toContain('Update later with:');
    expect(readme).not.toContain('set `OPENLANDER_IMAGE=ghcr.io/openlander-ai/openlander:0.1.0`');
    expect(readme).toContain('published');
    expect(installScript).toContain('OPENLANDER_POSTGRES_PASSWORD=');
    expect(installScript).toContain('OPENLANDER_PORT=${OPENLANDER_PORT}');
    expect(installScript).toContain('OPENLANDER_PUBLIC_HOST=${public_host}');
    expect(installScript).toContain('COMPOSE_PROJECT_NAME=openlander');
    expect(installScript).toContain('docker compose -f docker-compose.runtime.yml up -d');
    expect(installScript).toContain('up -d --no-deps openlander');
    expect(installScript).toContain(
      'https://api.github.com/repos/${OPENLANDER_REPO}/releases/latest',
    );
    expect(installScript).not.toContain("printf 'main'");
    expect(installScript).toContain('.bak.$(date +%Y%m%d%H%M%S)');
    expect(installScript).toContain('OPENLANDER_VERSION must be');
    expect(installScript).toContain('/usr/local/bin/openlanderctl');
    expect(installScript).toContain('/openlanderctl');
    expect(controlCli).toContain('admin reset-password');
    expect(controlCli).toContain('node dist/cli/index.js admin reset-password');
    expect(packageJson.files).toContain('openlanderctl');
  });

  it('keeps first-run setup browser-only with no setup secret ceremony', () => {
    const readme = readFileSync('README.md', 'utf8');
    const serverSource = readFileSync('src/web/server.ts', 'utf8');
    const authRoutes = readFileSync('src/web/api/auth-routes.ts', 'utf8');

    expect(readme).not.toMatch(/setup secret/i);
    expect(readme).not.toContain('docker compose -f docker-compose.runtime.yml logs openlander');
    expect(serverSource).not.toContain('ONE-TIME SETUP SECRET');
    expect(authRoutes).not.toContain('INVALID_SETUP_SECRET');
  });

  it('serves public brand assets before the SPA fallback', () => {
    const serverSource = readFileSync('src/web/server.ts', 'utf8');
    const indexHtml = readFileSync('web/index.html', 'utf8');
    const brandSource = readFileSync('web/src/lib/brand.ts', 'utf8');

    expect(indexHtml).toContain('/brand/openlander-mark-64.png');
    expect(brandSource).toContain("markUrl: '/brand/openlander-mark.png'");
    expect(serverSource).toContain("app.get('/brand/*'");
    expect(serverSource.indexOf("app.get('/brand/*'")).toBeLessThan(
      serverSource.indexOf("app.get('*'"),
    );
    expect(serverSource).toContain("'Content-Type': contentType");
  });
});
