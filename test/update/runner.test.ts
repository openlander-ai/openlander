import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Docker } from '../../src/pipeline/docker.js';
import { sha256Hex } from '../../src/update/release-checker.js';
import { replaceOpenLanderImage, runPlatformUpdate } from '../../src/update/runner.js';
import { PlatformUpdateStateStore } from '../../src/update/state-store.js';
import type { PlatformUpdateOperation, PlatformUpdateRunnerInput } from '../../src/update/types.js';

const tempDirectories: string[] = [];
const targetDigest = `sha256:${'c'.repeat(64)}`;
const targetCompose = 'services:\n  openlander:\n    image: ${OPENLANDER_IMAGE}\n';
const runnerEnvironment = {
  OPENLANDER_POSTGRES_PASSWORD: 'preserved-password',
  OPENLANDER_PORT: '10114',
  OPENLANDER_PUBLIC_HOST: 'openlander.example.com',
  OPENLANDER_DATA_VOLUME: 'openlander-data',
};

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function fixture(options: { environmentExists?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'openlander-update-runner-'));
  tempDirectories.push(root);
  const dataDir = join(root, 'data');
  const workingDirectory = join(root, 'compose');
  const composePath = join(workingDirectory, 'docker-compose.runtime.yml');
  const environmentPath = join(workingDirectory, '.env');
  await mkdir(workingDirectory, { recursive: true });
  await writeFile(composePath, 'services:\n  openlander:\n    image: old\n');
  if (options.environmentExists !== false) {
    await writeFile(environmentPath, 'OPENLANDER_PORT=9999\nCUSTOM_VALUE=kept\n');
  }
  const store = new PlatformUpdateStateStore(dataDir);
  const input: PlatformUpdateRunnerInput = {
    operationId: 'update-test',
    sourceVersion: '0.2.13-rc.7',
    targetVersion: '0.2.14-rc.1',
    targetImage: 'ghcr.io/openlander-ai/openlander:0.2.14-rc.1',
    targetDigest,
    targetComposeSha256: sha256Hex(targetCompose),
    sourceImage: 'ghcr.io/openlander-ai/openlander:0.2.13-rc.7',
    runnerImageId: `sha256:${'1'.repeat(64)}`,
    composeProject: 'openlander',
    composeService: 'openlander',
    workingDirectory,
    composeFiles: [composePath],
    dataVolumeName: 'openlander-data',
    databaseContainerId: '2'.repeat(64),
    networkNames: ['openlander_default'],
  };
  const operation: PlatformUpdateOperation = {
    id: input.operationId,
    sourceVersion: input.sourceVersion,
    targetVersion: input.targetVersion,
    phase: 'preparing',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    message: null,
    errorCode: null,
    runnerContainerId: 'runner-id',
  };
  await store.writeRunnerInput(input);
  await store.writeOperation(operation);
  return { dataDir, workingDirectory, composePath, environmentPath, store, input };
}

function imageInspect(): Awaited<ReturnType<Docker['inspectImage']>> {
  return {
    RepoDigests: [`ghcr.io/openlander-ai/openlander@${targetDigest}`],
  } as Awaited<ReturnType<Docker['inspectImage']>>;
}

describe('platform update runner', () => {
  it('backs up, preserves unrelated settings, restarts only OpenLander, and completes', async () => {
    const context = await fixture();
    await chmod(context.environmentPath, 0o640);
    await chmod(context.composePath, 0o664);
    for (let index = 1; index <= 3; index += 1) {
      const oldBackup = join(context.store.updateRoot, `old-update-${String(index)}`, 'backup');
      await mkdir(oldBackup, { recursive: true });
      await utimes(oldBackup, new Date(index * 1_000), new Date(index * 1_000));
    }
    const observedPhases: string[] = [];
    const docker = {
      execToFile: vi.fn(async (_containerId: string, _command: string[], outputPath: string) => {
        observedPhases.push((await context.store.readOperation())?.phase ?? 'missing');
        await writeFile(outputPath, 'custom-format-dump');
      }),
      pullImage: vi.fn(async () => {
        observedPhases.push((await context.store.readOperation())?.phase ?? 'missing');
      }),
      inspectImage: vi.fn(async () => imageInspect()),
    };
    const commands: string[][] = [];
    const commandRunner = vi.fn(async (_command: string, args: string[]) => {
      commands.push(args);
      observedPhases.push((await context.store.readOperation())?.phase ?? 'missing');
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('raw.githubusercontent.com')) return new Response(targetCompose);
      await context.store.writeStartupValidation(context.input.operationId, {
        version: context.input.targetVersion,
        ok: true,
        checkedAt: new Date().toISOString(),
        message: 'ok',
      });
      return Response.json({ status: 'ok', version: context.input.targetVersion });
    });

    await runPlatformUpdate(context.input.operationId, context.dataDir, {
      docker,
      commandRunner,
      fetchImpl,
      healthTimeoutMs: 500,
      environment: runnerEnvironment,
    });

    await expect(context.store.readOperation()).resolves.toMatchObject({ phase: 'completed' });
    expect(await readFile(context.environmentPath, 'utf8')).toBe(
      `OPENLANDER_PORT=10114\nCUSTOM_VALUE=kept\nOPENLANDER_IMAGE=${context.input.targetImage}@${targetDigest}\nOPENLANDER_POSTGRES_PASSWORD=preserved-password\nOPENLANDER_PUBLIC_HOST=openlander.example.com\nOPENLANDER_DATA_VOLUME=openlander-data\n`,
    );
    expect(await readFile(context.composePath, 'utf8')).toBe(targetCompose);
    expect((await stat(context.environmentPath)).mode & 0o777).toBe(0o640);
    expect((await stat(context.composePath)).mode & 0o777).toBe(0o664);
    expect(observedPhases).toContain('backing_up');
    expect(observedPhases).toContain('pulling');
    expect(observedPhases).toContain('restarting');
    const upCommand = commands.find((args) => args.includes('up'));
    expect(upCommand).toEqual(
      expect.arrayContaining(['up', '-d', '--no-deps', '--force-recreate', 'openlander']),
    );
    const retainedBackups = (
      await readdir(context.store.updateRoot, { withFileTypes: true })
    ).filter((entry) => entry.isDirectory());
    expect(retainedBackups).toHaveLength(3);
  });

  it('restores the original Compose and env files when verification fails', async () => {
    const context = await fixture();
    const originalCompose = await readFile(context.composePath, 'utf8');
    let upCount = 0;
    const docker = {
      execToFile: vi.fn(async (_containerId: string, _command: string[], outputPath: string) => {
        await writeFile(outputPath, 'custom-format-dump');
      }),
      pullImage: vi.fn(async () => undefined),
      inspectImage: vi.fn(async () => imageInspect()),
    };
    const commandRunner = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes('up')) upCount += 1;
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.includes('raw.githubusercontent.com')) return new Response(targetCompose);
      if (upCount === 1) {
        await context.store.writeStartupValidation(context.input.operationId, {
          version: context.input.targetVersion,
          ok: false,
          checkedAt: new Date().toISOString(),
          message: 'traefik failed',
        });
        return Response.json({ status: 'ok', version: context.input.targetVersion });
      }
      await context.store.writeStartupValidation(context.input.operationId, {
        version: context.input.sourceVersion,
        ok: true,
        checkedAt: new Date().toISOString(),
        message: 'rollback ok',
      });
      return Response.json({ status: 'ok', version: context.input.sourceVersion });
    });

    await runPlatformUpdate(context.input.operationId, context.dataDir, {
      docker,
      commandRunner,
      fetchImpl,
      healthTimeoutMs: 500,
      environment: runnerEnvironment,
    });

    await expect(context.store.readOperation()).resolves.toMatchObject({
      phase: 'rolled_back',
      errorCode: 'UPDATE_VERIFICATION_FAILED',
    });
    expect(await readFile(context.environmentPath, 'utf8')).toBe(
      `OPENLANDER_PORT=10114\nCUSTOM_VALUE=kept\nOPENLANDER_IMAGE=${context.input.sourceImage}\nOPENLANDER_POSTGRES_PASSWORD=preserved-password\nOPENLANDER_PUBLIC_HOST=openlander.example.com\nOPENLANDER_DATA_VOLUME=openlander-data\n`,
    );
    expect(await readFile(context.composePath, 'utf8')).toBe(originalCompose);
    expect(
      await readFile(
        join(context.store.backupDirectory(context.input.operationId), 'openlander.pgdump'),
        'utf8',
      ),
    ).toBe('custom-format-dump');
    expect(upCount).toBe(2);
  });

  it('records a hard failure only when automatic rollback also fails', async () => {
    const context = await fixture();
    let upCount = 0;
    const docker = {
      execToFile: vi.fn(async (_containerId: string, _command: string[], outputPath: string) => {
        await writeFile(outputPath, 'custom-format-dump');
      }),
      pullImage: vi.fn(async () => undefined),
      inspectImage: vi.fn(async () => imageInspect()),
    };
    const commandRunner = vi.fn(async (_command: string, args: string[]) => {
      if (args.includes('up')) {
        upCount += 1;
        if (upCount === 2) return { exitCode: 1, stdout: '', stderr: 'rollback failed' };
      }
      return { exitCode: 0, stdout: '', stderr: '' };
    });
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('raw.githubusercontent.com')) return new Response(targetCompose);
      await context.store.writeStartupValidation(context.input.operationId, {
        version: context.input.targetVersion,
        ok: false,
        checkedAt: new Date().toISOString(),
        message: 'traefik failed',
      });
      return Response.json({ status: 'ok', version: context.input.targetVersion });
    });

    await runPlatformUpdate(context.input.operationId, context.dataDir, {
      docker,
      commandRunner,
      fetchImpl,
      healthTimeoutMs: 500,
      environment: runnerEnvironment,
    });

    await expect(context.store.readOperation()).resolves.toMatchObject({
      phase: 'failed',
      errorCode: 'UPDATE_ROLLBACK_FAILED',
    });
  });

  it('fails before backup when the isolated runner cannot preserve Compose settings', async () => {
    const context = await fixture();
    const docker = {
      execToFile: vi.fn(async () => undefined),
      pullImage: vi.fn(async () => undefined),
      inspectImage: vi.fn(async () => imageInspect()),
    };

    await runPlatformUpdate(context.input.operationId, context.dataDir, {
      docker,
      environment: {},
    });

    await expect(context.store.readOperation()).resolves.toMatchObject({
      phase: 'failed',
      errorCode: 'UPDATE_VERIFICATION_FAILED',
    });
    expect(docker.execToFile).not.toHaveBeenCalled();
  });

  it('creates a durable Compose environment when the original install had no .env file', async () => {
    const context = await fixture({ environmentExists: false });
    const docker = {
      execToFile: vi.fn(async (_containerId: string, _command: string[], outputPath: string) => {
        await writeFile(outputPath, 'custom-format-dump');
      }),
      pullImage: vi.fn(async () => undefined),
      inspectImage: vi.fn(async () => imageInspect()),
    };
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      if (String(input).includes('raw.githubusercontent.com')) return new Response(targetCompose);
      await context.store.writeStartupValidation(context.input.operationId, {
        version: context.input.targetVersion,
        ok: true,
        checkedAt: new Date().toISOString(),
        message: 'ok',
      });
      return Response.json({ status: 'ok', version: context.input.targetVersion });
    });

    await runPlatformUpdate(context.input.operationId, context.dataDir, {
      docker,
      commandRunner: vi.fn(async () => ({ exitCode: 0, stdout: '', stderr: '' })),
      fetchImpl,
      healthTimeoutMs: 500,
      environment: runnerEnvironment,
    });

    await expect(context.store.readOperation()).resolves.toMatchObject({ phase: 'completed' });
    expect(await readFile(context.environmentPath, 'utf8')).toBe(
      `OPENLANDER_IMAGE=${context.input.targetImage}@${targetDigest}\nOPENLANDER_POSTGRES_PASSWORD=preserved-password\nOPENLANDER_PORT=10114\nOPENLANDER_PUBLIC_HOST=openlander.example.com\nOPENLANDER_DATA_VOLUME=openlander-data\n`,
    );
    expect((await stat(context.environmentPath)).mode & 0o777).toBe(0o600);
  });
});

describe('replaceOpenLanderImage', () => {
  it('changes only the exact OPENLANDER_IMAGE entry', () => {
    expect(
      replaceOpenLanderImage(
        '# OPENLANDER_IMAGE=commented\nOPENLANDER_IMAGE=old\nOPENLANDER_IMAGE_BACKUP=keep\n',
        'new@sha256:123',
      ),
    ).toBe(
      '# OPENLANDER_IMAGE=commented\nOPENLANDER_IMAGE=new@sha256:123\nOPENLANDER_IMAGE_BACKUP=keep\n',
    );
  });

  it('preserves CRLF and trailing blank lines when adding the image entry', () => {
    expect(replaceOpenLanderImage('CUSTOM_VALUE=kept\r\n\r\n', 'new')).toBe(
      'CUSTOM_VALUE=kept\r\n\r\nOPENLANDER_IMAGE=new\r\n',
    );
  });
});
