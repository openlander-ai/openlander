interface ManagedServiceGuidanceInput {
  kind: string;
  image?: string | null;
}

interface CreateManagedServiceGuidanceInput extends ManagedServiceGuidanceInput {
  suggestedEnvKeys: string[];
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

function postgresExtensionContract(image: string): string {
  const repository = imageRepository(image);
  const shared =
    'PostgreSQL connection contract: DATABASE_URL remains the only connection secret, and OpenLander does not create capability-specific connection URLs. The selected image must already contain extension binaries; versioned application migrations own CREATE EXTENSION IF NOT EXISTS and extension schema changes. OpenLander does not package-install extensions into running containers.';

  switch (repository) {
    case 'pgvector/pgvector':
      return `${shared} VECTOR_STORE_BACKEND=pgvector is optional non-secret application configuration and is not injected automatically.`;
    case 'apache/age':
      return `${shared} GRAPH_STORE_BACKEND=age and provider-neutral GRAPH_NAMESPACE are optional non-secret application configuration and are not injected automatically. Keep relational records as the migration source of truth and treat the AGE graph as reconstructable data.`;
    case 'postgis/postgis':
      return `${shared} SPATIAL_STORE_BACKEND=postgis is optional non-secret application configuration and is not injected automatically.`;
    case 'timescale/timescaledb':
    case 'timescale/timescaledb-ha':
      return `${shared} TIMESERIES_STORE_BACKEND=timescaledb is optional non-secret application configuration and is not injected automatically.`;
    default:
      return shared;
  }
}

export function managedServiceIntegrationContract(
  input: ManagedServiceGuidanceInput,
): string | null {
  if (input.kind === 'postgres') {
    return postgresExtensionContract(input.image ?? '');
  }

  if (input.kind === 'minio') {
    return 'Object-storage connection contract: new MinIO bindings use OBJECT_STORAGE_* values. Bucket and prefix are configured separately, and existing S3_ENDPOINT/AWS_* values are not renamed or removed automatically. OpenLander does not copy objects or rewrite persisted object locations.';
  }

  return null;
}

export function createManagedServiceGuidanceMessage(
  input: CreateManagedServiceGuidanceInput,
): string {
  const connectionContract =
    input.suggestedEnvKeys.length > 0
      ? 'Use suggested_env for the application connection; auto_injected_env_keys is authoritative for values OpenLander already saved. Managed-service connection values use Project-internal Docker DNS, not localhost, and credential values must remain secret.'
      : 'OpenLander did not infer a connection env contract for this image. No application binding was generated; use the returned resource metadata only after the application protocol and credential contract are known.';
  const integrationContract = managedServiceIntegrationContract(input);
  return integrationContract ? `${connectionContract} ${integrationContract}` : connectionContract;
}

export function revealedCredentialGuidanceMessage(): string {
  return 'This response contains plaintext credentials. Keep them out of source control, build output, and logs. Internal host and connectionString values are for workloads on the same OpenLander Project network; externalConnectionStrings are operator-access endpoints and are not automatic application bindings.';
}
