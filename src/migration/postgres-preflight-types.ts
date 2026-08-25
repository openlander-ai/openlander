import type { PostgresMigrationTarget } from './postgres-runbook-types.js';

export const POSTGRES_MIGRATION_PREFLIGHT_SCHEMA_VERSION =
  'openlander.postgresql-preflight/v1' as const;
export const POSTGRES_MIGRATION_REHEARSAL_SCHEMA_VERSION =
  'openlander.postgresql-rehearsal/v1' as const;

export interface PostgresMigrationPreflightCheck {
  code: string;
  level: 'pass' | 'warning' | 'blocker';
  message: string;
}

export interface PostgresMigrationExtension {
  name: string;
  version: string;
}

export interface PostgresMigrationRole {
  name: string;
  can_login: boolean;
  superuser: boolean;
  create_role: boolean;
  create_database: boolean;
}

export interface PostgresMigrationMetadata {
  server_version: string;
  server_version_num: number;
  server_major_version: number;
  database_name: string;
  database_size_bytes: number;
  encoding: string;
  collate: string;
  ctype: string;
  schema_count: number;
  relation_count: number;
  table_count: number;
  sequence_count: number;
  estimated_row_count: number;
  extensions: PostgresMigrationExtension[];
  roles: PostgresMigrationRole[];
  roles_truncated: boolean;
}

export interface PostgresMigrationPreflightV1 {
  schema_version: typeof POSTGRES_MIGRATION_PREFLIGHT_SCHEMA_VERSION;
  generated_at: string;
  project: { id: string; name: string; display_name: string };
  source_service: { id: string; name: string; kind: 'postgres'; runtime_status: string | null };
  metadata: PostgresMigrationMetadata;
  readiness: {
    status: 'ready_for_rehearsal' | 'blocked';
    checks: PostgresMigrationPreflightCheck[];
  };
  inspection_policy: {
    read_only: true;
    row_contents_read: false;
    credentials_included: false;
    secret_values_included: false;
  };
}

export interface PostgresMigrationRehearsalTargetInput {
  provider: PostgresMigrationTarget;
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl_mode: 'require';
  confirm_empty_target: true;
}

export type PostgresMigrationRehearsalPhase =
  | 'queued'
  | 'preflight_source'
  | 'preflight_target'
  | 'dumping'
  | 'restoring'
  | 'verifying'
  | 'completed'
  | 'failed';

export interface PostgresMigrationRehearsalTargetObservation {
  server_version: string;
  server_version_num: number;
  server_major_version: number;
  database_size_bytes: number;
  schema_count: number;
  relation_count: number;
  table_count: number;
  sequence_count: number;
  installed_extensions: string[];
  unsupported_source_extensions: string[];
  empty: boolean;
}

export interface PostgresMigrationRehearsalV1 {
  schema_version: typeof POSTGRES_MIGRATION_REHEARSAL_SCHEMA_VERSION;
  run_id: string;
  project_id: string;
  service_id: string;
  target: {
    provider: PostgresMigrationTarget;
    host: string;
    port: number;
    database: string;
    ssl_mode: 'require';
  };
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  phase: PostgresMigrationRehearsalPhase;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  source_preflight: PostgresMigrationPreflightV1 | null;
  target_preflight: PostgresMigrationRehearsalTargetObservation | null;
  result: {
    dump_size_bytes: number;
    duration_ms: number;
    verification: {
      schema_count_matches: boolean;
      relation_count_matches: boolean;
      table_count_matches: boolean;
      sequence_count_matches: boolean;
      extensions_restored: boolean;
    };
  } | null;
  error: { code: string; message: string } | null;
  execution_policy: {
    source_mutated: false;
    target_mutation_permitted: true;
    target_changes_started: boolean;
    credentials_stored: false;
    credentials_returned: false;
    persisted: false;
  };
}
