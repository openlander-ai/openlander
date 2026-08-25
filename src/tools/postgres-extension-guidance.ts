interface PostgresExtensionGuidanceInput {
  kind: string;
  image?: string | null;
}

interface PostgresExtensionGuidance {
  message: string;
}

function imageRepository(image: string): string {
  const withoutDigest = image.split('@')[0] ?? image;
  const lastSlash = withoutDigest.lastIndexOf('/');
  const lastColon = withoutDigest.lastIndexOf(':');
  const withoutTag = lastColon > lastSlash ? withoutDigest.slice(0, lastColon) : withoutDigest;
  return withoutTag
    .replace(/^(?:docker\.io\/)?/, '')
    .replace(/^library\//, '')
    .toLowerCase();
}

export function postgresExtensionImplementationGuidance(
  input: PostgresExtensionGuidanceInput,
): PostgresExtensionGuidance | null {
  if (input.kind !== 'postgres') {
    return null;
  }

  const repository = input.image ? imageRepository(input.image) : '';
  const shared =
    'Keep DATABASE_URL as the only PostgreSQL connection secret; do not duplicate it as a capability-specific URL. The selected Docker image must already contain the extension binaries, and versioned application migrations should run CREATE EXTENSION IF NOT EXISTS. Never package-install extensions into a running database container.';

  switch (repository) {
    case 'pgvector/pgvector':
      return {
        message: `${shared} Use VECTOR_STORE_BACKEND=pgvector only at the application adapter boundary, and keep vector types, distance operators, and index choices behind a VectorStore interface.`,
      };
    case 'apache/age':
      return {
        message: `${shared} Use GRAPH_STORE_BACKEND=age and an optional provider-neutral GRAPH_NAMESPACE at the application adapter boundary; do not create AGE_DATABASE_URL. Keep AGE session bootstrap and Cypher behind a GraphRepository, retain relational tables as the source of truth, and treat the AGE graph as a rebuildable projection.`,
      };
    case 'postgis/postgis':
      return {
        message: `${shared} Use SPATIAL_STORE_BACKEND=postgis only at the application adapter boundary, and keep PostGIS types, SRIDs, operators, and index choices behind a SpatialRepository.`,
      };
    case 'timescale/timescaledb':
    case 'timescale/timescaledb-ha':
      return {
        message: `${shared} Use TIMESERIES_STORE_BACKEND=timescaledb only at the application adapter boundary, and keep hypertables, continuous aggregates, retention policies, and time_bucket queries behind a TimeSeriesRepository.`,
      };
    default:
      return {
        message: `${shared} If the application later adopts pgvector, Apache AGE, PostGIS, or TimescaleDB, expose the capability through an application-owned adapter and add a backend selector only when the application genuinely supports another implementation.`,
      };
  }
}
