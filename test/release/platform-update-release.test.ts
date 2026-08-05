import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('platform update release artifacts', () => {
  it('creates a valid manifest from the exact Compose file and image digest', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openlander-update-manifest-'));
    tempDirectories.push(root);
    const policyPath = join(root, 'policy.json');
    const composePath = join(root, 'docker-compose.runtime.yml');
    const outputPath = join(root, 'openlander-update.json');
    await writeFile(
      policyPath,
      JSON.stringify({ minimum_source_version: '0.2.14-rc.1', rollback_safe: true }),
    );
    await writeFile(composePath, 'services:\n  openlander:\n    image: test\n');
    await execFileAsync('node', [
      'scripts/create-update-manifest.mjs',
      '--version',
      '0.2.14-rc.1',
      '--image-digest',
      `sha256:${'f'.repeat(64)}`,
      '--compose',
      composePath,
      '--policy',
      policyPath,
      '--output',
      outputPath,
    ]);
    await execFileAsync('node', ['scripts/create-update-manifest.mjs', '--verify', outputPath]);
    const manifest = JSON.parse(await readFile(outputPath, 'utf8'));
    expect(manifest).toMatchObject({
      schema_version: 1,
      version: '0.2.14-rc.1',
      minimum_source_version: '0.2.14-rc.1',
      image: 'ghcr.io/openlander-ai/openlander:0.2.14-rc.1',
      image_digest: `sha256:${'f'.repeat(64)}`,
      rollback_safe: true,
    });
    expect(manifest.compose_sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('publishes a multi-architecture digest and manifest asset and ships Compose in runtime', async () => {
    const workflow = await readFile('.github/workflows/release-publish.yml', 'utf8');
    const sourceDockerfile = await readFile('Dockerfile', 'utf8');
    const dockerfile = await readFile('Dockerfile.runtime', 'utf8');
    const releaseGate = await readFile('.github/workflows/release-gate.yml', 'utf8');
    expect(workflow).toContain('--platform linux/amd64,linux/arm64');
    expect(workflow).toContain('--metadata-file /tmp/openlander-build-metadata.json');
    expect(workflow).toContain('/tmp/openlander-update.json');
    expect(workflow).toContain('docker buildx imagetools inspect');
    expect(workflow).toContain('scripts/compose-self-update-smoke.sh');
    expect(dockerfile).toContain('/usr/local/libexec/docker/cli-plugins/docker-compose');
    expect(sourceDockerfile).toContain('/usr/local/libexec/docker/cli-plugins/docker-compose');
    expect(releaseGate).toContain('one_click_update');
    expect(releaseGate).toContain('rc-upgrade-state-smoke.mjs update');
  });
});
