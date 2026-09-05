import { execFileSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/db/index.js';
import { Docker } from '../../src/pipeline/docker.js';
import { updateManagedServiceResources } from '../../src/pipeline/managed-service-resources.js';

// Opt-in: creates only its own unlabelled container; safe on shared Docker hosts.
describe.runIf(process.env.OPENLANDER_MEMORY_DOCKER_SMOKE === '1')(
  'managed memory Docker smoke',
  () => {
    it('updates a live PostgreSQL container and preserves its data across a restart', async () => {
      const docker = new Docker();
      const run = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
      const id = run(
        'run',
        '-d',
        '--memory',
        '256m',
        '--memory-swap',
        '256m',
        '--memory-reservation',
        '128m',
        '-e',
        'POSTGRES_PASSWORD=memory-smoke-only',
        'postgres:16-alpine',
      );
      try {
        await vi.waitFor(
          () =>
            expect(run('exec', id, 'pg_isready', '-U', 'postgres')).toContain(
              'accepting connections',
            ),
          { timeout: 30000, interval: 500 },
        );
        const sql = (query: string) => run('exec', id, 'psql', '-U', 'postgres', '-Atc', query);
        sql(
          "CREATE TABLE memory_marker (value text); INSERT INTO memory_marker VALUES ('preserved');",
        );
        const before = await docker.inspectContainer(id);
        let saved: string | null = null;
        const db = {
          getService: async () => ({
            id: 'smoke-db',
            project_id: 'smoke-project',
            name: 'memory-smoke',
            kind: 'postgres',
            container_id: id,
            status: 'running',
          }),
          getProject: async () => ({ id: 'smoke-project', name: 'memory-smoke' }),
          isCircuitBreakerOpen: async () => false,
          acquireDeployLock: async () => true,
          releaseDeployLock: async () => undefined,
          loadDeployConfigForService: async () => (saved ? { config_json: saved } : null),
          saveDeployConfigForService: async (_id: string, json: string) => {
            saved = json;
          },
          insertActivityLog: async () => undefined,
        } as unknown as Database;
        const result = await updateManagedServiceResources(db, docker, 'smoke-db', {
          profile: 'custom',
          memoryMb: 512,
        });
        expect(result.memory?.limitBytes).toBe(512 * 1024 * 1024);
        const after = await docker.inspectContainer(id);
        expect(after.Id).toBe(before.Id);
        expect(after.State.StartedAt).toBe(before.State.StartedAt);
        expect(after.Mounts).toEqual(before.Mounts);
        expect(sql('SELECT value FROM memory_marker')).toBe('preserved');
        run('restart', id);
        await vi.waitFor(() => expect(sql('SELECT value FROM memory_marker')).toBe('preserved'), {
          timeout: 30000,
          interval: 500,
        });
        expect((await docker.inspectContainer(id)).HostConfig.Memory).toBe(512 * 1024 * 1024);
        await docker.stopContainer(id);
        const decreased = await updateManagedServiceResources(db, docker, 'smoke-db', {
          profile: 'custom',
          memoryMb: 256,
        });
        expect(decreased.running).toBe(false);
        expect(decreased.memory?.limitBytes).toBe(256 * 1024 * 1024);
        run('start', id);
        await vi.waitFor(() => expect(sql('SELECT value FROM memory_marker')).toBe('preserved'), {
          timeout: 30000,
          interval: 500,
        });
      } finally {
        run('rm', '-fv', id);
      }
    }, 60000);
  },
);
