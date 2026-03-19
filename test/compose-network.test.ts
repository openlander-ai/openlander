import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { ChildProcess } from 'node:child_process';

import { ComposePipeline } from '../src/pipeline/compose.js';
import { Database } from '../src/db/index.js';
import { EventBus } from '../src/events/index.js';
import type { Docker } from '../src/pipeline/docker.js';

const connectToTraefikNetworkMock = vi.fn();

vi.mock('../src/pipeline/traefik.js', () => ({
  connectToTraefikNetwork: (...args: unknown[]) => connectToTraefikNetworkMock(...args),
}));

const isBunRuntime = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

interface MockChildProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
}

function createMockProcess(stdout: string, stderr: string, exitCode: number): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  proc.stdout = Readable.from([Buffer.from(stdout)]);
  proc.stderr = Readable.from([Buffer.from(stderr)]);
  setImmediate(() => {
    proc.emit('close', exitCode);
  });
  return proc;
}

let mockSpawnImplementation: (cmd: string, args: string[]) => ChildProcess = () => {
  throw new Error('spawn mock not set up');
};

if (!isBunRuntime) {
  vi.mock(import('node:child_process'), () => {
    const mockedSpawn = ((
      command: string,
      argsOrOptions?: readonly string[] | import('node:child_process').SpawnOptions,
    ) => {
      const args = Array.isArray(argsOrOptions) ? [...argsOrOptions] : [];
      if (args.includes('version') && args.includes('--short')) {
        return createMockProcess('2.24.0\n', '', 0);
      }
      return mockSpawnImplementation(command, args);
    }) as unknown as typeof import('node:child_process').spawn;

    const mockedExec = (() => undefined) as unknown as typeof import('node:child_process').exec;

    return {
      spawn: mockedSpawn,
      exec: mockedExec,
    };
  });
}

const describeComposeNetwork = isBunRuntime ? describe.skip : describe;

describeComposeNetwork('ComposePipeline web network connection', () => {
  let tmpDir: string;
  let db: Database;
  let events: EventBus;
  let docker: Docker;
  let pipeline: ComposePipeline;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-compose-network-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    events = new EventBus();
    docker = {
      getClient: vi.fn().mockReturnValue({
        getNetwork: vi.fn().mockReturnValue({ connect: vi.fn().mockResolvedValue(undefined) }),
      }),
    } as unknown as Docker;
    pipeline = new ComposePipeline(docker, db, events);
    connectToTraefikNetworkMock.mockReset();
    connectToTraefikNetworkMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockSpawnImplementation = () => {
      throw new Error('spawn mock not set up');
    };
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function setupSuccessfulComposeMocks(containerId = 'api-container'): void {
    mockSpawnImplementation = (_cmd: string, args: string[]) => {
      const argText = args.join(' ');
      if (argText.includes(' up ') && argText.includes(' api')) {
        return createMockProcess('api up\n', '', 0) as unknown as ChildProcess;
      }
      if (argText.includes(' ps ')) {
        return createMockProcess(
          JSON.stringify([
            {
              Service: 'api',
              State: 'running',
              ID: containerId,
              Publishers: [{ PublishedPort: 3000, TargetPort: 3000 }],
            },
          ]),
          '',
          0,
        ) as unknown as ChildProcess;
      }
      return createMockProcess('', `unexpected command: ${argText}`, 1) as unknown as ChildProcess;
    };
  }

  it('connects compose containers to web network after deploy', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(composePath, 'services:\n  api:\n    image: nginx\n', 'utf8');
    setupSuccessfulComposeMocks('api-container-1');

    const result = await pipeline.deployCompose({
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(connectToTraefikNetworkMock).toHaveBeenCalledWith(docker, 'api-container-1', 'web');
  });

  it('does not crash if web network connection fails', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(composePath, 'services:\n  api:\n    image: nginx\n', 'utf8');
    setupSuccessfulComposeMocks('api-container-2');
    connectToTraefikNetworkMock.mockRejectedValueOnce(new Error('network not found'));

    const result = await pipeline.deployCompose({
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(connectToTraefikNetworkMock).toHaveBeenCalledWith(docker, 'api-container-2', 'web');
  });
});
