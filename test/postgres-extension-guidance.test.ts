import { describe, expect, it } from 'vitest';

import { postgresExtensionImplementationGuidance } from '../src/tools/postgres-extension-guidance.js';

describe('PostgreSQL extension implementation guidance', () => {
  it.each([
    {
      image: 'pgvector/pgvector:pg17',
      selector: 'VECTOR_STORE_BACKEND=pgvector',
      boundary: 'VectorStore',
    },
    {
      image: 'apache/age:release_PG17_1.6.0',
      selector: 'GRAPH_STORE_BACKEND=age',
      boundary: 'GraphRepository',
    },
    {
      image: 'postgis/postgis:17-3.5',
      selector: 'SPATIAL_STORE_BACKEND=postgis',
      boundary: 'SpatialRepository',
    },
    {
      image: 'timescale/timescaledb:latest-pg17',
      selector: 'TIMESERIES_STORE_BACKEND=timescaledb',
      boundary: 'TimeSeriesRepository',
    },
  ])('returns adapter/env guidance for $image', ({ image, selector, boundary }) => {
    const guidance = postgresExtensionImplementationGuidance({ kind: 'postgres', image });

    expect(guidance?.message).toContain('DATABASE_URL');
    expect(guidance?.message).toContain(selector);
    expect(guidance?.message).toContain(boundary);
    expect(guidance?.message).toContain('CREATE EXTENSION IF NOT EXISTS');
    expect(guidance?.message).toContain('Never package-install');
  });

  it('keeps standard PostgreSQL extension-ready without inventing a backend selector', () => {
    const guidance = postgresExtensionImplementationGuidance({
      kind: 'postgres',
      image: 'postgres:17-alpine',
    });

    expect(guidance?.message).toContain('DATABASE_URL');
    expect(guidance?.message).toContain('only when the application genuinely supports');
    expect(guidance?.message).not.toContain('STORE_BACKEND=');
  });

  it('does not attach PostgreSQL guidance to another resource kind', () => {
    expect(
      postgresExtensionImplementationGuidance({ kind: 'mongo', image: 'pgvector/pgvector:pg17' }),
    ).toBeNull();
  });
});
