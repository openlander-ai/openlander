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

function createMockDocker(): Docker {
  return {} as unknown as Docker;
}

interface MockChildProcess extends EventEmitter {
  stdout: Readable;
  stderr: Readable;
}

function createMockProcess(stdout: string, stderr: string, exitCode: number): MockChildProcess {
  const proc = new EventEmitter() as MockChildProcess;
  // Create Readable streams that emit Buffer chunks (matching real child_process.spawn behavior)
  proc.stdout = Readable.from([Buffer.from(stdout)]);
  proc.stderr = Readable.from([Buffer.from(stderr)]);
  // Emit 'close' event asynchronously
  setImmediate(() => {
    proc.emit('close', exitCode);
  });
  return proc;
}

// Track the mock implementation
let mockSpawnImplementation: (cmd: string, args: string[]) => ChildProcess = () => {
  throw new Error('spawn mock not set up');
};

vi.mock(import('node:child_process'), async (importOriginal) => {
  const actual = await importOriginal();
  const mockedSpawn = ((
    command: string,
    argsOrOptions?: readonly string[] | import('node:child_process').SpawnOptions,
  ) => {
    const args = Array.isArray(argsOrOptions) ? [...argsOrOptions] : [];
    return mockSpawnImplementation(command, args) as unknown as ReturnType<typeof actual.spawn>;
  }) as typeof actual.spawn;
  return {
    ...actual,
    spawn: mockedSpawn,
  };
});
describe('ComposePipeline', () => {
  let tmpDir: string;
  let db: Database;
  let pipeline: ComposePipeline;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-compose-test-'));
    db = new Database(join(tmpDir, 'test.db'));
    pipeline = new ComposePipeline(createMockDocker(), db, new EventBus());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    mockSpawnImplementation = () => {
      throw new Error('spawn mock not set up');
    };
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects compose file using priority order', () => {
    writeFileSync(join(tmpDir, 'compose.yaml'), 'services: {}\n', 'utf8');
    writeFileSync(join(tmpDir, 'docker-compose.yml'), 'services: {}\n', 'utf8');

    const detected = pipeline.detectComposeFile(tmpDir);
    expect(detected).toBe(join(tmpDir, 'docker-compose.yml'));
  });

  it('detectComposeFile checks supported filenames in order', () => {
    writeFileSync(join(tmpDir, 'compose.yml'), 'services: {}\n', 'utf8');
    writeFileSync(join(tmpDir, 'compose.yaml'), 'services: {}\n', 'utf8');

    const detected = pipeline.detectComposeFile(tmpDir);

    expect(detected).toBe(join(tmpDir, 'compose.yml'));
  });

  it('parses compose file with service variants', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx:latest\n    build:\n      context: ./web\n      dockerfile: Dockerfile.prod\n    ports:\n      - "3000:3000"\n    environment:\n      NODE_ENV: production\n      PORT: "3000"\n    depends_on:\n      db:\n        condition: service_started\n    volumes:\n      - ./web:/app\n  db:\n    image: postgres:16\n    environment:\n      - POSTGRES_PASSWORD=secret\n`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    expect(parsed.services).toHaveLength(2);

    const web = parsed.services.find((service) => service.name === 'web');
    expect(web?.build).toEqual({ context: './web', dockerfile: 'Dockerfile.prod' });
    expect(web?.environment).toEqual({ NODE_ENV: 'production', PORT: '3000' });
    expect(web?.dependsOn).toEqual(['db']);

    const dbService = parsed.services.find((service) => service.name === 'db');
    expect(dbService?.environment).toEqual(['POSTGRES_PASSWORD=secret']);
  });

  it('parseComposeFile parses string build, env list/map, and depends_on array', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:
  api:
    build: ./api
    ports:
      - "8080:8080"
    environment:
      - NODE_ENV=production
    depends_on:
      - db
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: app
`,
      'utf8',
    );

    const parsed = pipeline.parseComposeFile(composePath);
    const api = parsed.services.find((service) => service.name === 'api');
    const dbService = parsed.services.find((service) => service.name === 'db');

    expect(api?.build).toBe('./api');
    expect(api?.ports).toEqual(['8080:8080']);
    expect(api?.environment).toEqual(['NODE_ENV=production']);
    expect(api?.dependsOn).toEqual(['db']);
    expect(dbService?.environment).toEqual({ POSTGRES_DB: 'app' });
  });

  it('parseComposeFile handles empty and invalid compose files', () => {
    const composePath = join(tmpDir, 'docker-compose.yml');

    writeFileSync(composePath, '', 'utf8');
    const emptyParsed = pipeline.parseComposeFile(composePath);
    expect(emptyParsed.services).toEqual([]);

    writeFileSync(composePath, 'services: [broken', 'utf8');
    expect(() => pipeline.parseComposeFile(composePath)).toThrow();
  });

  it('detects and deploys compose project using docker compose CLI', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  web:\n    image: nginx\n    ports:\n      - "3000:3000"\n  db:\n    image: postgres\n`,
      'utf8',
    );

    const composeCommands: string[] = [];
    mockSpawnImplementation = (_cmd: string, args: string[]) => {
      const argText = args.join(' ');
      composeCommands.push(argText);
      if (argText.includes(' up ') && argText.includes(' web')) {
        return createMockProcess('compose up ok\n', '', 0) as unknown as ChildProcess;
      }
      if (argText.includes(' up ') && argText.includes(' db')) {
        return createMockProcess('compose up ok\n', '', 0) as unknown as ChildProcess;
      }
      if (argText.includes(' ps ')) {
        return createMockProcess(
          JSON.stringify([
            {
              Service: 'web',
              State: 'running',
              ID: 'web-container',
              Publishers: [{ PublishedPort: 3000, TargetPort: 3000 }],
            },
            {
              Service: 'db',
              State: 'exited',
              ID: 'db-container',
              Publishers: [],
            },
          ]),
          '',
          0,
        ) as unknown as ChildProcess;
      }
      return createMockProcess('', 'unexpected command', 1) as unknown as ChildProcess;
    };

    const detectedComposePath = pipeline.detectComposeFile(tmpDir);
    expect(detectedComposePath).toBe(composePath);

    const result = await pipeline.deployCompose({
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath: detectedComposePath ?? composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(true);
    expect(result.services).toHaveLength(2);
    expect(result.services).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'web', status: 'running' }),
        expect.objectContaining({ name: 'db', status: 'stopped' }),
      ]),
    );

    const parent = db.getProject(result.parentProjectId);
    expect(parent?.status).toBe('running');

    const children = db.getChildProjects(result.parentProjectId);
    expect(children).toHaveLength(2);
    expect(children.map((child) => child.status).sort()).toEqual(['running', 'stopped']);
    expect(composeCommands.filter((cmd) => cmd.includes(' up '))).toHaveLength(2);
    expect(
      composeCommands.every((cmd) => {
        if (!cmd.includes(' up ')) {
          return true;
        }
        return cmd.includes('--no-deps');
      }),
    ).toBe(true);
  });

  it('rolls back previously started compose services when a dependency-ordered service fails', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  db:\n    image: postgres\n  api:\n    image: nginx\n    depends_on:\n      - db\n`,
      'utf8',
    );

    const composeCommands: string[] = [];
    let psCallCount = 0;
    mockSpawnImplementation = (_cmd: string, args: string[]) => {
      const argText = args.join(' ');
      composeCommands.push(argText);

      if (argText.includes(' up ') && argText.includes(' db')) {
        return createMockProcess('db started\n', '', 0) as unknown as ChildProcess;
      }

      if (argText.includes(' up ') && argText.includes(' api')) {
        return createMockProcess('', 'api failed to start', 1) as unknown as ChildProcess;
      }

      if (argText.includes(' ps ')) {
        psCallCount += 1;
        if (psCallCount === 1) {
          return createMockProcess(
            JSON.stringify([
              {
                Service: 'db',
                State: 'running',
                ID: 'db-container',
                Publishers: [],
              },
            ]),
            '',
            0,
          ) as unknown as ChildProcess;
        }
        return createMockProcess('[]', '', 0) as unknown as ChildProcess;
      }

      if (argText.includes(' stop db')) {
        return createMockProcess('db stopped\n', '', 0) as unknown as ChildProcess;
      }

      if (argText.includes(' rm -f db')) {
        return createMockProcess('db removed\n', '', 0) as unknown as ChildProcess;
      }

      return createMockProcess('', `unexpected command: ${argText}`, 1) as unknown as ChildProcess;
    };

    const result = await pipeline.deployCompose({
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('api');

    const parent = db.getProject(result.parentProjectId);
    expect(parent?.status).toBe('error');

    const children = db.getChildProjects(result.parentProjectId);
    expect(children).toHaveLength(2);
    expect(children.map((child) => child.status).sort()).toEqual(['error', 'error']);

    expect(composeCommands).toContainEqual(expect.stringContaining('up -d --build --no-deps db'));
    expect(composeCommands).toContainEqual(expect.stringContaining('up -d --build --no-deps api'));
    expect(composeCommands).toContainEqual(expect.stringContaining('stop db'));
    expect(composeCommands).toContainEqual(expect.stringContaining('rm -f db'));
  });

  it('blocks dependent service start when dependency is stopped', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(
      composePath,
      `services:\n  db:\n    image: postgres\n  api:\n    image: nginx\n    depends_on:\n      - db\n`,
      'utf8',
    );

    const composeCommands: string[] = [];
    let psCallCount = 0;
    mockSpawnImplementation = (_cmd: string, args: string[]) => {
      const argText = args.join(' ');
      composeCommands.push(argText);

      if (argText.includes(' up ') && argText.includes(' db')) {
        return createMockProcess('db started\n', '', 0) as unknown as ChildProcess;
      }

      if (argText.includes(' ps ')) {
        psCallCount += 1;
        if (psCallCount === 1) {
          return createMockProcess(
            JSON.stringify([
              {
                Service: 'db',
                State: 'exited',
                ID: 'db-container',
                Publishers: [],
              },
            ]),
            '',
            0,
          ) as unknown as ChildProcess;
        }

        return createMockProcess(
          JSON.stringify([
            {
              Service: 'db',
              State: 'exited',
              ID: 'db-container',
              Publishers: [],
            },
          ]),
          '',
          0,
        ) as unknown as ChildProcess;
      }

      return createMockProcess('', `unexpected command: ${argText}`, 1) as unknown as ChildProcess;
    };

    const result = await pipeline.deployCompose({
      repoUrl: 'https://github.com/example/stack',
      clonePath: tmpDir,
      composePath,
      name: 'stack',
      trigger: 'chat',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('db is stopped');
    expect(composeCommands).toContainEqual(expect.stringContaining('up -d --build --no-deps db'));
    expect(composeCommands).not.toContainEqual(
      expect.stringContaining('up -d --build --no-deps api'),
    );
  });

  it('parses service status output from compose ps json lines', async () => {
    const composePath = join(tmpDir, 'docker-compose.yml');
    writeFileSync(composePath, 'services: {}\n', 'utf8');

    db.createProject({
      id: 'parent-project',
      name: 'stack',
      repoUrl: 'https://github.com/example/stack',
      dockerfilePath: composePath,
    });

    mockSpawnImplementation = () =>
      createMockProcess(
        `{"Service":"api","State":"running","ID":"api-id","Ports":"0.0.0.0:8080->8080/tcp"}\n{"Service":"worker","State":"dead","ID":"worker-id"}\n`,
        '',
        0,
      ) as unknown as ChildProcess;

    const statuses = await pipeline.getServiceStatuses('parent-project');
    expect(statuses).toEqual([
      {
        name: 'api',
        status: 'running',
        ports: ['0.0.0.0:8080->8080/tcp'],
        containerId: 'api-id',
      },
      {
        name: 'worker',
        status: 'stopped',
        ports: undefined,
        containerId: 'worker-id',
      },
    ]);
  });
});
