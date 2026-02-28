import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { ComposePipeline } from '../src/pipeline/compose.js';
import { Database } from '../src/db/index.js';
import { EventBus } from '../src/events/index.js';
import type { Docker } from '../src/pipeline/docker.js';

function createMockDocker(): Docker {
  return {} as unknown as Docker;
}

function getBunLike(): { spawn: (...args: unknown[]) => unknown } {
  return (globalThis as unknown as { Bun: { spawn: (...args: unknown[]) => unknown } }).Bun;
}

function createMockProcess(
  stdout: string,
  stderr: string,
  exitCode: number,
): {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
} {
  return {
    stdout: new Response(stdout).body,
    stderr: new Response(stderr).body,
    exited: Promise.resolve(exitCode),
  };
}

describe('ComposePipeline', () => {
  let tmpDir: string;
  let db: Database;
  let pipeline: ComposePipeline;
  let originalSpawn: typeof Bun.spawn;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-compose-test-'));
    originalSpawn = Bun.spawn;
    (Bun as Record<string, unknown>).spawn = vi.fn();
    db = new Database(join(tmpDir, 'test.db'));
    pipeline = new ComposePipeline(createMockDocker(), db, new EventBus());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (Bun as Record<string, unknown>).spawn = originalSpawn;
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

    const bun = getBunLike();
    const spawnSpy = vi.spyOn(bun, 'spawn').mockImplementation(((cmd: string[]) => {
      const argText = cmd.join(' ');
      if (argText.includes(' up ')) {
        return createMockProcess('compose up ok\n', '', 0);
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
        );
      }
      return createMockProcess('', 'unexpected command', 1);
    }) as (...args: unknown[]) => unknown);

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
    expect(spawnSpy).toHaveBeenCalledTimes(2);
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

    const bun = getBunLike();
    vi.spyOn(bun, 'spawn').mockImplementation((() =>
      createMockProcess(
        `{"Service":"api","State":"running","ID":"api-id","Ports":"0.0.0.0:8080->8080/tcp"}\n{"Service":"worker","State":"dead","ID":"worker-id"}\n`,
        '',
        0,
      )) as (...args: unknown[]) => unknown);

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
