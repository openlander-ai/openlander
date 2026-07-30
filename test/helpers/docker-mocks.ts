import { vi } from 'vitest';
import { PassThrough } from 'node:stream';
import type { Docker } from '../../src/pipeline/docker.js';

// ---------------------------------------------------------------------------
// Shared Docker mock factories (used by traefik.test.ts, preflight.test.ts)
// ---------------------------------------------------------------------------

export type MockContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: Array<{ PublicPort?: number }>;
  labels: Record<string, string>;
  managedByOpenLander: boolean;
  composeProject: string | null;
  created: number;
};

export type MockExecPlan = {
  stdout?: string;
  stderr?: string;
  exitCode?: number;
};

type MockDockerContainerControl = {
  id: string;
  inspect: () => Promise<{ Id: string; State: { Running: boolean } }>;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  remove: () => Promise<void>;
  exec: (opts?: { Cmd?: string[] }) => Promise<{
    start: () => Promise<NodeJS.ReadableStream>;
    inspect: () => Promise<{ ExitCode: number }>;
  }>;
};

export type MockDockerHarness = {
  docker: Docker;
  client: {
    listContainers: ReturnType<typeof vi.fn>;
    getNetwork: ReturnType<typeof vi.fn>;
    createVolume: ReturnType<typeof vi.fn>;
    createContainer: ReturnType<typeof vi.fn>;
    getContainer: ReturnType<typeof vi.fn>;
    modem: { demuxStream: ReturnType<typeof vi.fn> };
  };
  createdVolumes: Array<Record<string, unknown>>;
  createdContainers: Array<Record<string, unknown>>;
  setContainerRunning: (containerId: string, running: boolean) => void;
  queueExecResult: (containerId: string, result: MockExecPlan) => void;
  getExecCommands: (containerId: string) => string[][];
};

export function createMockContainer(
  name: string,
  options: {
    image?: string;
    state?: string;
    ports?: Array<{ PublicPort?: number }>;
    labels?: Record<string, string>;
  } = {},
): MockContainer {
  return {
    id: `container-${name}`,
    name,
    image: options.image ?? 'test-image:latest',
    state: options.state ?? 'running',
    status: 'Up 2 hours',
    ports: options.ports ?? [],
    labels: options.labels ?? {},
    managedByOpenLander: options.labels?.['openlander.managed'] === 'true',
    composeProject: null,
    created: Date.now(),
  };
}

export function createMockDocker(containers: MockContainer[] = []): Docker {
  return createMockDockerHarness(containers).docker;
}

export function createMockDockerHarness(containers: MockContainer[] = []): MockDockerHarness {
  const createdVolumes: Array<Record<string, unknown>> = [];
  const createdContainers: Array<Record<string, unknown>> = [];
  const runningContainers = new Map<string, boolean>();
  const execPlans = new Map<string, MockExecPlan[]>();
  const execCommands = new Map<string, string[][]>();
  const controls = new Map<string, MockDockerContainerControl>();

  const queueExecResult = (containerId: string, result: MockExecPlan) => {
    const queue = execPlans.get(containerId) ?? [];
    queue.push(result);
    execPlans.set(containerId, queue);
  };

  const setContainerRunning = (containerId: string, running: boolean) => {
    runningContainers.set(containerId, running);
  };

  const getExecCommands = (containerId: string): string[][] => {
    return execCommands.get(containerId) ?? [];
  };

  const getNextExecPlan = (containerId: string): Required<MockExecPlan> => {
    const queue = execPlans.get(containerId) ?? [];
    const next = queue.shift();
    execPlans.set(containerId, queue);
    return {
      stdout: next?.stdout ?? '',
      stderr: next?.stderr ?? '',
      exitCode: next?.exitCode ?? 0,
    };
  };

  const createExecStream = (plan: Required<MockExecPlan>): PassThrough => {
    const stream = new PassThrough() as PassThrough & {
      __stdout?: string;
      __stderr?: string;
    };
    stream.__stdout = plan.stdout;
    stream.__stderr = plan.stderr;
    setTimeout(() => {
      stream.emit('end');
    }, 0);
    return stream;
  };

  const getContainerControl = (containerId: string): MockDockerContainerControl => {
    const existing = controls.get(containerId);
    if (existing) {
      return existing;
    }

    const control: MockDockerContainerControl = {
      id: containerId,
      inspect: vi.fn(async () => ({
        Id: containerId,
        State: {
          Running: runningContainers.get(containerId) ?? true,
        },
      })),
      start: vi.fn(async () => {
        runningContainers.set(containerId, true);
      }),
      stop: vi.fn(async () => {
        runningContainers.set(containerId, false);
      }),
      remove: vi.fn(async () => undefined),
      exec: vi.fn(async (opts?: { Cmd?: string[] }) => {
        const commands = execCommands.get(containerId) ?? [];
        commands.push(opts?.Cmd ?? []);
        execCommands.set(containerId, commands);
        const plan = getNextExecPlan(containerId);
        return {
          start: vi.fn(async () => createExecStream(plan)),
          inspect: vi.fn(async () => ({ ExitCode: plan.exitCode })),
        };
      }),
    };

    controls.set(containerId, control);
    return control;
  };

  const client = {
    listContainers: vi.fn().mockResolvedValue([]),
    getNetwork: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(undefined),
    }),
    createVolume: vi.fn(async (opts: Record<string, unknown>) => {
      createdVolumes.push(opts);
      return { name: opts['Name'] };
    }),
    getVolume: vi.fn((volumeName: string) => ({
      remove: vi.fn().mockResolvedValue(undefined),
    })),
    createContainer: vi.fn(async (opts: Record<string, unknown>) => {
      createdContainers.push(opts);
      const name =
        typeof opts['name'] === 'string' ? opts['name'] : `container-${createdContainers.length}`;
      const id = `${name}-id`;
      runningContainers.set(id, false);
      return {
        id,
        start: vi.fn(async () => {
          runningContainers.set(id, true);
        }),
        exec: getContainerControl(id).exec,
        inspect: getContainerControl(id).inspect,
      };
    }),
    getContainer: vi.fn((containerId: string) => getContainerControl(containerId)),
    modem: {
      demuxStream: vi.fn(
        (stream: NodeJS.ReadableStream, stdout: PassThrough, stderr: PassThrough) => {
          const source = stream as NodeJS.ReadableStream & { __stdout?: string; __stderr?: string };
          if (source.__stdout) {
            stdout.write(Buffer.from(source.__stdout));
          }
          if (source.__stderr) {
            stderr.write(Buffer.from(source.__stderr));
          }
          stdout.end();
          stderr.end();
        },
      ),
    },
  };

  return {
    docker: {
      listAllContainers: vi.fn().mockResolvedValue(containers),
      removeContainer: vi.fn().mockResolvedValue(undefined),
      safeRemoveContainer: vi.fn().mockResolvedValue(undefined),
      startContainer: vi.fn(async (containerId: string) => {
        await getContainerControl(containerId).start();
      }),
      stopContainer: vi.fn(async (containerId: string) => {
        await getContainerControl(containerId).stop();
      }),
      inspectContainer: vi.fn(async (containerId: string) => {
        return getContainerControl(containerId).inspect();
      }),
      createVolume: vi.fn(async (opts: { name: string; labels?: Record<string, string> }) => {
        createdVolumes.push({ Name: opts.name, Labels: opts.labels ?? {} });
      }),
      removeVolume: vi.fn().mockResolvedValue(undefined),
      seedVolumeFromDirectory: vi.fn().mockResolvedValue(undefined),
      runServiceContainer: vi.fn(async (opts: Record<string, unknown>) => {
        createdContainers.push(opts);
        const name =
          typeof opts['name'] === 'string' ? opts['name'] : `svc-${createdContainers.length}`;
        const id = `${name}-id`;
        runningContainers.set(id, true);
        return id;
      }),
      runInfraContainer: vi.fn(async (opts: Record<string, unknown>) => {
        createdContainers.push(opts);
        const id = `infra-${createdContainers.length}-id`;
        runningContainers.set(id, true);
        return id;
      }),
      waitForContainer: vi.fn().mockResolvedValue({ StatusCode: 0 }),
      connectContainerToNetwork: vi.fn().mockResolvedValue(undefined),
      pullImage: vi.fn().mockResolvedValue(undefined),
      inspectImage: vi.fn(async (image: string) => {
        if (!image.startsWith('postgres:')) {
          return { Config: { ExposedPorts: {} } };
        }
        const isPg18 = /^postgres:18(?:-|$)/.test(image);
        return {
          Config: {
            ExposedPorts: {},
            Env: [
              isPg18 ? 'PGDATA=/var/lib/postgresql/18/docker' : 'PGDATA=/var/lib/postgresql/data',
            ],
            Volumes: {
              [isPg18 ? '/var/lib/postgresql' : '/var/lib/postgresql/data']: {},
            },
          },
        };
      }),
      removeImage: vi.fn().mockResolvedValue(undefined),
      listVolumes: vi.fn().mockResolvedValue([]),
      inspectVolume: vi.fn(),
      getDiskUsage: vi.fn().mockResolvedValue({ Images: [], Containers: [], Volumes: [] }),
      renameContainer: vi.fn().mockResolvedValue(undefined),
      getContainerStats: vi.fn().mockResolvedValue({}),
      getNetworkName: vi.fn().mockReturnValue('openlander-prod'),
      execSimple: vi.fn(async (containerId: string, cmd: string[]) => {
        const cmds = execCommands.get(containerId) ?? [];
        cmds.push(cmd);
        execCommands.set(containerId, cmds);
        return getNextExecPlan(containerId);
      }),
    } as unknown as Docker,
    client,
    createdVolumes,
    createdContainers,
    setContainerRunning,
    queueExecResult,
    getExecCommands,
  };
}

export function createMockDockerWithError(): Docker {
  return {
    listAllContainers: vi.fn().mockRejectedValue(new Error('Docker daemon not running')),
  } as unknown as Docker;
}
