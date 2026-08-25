export const POSTGRES_MIGRATION_RUNBOOK_SCHEMA_VERSION =
  'openlander.postgresql-migration-runbook/v1' as const;

export const POSTGRES_MIGRATION_TARGETS = [
  'aws_rds_postgresql',
  'gcp_cloud_sql_postgresql',
] as const;

export type PostgresMigrationTarget = (typeof POSTGRES_MIGRATION_TARGETS)[number];
export type PostgresRunbookReadinessStatus = 'needs_input' | 'blocked';
export type PostgresRunbookCheckLevel = 'pass' | 'warning' | 'blocker';

export interface PostgresRunbookCheck {
  code: string;
  level: PostgresRunbookCheckLevel;
  message: string;
}

export interface PostgresRunbookInput {
  key: string;
  label: string;
  sensitive: boolean;
  description: string;
  placeholder: string;
}

export interface PostgresRunbookCommand {
  id: string;
  title: string;
  shell: string;
  contains_placeholders: true;
  mutates_source: false;
  mutates_target: boolean;
}

export interface PostgresRunbookPhase {
  id: string;
  order: number;
  title: string;
  objective: string;
  execution_owner: 'operator';
  downtime: 'none' | 'required';
  commands: PostgresRunbookCommand[];
  checklist: string[];
  verification: string[];
  rollback: string[];
}

export interface PostgresMigrationRunbookV1 {
  schema_version: typeof POSTGRES_MIGRATION_RUNBOOK_SCHEMA_VERSION;
  generated_at: string;
  project: {
    id: string;
    name: string;
    display_name: string;
  };
  source_service: {
    id: string;
    name: string;
    kind: 'postgres';
    ownership: 'project';
    image_reference: string | null;
    postgres_major_version: number | null;
    runtime_status: string | null;
    connection_consumer_ids: string[];
    volume_ids: string[];
  };
  target: {
    id: PostgresMigrationTarget;
    provider: 'aws' | 'gcp';
    service: 'Amazon RDS for PostgreSQL' | 'Cloud SQL for PostgreSQL';
    display_name: string;
  };
  strategy: {
    method: 'native_pg_dump_pg_restore';
    suitability: 'review_required';
    write_freeze_required: true;
    online_replication_included: false;
    database_size_bytes: null;
    note: string;
  };
  readiness: {
    status: PostgresRunbookReadinessStatus;
    checks: PostgresRunbookCheck[];
  };
  required_inputs: PostgresRunbookInput[];
  phases: PostgresRunbookPhase[];
  execution_policy: {
    commands_executed: false;
    credentials_included: false;
    cloud_changes_made: false;
    data_copied: false;
    dns_changed: false;
  };
  limitations: string[];
  references: Array<{ title: string; url: string }>;
}

export interface PostgresMigrationRunbookBundle {
  runbook: PostgresMigrationRunbookV1;
  document_markdown: string;
}
