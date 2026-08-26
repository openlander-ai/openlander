import { describe, expect, it } from 'vitest';

import {
  createManagedServiceGuidanceMessage,
  managedServiceIntegrationContract,
  revealedCredentialGuidanceMessage,
} from '../src/tools/managed-service-guidance.js';

describe('managed-service MCP guidance boundary', () => {
  it.each([
    {
      image: 'pgvector/pgvector:pg17',
      selector: 'VECTOR_STORE_BACKEND=pgvector',
    },
    {
      image: 'apache/age:release_PG17_1.6.0',
      selector: 'GRAPH_STORE_BACKEND=age',
    },
    {
      image: 'postgis/postgis:17-3.5',
      selector: 'SPATIAL_STORE_BACKEND=postgis',
    },
    {
      image: 'timescale/timescaledb:latest-pg17',
      selector: 'TIMESERIES_STORE_BACKEND=timescaledb',
    },
  ])('returns platform-owned extension constraints for $image', ({ image, selector }) => {
    const guidance = managedServiceIntegrationContract({ kind: 'postgres', image });

    expect(guidance).toContain('DATABASE_URL');
    expect(guidance).toContain(selector);
    expect(guidance).toContain('not injected automatically');
    expect(guidance).toContain('CREATE EXTENSION IF NOT EXISTS');
    expect(guidance).toContain('does not package-install');
    expect(guidance).not.toMatch(/Repository|VectorStore|SpatialRepository|TimeSeriesRepository/);
  });

  it('keeps standard PostgreSQL extension-ready without inventing a backend selector', () => {
    const guidance = managedServiceIntegrationContract({
      kind: 'postgres',
      image: 'postgres:17-alpine',
    });

    expect(guidance).toContain('DATABASE_URL');
    expect(guidance).not.toContain('STORE_BACKEND=');
  });

  it('states MinIO compatibility limits without prescribing an SDK or code architecture', () => {
    const guidance = managedServiceIntegrationContract({ kind: 'minio', image: 'minio/minio' });

    expect(guidance).toContain('OBJECT_STORAGE_*');
    expect(guidance).toContain('S3_ENDPOINT/AWS_*');
    expect(guidance).toContain('does not copy objects');
    expect(guidance).not.toMatch(/SDK|adapter|Repository/);
  });

  it('gives every managed service the shared connection, networking, and secret contract', () => {
    const guidance = createManagedServiceGuidanceMessage({
      kind: 'redis',
      image: 'redis:7',
      suggestedEnvKeys: ['REDIS_URL'],
    });

    expect(guidance).toContain('suggested_env');
    expect(guidance).toContain('auto_injected_env_keys');
    expect(guidance).toContain('Docker DNS, not localhost');
    expect(guidance).toContain('must remain secret');
  });

  it('does not invent a connection contract for a custom image', () => {
    const guidance = createManagedServiceGuidanceMessage({
      kind: 'image',
      image: 'example/custom:1',
      suggestedEnvKeys: [],
    });

    expect(guidance).toContain('did not infer a connection env contract');
    expect(guidance).toContain('No application binding was generated');
    expect(guidance).not.toContain('Docker DNS, not localhost');
  });

  it('labels revealed internal and external credentials without implementation advice', () => {
    const guidance = revealedCredentialGuidanceMessage();

    expect(guidance).toContain('plaintext credentials');
    expect(guidance).toContain('same OpenLander Project network');
    expect(guidance).toContain('externalConnectionStrings');
    expect(guidance).not.toMatch(/framework|ORM|SDK|Repository/);
  });
});
