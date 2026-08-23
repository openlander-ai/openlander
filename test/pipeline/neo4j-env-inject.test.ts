import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import { autoInjectServiceEnv } from '../../src/pipeline/env-inject.js';
import type { EnvManager } from '../../src/pipeline/env.js';

function createHarness(options?: { sameTypeConnection?: boolean }) {
  const db = {
    getProject: vi.fn().mockResolvedValue(null),
    listServiceConnectionsByProject: vi
      .fn()
      .mockResolvedValue(
        options?.sameTypeConnection ? [{ service_id_provider: 'existing-neo4j' }] : [],
      ),
    getService: vi.fn().mockResolvedValue({ kind: 'neo4j' }),
  } as unknown as Database;
  const env = {
    getAll: vi.fn().mockResolvedValue({}),
    set: vi.fn().mockResolvedValue(undefined),
  } as unknown as EnvManager;
  return { db, env };
}

describe('Neo4j managed-service env injection', () => {
  it('injects URI, username, and password as separate project variables', async () => {
    const { db, env } = createHarness();

    const keys = await autoInjectServiceEnv({
      db,
      env,
      projectId: 'app-project',
      serviceId: 'app-graph',
      serviceName: 'app-graph',
      serviceType: 'neo4j',
      containerName: 'ol-svc-app-graph',
      credentials: {
        user: 'neo4j',
        password: 'graphpw',
        connectionString: 'neo4j://ol-svc-app-graph:7687',
      },
    });

    expect(keys).toEqual(['NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD']);
    expect(env.set).toHaveBeenCalledWith(
      'app-project',
      'NEO4J_URI',
      'neo4j://ol-svc-app-graph:7687',
    );
    expect(env.set).toHaveBeenCalledWith('app-project', 'NEO4J_USERNAME', 'neo4j');
    expect(env.set).toHaveBeenCalledWith('app-project', 'NEO4J_PASSWORD', 'graphpw');
  });

  it('prefixes all three keys when another Neo4j service is already connected', async () => {
    const { db, env } = createHarness({ sameTypeConnection: true });

    const keys = await autoInjectServiceEnv({
      db,
      env,
      projectId: 'app-project',
      serviceId: 'analytics-graph',
      serviceName: 'analytics-graph',
      serviceType: 'neo4j',
      containerName: 'ol-svc-analytics-graph',
      credentials: {
        user: 'neo4j',
        password: 'graphpw',
        connectionString: 'neo4j://ol-svc-analytics-graph:7687',
      },
    });

    expect(keys).toEqual([
      'ANALYTICS_GRAPH_NEO4J_URI',
      'ANALYTICS_GRAPH_NEO4J_USERNAME',
      'ANALYTICS_GRAPH_NEO4J_PASSWORD',
    ]);
  });

  it('persists the preselected Neo4j env contract unchanged for an empty Project', async () => {
    const { db, env } = createHarness();
    const connectionEnv = [
      { key: 'ANALYTICS_GRAPH_NEO4J_URI', value: 'neo4j://ol-svc-analytics-graph:7687' },
      { key: 'ANALYTICS_GRAPH_NEO4J_USERNAME', value: 'neo4j' },
      { key: 'ANALYTICS_GRAPH_NEO4J_PASSWORD', value: 'graphpw' },
    ];

    const keys = await autoInjectServiceEnv({
      db,
      env,
      projectId: 'empty-project',
      serviceId: 'analytics-graph',
      serviceName: 'analytics-graph',
      serviceType: 'neo4j',
      containerName: 'ol-svc-analytics-graph',
      connectionEnv,
    });

    expect(keys).toEqual(connectionEnv.map(({ key }) => key));
    for (const { key, value } of connectionEnv) {
      expect(env.set).toHaveBeenCalledWith('empty-project', key, value);
    }
  });
});
