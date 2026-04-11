import { afterEach, describe, expect, it, vi } from 'vitest';
import { PassThrough } from 'node:stream';

import type { AppContext } from '../src/app.js';
import { createTerminalRoutes } from '../src/web/api/terminal-routes.js';

type ProjectRecord = {
  id: string;
  status: string;
  container_id: string | null;
};

type ExecMock = {
  start: ReturnType<typeof vi.fn>;
  inspect?: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
};

type WsConnection = {
  send: (data: string | Uint8Array) => void;
  close: () => void;
};

type WsHandlers = {
  onOpen: (_evt: unknown, ws: WsConnection) => void;
  onClose: (_evt: unknown, ws: object) => void;
};

function flushAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createProbeExec(exitCode: number, output?: string): ExecMock {
  return {
    start: vi.fn().mockImplementation(async () => {
      const stream = new PassThrough();
      queueMicrotask(() => {
        if (output) stream.write(output);
        stream.end();
      });
      return stream;
    }),
    inspect: vi.fn().mockResolvedValue({ ExitCode: exitCode }),
    resize: vi.fn(),
  };
}

function createInteractiveExec() {
  const stream = new PassThrough();
  return {
    exec: {
      start: vi.fn().mockResolvedValue(stream),
      resize: vi.fn(),
    },
    stream,
  };
}

function createTestHarness(execFactory: (cmd: string[]) => ExecMock) {
  const project: ProjectRecord = {
    id: 'p1',
    status: 'running',
    container_id: 'container-1',
  };
  const execCalls: string[][] = [];
  const container = {
    inspect: vi.fn().mockResolvedValue({ State: { Running: true } }),
    exec: vi.fn().mockImplementation(async (opts: { Cmd: string[] }) => {
      execCalls.push(opts.Cmd);
      return execFactory(opts.Cmd);
    }),
  };
  const ctx = {
    config: { server: { host: 'localhost' } },
    db: {
      getProject: vi.fn((id: string) => (id === project.id ? project : null)),
      getProjectByName: vi.fn().mockReturnValue(null),
      isPasswordSet: vi.fn().mockReturnValue(false),
      getAuth: vi.fn().mockReturnValue(null),
      setPassword: vi.fn(),
      getApiToken: vi.fn().mockReturnValue(null),
      setApiToken: vi.fn(),
      getSession: vi.fn().mockReturnValue(null),
      createSession: vi.fn(),
      deleteSession: vi.fn(),
    },
    docker: {
      inspectContainer: vi.fn().mockResolvedValue({ State: { Running: true } }),
      getClient: vi.fn(() => ({
        getContainer: vi.fn(() => container),
      })),
    },
  } as unknown as AppContext;

  let handlers: WsHandlers | null = null;

  const upgradeWebSocket = vi.fn((factory: (c: unknown) => WsHandlers) => {
    handlers = factory({
      req: {
        param: () => project.id,
        header: (name: string) => {
          if (name === 'host') return 'localhost:10114';
          if (name === 'origin') return 'http://localhost:10114';
          return undefined;
        },
      },
    });
    return () => new Response(null);
  });

  createTerminalRoutes(ctx, upgradeWebSocket as never);

  if (!handlers) {
    throw new Error('WebSocket handlers were not registered');
  }

  const activeHandlers: WsHandlers = handlers;

  const ws = {
    send: vi.fn(),
    close: vi.fn(),
  };

  return { container, execCalls, handlers: activeHandlers, ws };
}

describe('createTerminalRoutes shell fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses /bin/bash when bash probe succeeds', async () => {
    const interactive = createInteractiveExec();
    const harness = createTestHarness((cmd) => {
      if (cmd[0] === '/bin/bash' && cmd[1] === '-c') {
        return createProbeExec(0);
      }
      if (cmd[0] === '/bin/bash') {
        return interactive.exec;
      }
      throw new Error(`Unexpected command: ${cmd.join(' ')}`);
    });

    harness.handlers.onOpen({}, harness.ws);
    await flushAsyncWork();

    expect(harness.execCalls).toEqual([['/bin/bash', '-c', 'exit 0'], ['/bin/bash']]);
    expect(harness.ws.send).not.toHaveBeenCalledWith(expect.stringContaining('No shell available'));

    harness.handlers.onClose({}, harness.ws);
    interactive.stream.destroy();
  });

  it('falls back to /bin/sh when bash probe fails', async () => {
    const interactive = createInteractiveExec();
    const harness = createTestHarness((cmd) => {
      if (cmd[0] === '/bin/bash' && cmd[1] === '-c') {
        return createProbeExec(127, '/bin/bash: no such file or directory');
      }
      if (cmd[0] === '/bin/sh' && cmd[1] === '-c') {
        return createProbeExec(0);
      }
      if (cmd[0] === '/bin/sh') {
        return interactive.exec;
      }
      throw new Error(`Unexpected command: ${cmd.join(' ')}`);
    });

    harness.handlers.onOpen({}, harness.ws);
    await flushAsyncWork();

    expect(harness.execCalls).toEqual([
      ['/bin/bash', '-c', 'exit 0'],
      ['/bin/sh', '-c', 'exit 0'],
      ['/bin/sh'],
    ]);
    expect(harness.ws.send).not.toHaveBeenCalledWith(
      expect.stringContaining('/bin/bash: no such file or directory'),
    );

    harness.handlers.onClose({}, harness.ws);
    interactive.stream.destroy();
  });

  it('sends a clean error when no shell is available', async () => {
    const harness = createTestHarness((cmd) => {
      if (cmd[1] === '-c') {
        return createProbeExec(127, `${cmd[0]}: not found`);
      }
      throw new Error(`Unexpected interactive command: ${cmd.join(' ')}`);
    });

    harness.handlers.onOpen({}, harness.ws);
    await flushAsyncWork();

    expect(harness.execCalls).toEqual([
      ['/bin/bash', '-c', 'exit 0'],
      ['/bin/sh', '-c', 'exit 0'],
    ]);
    expect(harness.ws.send).toHaveBeenCalledWith(
      JSON.stringify({
        type: 'error',
        message:
          'No shell available (/bin/bash and /bin/sh not found). This container may be a distroless image.',
      }),
    );
    expect(harness.ws.close).toHaveBeenCalled();
  });
});
