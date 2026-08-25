import type { ProjectMigrationTargetComparisonV1 } from './target-types.js';

export const PROJECT_MIGRATION_SCHEMA_VERSION = 'openlander.project-migration/v1' as const;

export type MigrationReadinessStatus = 'ready' | 'needs_attention' | 'blocked';
export type MigrationCheckLevel = 'pass' | 'warning' | 'blocker';

export interface MigrationProject {
  id: string;
  name: string;
  display_name: string;
  description: string | null;
  tags: string[];
  archived_at: string | null;
}

export interface MigrationEnvironment {
  id: string;
  key: string;
  display_name: string;
  scope: 'project' | 'service';
  service_id: string | null;
  tier: 'development' | 'validation' | 'production' | null;
  promotion_order: number | null;
  branch: string | null;
  status: string | null;
}

export interface MigrationService {
  id: string;
  project_id: string;
  ownership: 'project' | 'connected';
  name: string;
  kind:
    | 'git'
    | 'image'
    | 'compose'
    | 'compose-child'
    | 'postgres'
    | 'mysql'
    | 'redis'
    | 'mongo'
    | 'neo4j'
    | 'minio';
  runtime_role: 'application' | 'job' | 'resource';
  parent_service_id: string | null;
  archived_at: string | null;
  source: {
    type: string;
    repo_url: string | null;
    branch: string | null;
    dockerfile_path: string | null;
    docker_target: string | null;
    build_context: string | null;
    build_method: 'dockerfile' | 'compose' | null;
    image_reference: string | null;
    image_id: string | null;
    image_command: string | null;
  };
  runtime: {
    status: string | null;
    container_id: string | null;
    container_name: string | null;
    container_state: string | null;
    container_status: string | null;
    assigned_port: number | null;
    container_port: number | null;
    health_check_strategy: 'http' | 'tcp' | 'exec' | 'none' | null;
    health_check_path: string | null;
    public_url: string | null;
  };
  last_deploy: {
    deploy_id: string;
    status: 'success' | 'failed' | 'cancelled';
    commit_sha: string | null;
    created_at: string;
  } | null;
}

export interface MigrationConnection {
  id: string;
  service_id_consumer: string;
  service_id_provider: string;
  environment_id: string | null;
  auto_injected_env_keys: string[];
}

export interface MigrationVolume {
  id: string;
  name: string | null;
  type: 'volume' | 'bind';
  source: string;
  destination: string | null;
  driver: string | null;
  read_only: boolean;
  size_bytes: number | null;
  service_ids: string[];
}

export interface MigrationDomainRoute {
  id: string;
  service_id: string;
  domain: string;
  path_prefix: string;
  upstream_path_prefix: string | null;
  strip_prefix: boolean;
  target_port: number | null;
  tls_enabled: boolean | null;
  status: 'active' | 'pending' | 'error';
}

export interface MigrationEnvMetadata {
  key: string;
  scope: 'project' | 'service' | 'environment';
  service_id: string | null;
  environment_id: string | null;
  sensitive: boolean;
  public: boolean;
}

export interface MigrationSecretFileMetadata {
  filename: string;
  mount_path: string;
  scope: 'project';
}

export interface MigrationRuntimeWarning {
  code: string;
  message: string;
}

export interface MigrationRuntimeInspection {
  status: 'complete' | 'partial' | 'unavailable';
  checked_at: string;
  container_count: number;
  matched_container_count: number;
  volume_count: number;
  warnings: MigrationRuntimeWarning[];
}

export interface MigrationReadinessCheck {
  code: string;
  level: MigrationCheckLevel;
  message: string;
  service_id: string | null;
}

export interface MigrationReadiness {
  status: MigrationReadinessStatus;
  checks: MigrationReadinessCheck[];
}

export interface MigrationExportPolicy {
  secret_values_included: false;
  global_secrets_included: false;
  secret_file_contents_included: false;
  data_payloads_included: false;
}

export interface ProjectMigrationSnapshotV1 {
  schema_version: typeof PROJECT_MIGRATION_SCHEMA_VERSION;
  generated_at: string;
  project: MigrationProject;
  environments: MigrationEnvironment[];
  services: MigrationService[];
  service_connections: MigrationConnection[];
  volumes: MigrationVolume[];
  domain_routes: MigrationDomainRoute[];
  environment_variables: MigrationEnvMetadata[];
  secret_files: MigrationSecretFileMetadata[];
  runtime_inspection: MigrationRuntimeInspection;
  readiness: MigrationReadiness;
  export_policy: MigrationExportPolicy;
}

export interface ProjectMigrationBundle {
  snapshot: ProjectMigrationSnapshotV1;
  document_markdown: string;
  target_comparison: ProjectMigrationTargetComparisonV1;
  target_document_markdown: string;
}
