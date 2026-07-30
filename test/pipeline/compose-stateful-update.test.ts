import { describe, expect, it } from 'vitest';

import {
  classifyStatefulComposeChanges,
  fingerprintComposeProject,
  type ExistingStatefulComposeService,
} from '../../src/pipeline/compose-stateful-update.js';
import type { ComposeService } from '../../src/pipeline/compose.js';
import type { RuntimeBackend } from '../../src/pipeline/runtime/index.js';

type Inspection = Awaited<ReturnType<RuntimeBackend['inspectContainer']>>;

function inspection(overrides: Record<string, unknown> = {}): Inspection {
  return {
    Id: 'container-db',
    Config: {
      Image: 'postgres:17-alpine',
      Env: ['POSTGRES_DB=app'],
      Cmd: [],
      Entrypoint: [],
      ExposedPorts: { '5432/tcp': {} },
      Healthcheck: null,
    },
    HostConfig: {
      RestartPolicy: { Name: 'unless-stopped' },
      Memory: 0,
    },
    Mounts: [
      {
        Type: 'volume',
        Name: 'ol-stack-volume-pgdata',
        Source: '/var/lib/docker/volumes/ol-stack-volume-pgdata/_data',
        Destination: '/var/lib/postgresql/data',
      },
    ],
    ...overrides,
  } as Inspection;
}

function existing(currentInspection = inspection()): ExistingStatefulComposeService {
  return {
    serviceName: 'db',
    serviceId: 'child-db__svc',
    runtimeRole: 'resource',
    containerId: 'container-db',
    previousFingerprint: 'old',
    inspection: currentInspection,
  };
}

function classify(
  service: ComposeService | undefined,
  currentFingerprint = 'new',
  desiredDatabase = 'next',
) {
  return classifyStatefulComposeChanges({
    projectName: 'stack',
    projectPath: '/tmp/stack',
    services: service ? [service] : [],
    runtimeRoles: new Map(service ? [['db', 'resource' as const]] : []),
    existingServices: [existing()],
    currentFingerprints: service ? { db: currentFingerprint } : {},
    desiredEnvByService: new Map([['db', { POSTGRES_DB: desiredDatabase }]]),
  });
}

describe('Stateful Compose update planning', () => {
  const service: ComposeService = {
    name: 'db',
    image: 'postgres:17-alpine',
    restart: 'unless-stopped',
    expose: ['5432'],
    environment: { POSTGRES_DB: '${POSTGRES_DB}' },
    volumes: ['pgdata:/var/lib/postgresql/data'],
  };

  it('returns a secret-free approvable diff for container config changes', () => {
    expect(classify(service)).toEqual([
      expect.objectContaining({
        serviceName: 'db',
        change: 'update',
        changedFields: ['environment'],
        containerId: 'container-db',
        backupVolumes: [
          {
            name: 'ol-stack-volume-pgdata',
            destination: '/var/lib/postgresql/data',
          },
        ],
      }),
    ]);
    expect(JSON.stringify(classify(service))).not.toContain('next');
  });

  it('does not request approval for an unchanged fingerprint', () => {
    expect(classify(service, 'old', 'app')).toEqual([]);
  });

  it('still requests approval for runtime drift when the source fingerprint is unchanged', () => {
    expect(classify(service, 'old')).toEqual([
      expect.objectContaining({ changedFields: ['environment'] }),
    ]);
  });

  it('classifies removal as approval-held archive work', () => {
    expect(classify(undefined)).toEqual([
      expect.objectContaining({
        serviceName: 'db',
        change: 'remove',
        changedFields: ['removed'],
        backupRequired: true,
      }),
    ]);
  });

  it('blocks PostgreSQL major changes as a migration', () => {
    expect(() => classify({ ...service, image: 'postgres:18-alpine' })).toThrowError(
      expect.objectContaining({ code: 'STATEFUL_MIGRATION_REQUIRED' }),
    );
  });

  it('blocks changing an Application into a resource role', () => {
    expect(() =>
      classifyStatefulComposeChanges({
        projectName: 'stack',
        projectPath: '/tmp/stack',
        services: [{ ...service, name: 'worker', image: 'redis:7' }],
        runtimeRoles: new Map([['worker', 'resource']]),
        existingServices: [
          {
            serviceName: 'worker',
            serviceId: 'child-worker__svc',
            runtimeRole: 'application',
            containerId: 'container-worker',
            previousFingerprint: 'old',
            inspection: inspection({ Id: 'container-worker' }),
          },
        ],
        currentFingerprints: { worker: 'new' },
        desiredEnvByService: new Map([['worker', {}]]),
      }),
    ).toThrowError(
      expect.objectContaining({
        code: 'STATEFUL_MIGRATION_REQUIRED',
        details: expect.objectContaining({ changedFields: ['runtime_role'] }),
      }),
    );
  });

  it('blocks volume contract changes as a migration', () => {
    expect(() =>
      classify({ ...service, volumes: ['other:/var/lib/postgresql/data'] }),
    ).toThrowError(expect.objectContaining({ code: 'STATEFUL_MIGRATION_REQUIRED' }));
  });

  it('blocks host bind backups before approval', () => {
    expect(() =>
      classifyStatefulComposeChanges({
        projectName: 'stack',
        projectPath: '/tmp/stack',
        services: [service],
        runtimeRoles: new Map([['db', 'resource']]),
        existingServices: [
          existing(
            inspection({
              Mounts: [
                {
                  Type: 'bind',
                  Source: '/srv/postgres',
                  Destination: '/var/lib/postgresql/data',
                },
              ],
            }),
          ),
        ],
        currentFingerprints: { db: 'new' },
        desiredEnvByService: new Map(),
      }),
    ).toThrowError(expect.objectContaining({ code: 'STATEFUL_BACKUP_UNSUPPORTED' }));
  });

  it('fingerprints the whole Compose definition deterministically', () => {
    expect(fingerprintComposeProject({ web: 'b', db: 'a' })).toBe(
      fingerprintComposeProject({ db: 'a', web: 'b' }),
    );
  });
});
