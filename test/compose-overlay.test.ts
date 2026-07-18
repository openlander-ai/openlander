import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  ComposePipeline,
  inferComposeHealthcheckPort,
  inferComposeRuntimeRoles,
} from '../src/pipeline/compose.js';
import type { Database } from '../src/db/index.js';
import type { EventBus } from '../src/events/index.js';
import type { Docker } from '../src/pipeline/docker.js';
import { resolveComposeFilePaths } from '../src/pipeline/compose-spec.js';

describe('Compose file overlays', () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('merges an Incar-style production overlay and applies !reset', () => {
    const repositoryPath = mkdtempSync(join(tmpdir(), 'openlander-compose-overlay-'));
    temporaryDirectories.push(repositoryPath);
    const basePath = join(repositoryPath, 'docker-compose.yml');
    const overlayPath = join(repositoryPath, 'compose.production.yml');
    writeFileSync(
      basePath,
      `services:
  db:
    image: pgvector/pgvector:pg16
    ports: ["5432:5432"]
    volumes: ["db_data:/var/lib/postgresql/data"]
  migrate:
    build: ./api
    depends_on:
      db:
        condition: service_healthy
  api:
    build: ./api
    ports: ["4000:4000"]
    environment:
      DATABASE_URL: postgres://db/app
    volumes: ["./data:/app/data"]
    depends_on:
      migrate:
        condition: service_completed_successfully
      db:
        condition: service_healthy
  web:
    build: ./web
    ports: ["3000:3000"]
    depends_on: [api]
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:3000/health"]
volumes:
  db_data:
`,
      'utf8',
    );
    writeFileSync(
      overlayPath,
      `services:
  db:
    ports: !reset []
  migrate:
    image: ghcr.io/example/api:production
    build: !reset null
  api:
    image: ghcr.io/example/api:production
    build: !reset null
    ports: !reset []
    environment:
      NODE_ENV: production
    volumes:
      - hf_cache:/root/.cache
  web:
    image: ghcr.io/example/web:production
    build: !reset null
    ports: !reset []
  caddy:
    image: caddy:2
    ports: ["80:80"]
    depends_on: [web, api]
volumes:
  hf_cache:
`,
      'utf8',
    );
    const pipeline = new ComposePipeline({} as Docker, {} as Database, {} as EventBus);

    const parsed = pipeline.parseComposeFiles([basePath, overlayPath]);
    const api = parsed.services.find((service) => service.name === 'api');
    const migrate = parsed.services.find((service) => service.name === 'migrate');
    const db = parsed.services.find((service) => service.name === 'db');
    const roles = inferComposeRuntimeRoles(parsed.services);

    expect(parsed.composePaths).toEqual([basePath, overlayPath]);
    expect(parsed.services.map((service) => service.name)).toEqual([
      'db',
      'migrate',
      'api',
      'web',
      'caddy',
    ]);
    expect(api).toMatchObject({
      image: 'ghcr.io/example/api:production',
      environment: { DATABASE_URL: 'postgres://db/app', NODE_ENV: 'production' },
      dependsOn: ['migrate', 'db'],
      volumes: ['./data:/app/data', 'hf_cache:/root/.cache'],
    });
    expect(api?.build).toBeUndefined();
    expect(api?.ports).toEqual([]);
    expect(migrate?.build).toBeUndefined();
    expect(migrate?.dependsOnConditions).toEqual({ db: 'service_healthy' });
    expect(db?.ports).toEqual([]);
    expect(db?.volumes).toEqual(['db_data:/var/lib/postgresql/data']);
    expect(roles.get('migrate')).toBe('job');
    expect(roles.get('db')).toBe('resource');
    const web = parsed.services.find((service) => service.name === 'web');
    expect(web?.ports).toEqual([]);
    expect(inferComposeHealthcheckPort(web ?? { name: 'web' })).toBe(3000);
  });

  it('rejects empty, duplicate, and repository-escaping Compose file lists', () => {
    const repositoryPath = mkdtempSync(join(tmpdir(), 'openlander-compose-paths-'));
    temporaryDirectories.push(repositoryPath);
    writeFileSync(join(repositoryPath, 'compose.yml'), 'services: {}\n', 'utf8');

    expect(() => resolveComposeFilePaths(repositoryPath, [])).toThrowError(
      expect.objectContaining({ code: 'SERVICE_CONFIG_INVALID' }),
    );
    expect(() =>
      resolveComposeFilePaths(repositoryPath, ['compose.yml', 'compose.yml']),
    ).toThrowError(expect.objectContaining({ code: 'SERVICE_CONFIG_INVALID' }));
    expect(() => resolveComposeFilePaths(repositoryPath, ['../compose.yml'])).toThrowError(
      expect.objectContaining({ code: 'SERVICE_CONFIG_INVALID' }),
    );
  });
});
