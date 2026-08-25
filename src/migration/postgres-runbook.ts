import type { MigrationService, ProjectMigrationSnapshotV1 } from './types.js';
import {
  POSTGRES_MIGRATION_RUNBOOK_SCHEMA_VERSION,
  type PostgresMigrationRunbookV1,
  type PostgresMigrationTarget,
  type PostgresRunbookCheck,
  type PostgresRunbookCommand,
  type PostgresRunbookInput,
  type PostgresRunbookPhase,
} from './postgres-runbook-types.js';

const SOURCE_PSQL =
  'PGPASSFILE="${SOURCE_PGPASSFILE}" psql --host="${SOURCE_PGHOST}" --port="${SOURCE_PGPORT}" --username="${SOURCE_PGUSER}" --dbname="${SOURCE_PGDATABASE}" --set=ON_ERROR_STOP=1';
const TARGET_PSQL =
  'PGPASSFILE="${TARGET_PGPASSFILE}" psql --host="${TARGET_PGHOST}" --port="${TARGET_PGPORT}" --username="${TARGET_PGUSER}" --dbname="${TARGET_PGDATABASE}" --set=ON_ERROR_STOP=1';

const targetDetails: Record<PostgresMigrationTarget, PostgresMigrationRunbookV1['target']> = {
  aws_rds_postgresql: {
    id: 'aws_rds_postgresql',
    provider: 'aws',
    service: 'Amazon RDS for PostgreSQL',
    display_name: 'AWS RDS for PostgreSQL',
  },
  gcp_cloud_sql_postgresql: {
    id: 'gcp_cloud_sql_postgresql',
    provider: 'gcp',
    service: 'Cloud SQL for PostgreSQL',
    display_name: 'GCP Cloud SQL for PostgreSQL',
  },
};

function command(
  id: string,
  title: string,
  shell: string,
  mutatesTarget = false,
): PostgresRunbookCommand {
  return {
    id,
    title,
    shell,
    contains_placeholders: true,
    mutates_source: false,
    mutates_target: mutatesTarget,
  };
}

function parsePostgresMajorVersion(imageReference: string | null): number | null {
  const match = imageReference?.match(/(?:^|\/)postgres:(\d+)(?:[.\-@]|$)/i);
  if (!match?.[1]) return null;
  const version = Number(match[1]);
  return Number.isSafeInteger(version) && version > 0 ? version : null;
}

function requiredInputs(targetId: PostgresMigrationTarget): PostgresRunbookInput[] {
  const inputs = [
    [
      'SOURCE_PGHOST',
      'Source host',
      false,
      'Reachable hostname or IP for the source PostgreSQL.',
      'source.example.internal',
    ],
    ['SOURCE_PGPORT', 'Source port', false, 'Source PostgreSQL TCP port.', '5432'],
    ['SOURCE_PGDATABASE', 'Source database', false, 'Database to export.', 'app'],
    [
      'SOURCE_PGUSER',
      'Source user',
      false,
      'Role with enough privileges to read all migrated objects.',
      'migration_reader',
    ],
    [
      'SOURCE_PGPASSFILE',
      'Source password file',
      true,
      'Local .pgpass-compatible file path. Its contents are never included in this runbook.',
      '/secure/source.pgpass',
    ],
    [
      'TARGET_PGHOST',
      'Target host',
      false,
      'Provisioned destination PostgreSQL hostname.',
      'target.example.internal',
    ],
    ['TARGET_PGPORT', 'Target port', false, 'Destination PostgreSQL TCP port.', '5432'],
    [
      'TARGET_PGDATABASE',
      'Target database',
      false,
      'Empty destination database prepared for restore.',
      'app',
    ],
    [
      'TARGET_PGUSER',
      'Target user',
      false,
      'Destination role with privileges to restore application objects.',
      'migration_writer',
    ],
    [
      'TARGET_PGPASSFILE',
      'Target password file',
      true,
      'Local .pgpass-compatible file path. Its contents are never included in this runbook.',
      '/secure/target.pgpass',
    ],
    [
      'REHEARSAL_DUMP_PATH',
      'Rehearsal dump path',
      false,
      'Local path for the rehearsal custom-format archive.',
      './postgres-rehearsal.dump',
    ],
    [
      'FINAL_DUMP_PATH',
      'Final dump path',
      false,
      'Local path for the cutover custom-format archive.',
      './postgres-final.dump',
    ],
    [
      'RESTORE_JOBS',
      'Restore jobs',
      false,
      'Parallel pg_restore worker count chosen for the target capacity.',
      '4',
    ],
    [
      'EXPECTED_MAX_DOWNTIME_MINUTES',
      'Downtime budget',
      false,
      'Maximum acceptable write-freeze window in minutes.',
      '30',
    ],
  ];
  if (targetId === 'gcp_cloud_sql_postgresql') {
    inputs.push(
      [
        'REHEARSAL_TOC_PATH',
        'Rehearsal archive list',
        false,
        'Reviewed pg_restore table-of-contents path used to omit Cloud SQL-incompatible extension statements.',
        './postgres-rehearsal.toc',
      ],
      [
        'FINAL_TOC_PATH',
        'Final archive list',
        false,
        'Reviewed pg_restore table-of-contents path used for the final Cloud SQL restore.',
        './postgres-final.toc',
      ],
    );
  }
  return inputs.map(([key, label, sensitive, description, placeholder]) => ({
    key: key as string,
    label: label as string,
    sensitive: sensitive as boolean,
    description: description as string,
    placeholder: placeholder as string,
  }));
}

function inventoryCommands(): PostgresRunbookCommand[] {
  return [
    command(
      'client-version',
      'Record local PostgreSQL client version',
      'pg_dump --version && pg_restore --version && psql --version',
    ),
    command(
      'source-version',
      'Read source PostgreSQL version',
      `${SOURCE_PSQL} --tuples-only --no-align --command='SHOW server_version;'`,
    ),
    command(
      'source-size',
      'Measure source database size',
      `${SOURCE_PSQL} --tuples-only --no-align --command='SELECT pg_database_size(current_database());'`,
    ),
    command(
      'source-extensions',
      'Inventory installed extensions',
      `${SOURCE_PSQL} --command='SELECT extname, extversion FROM pg_extension ORDER BY extname;'`,
    ),
    command(
      'source-roles',
      'Inventory role attributes without passwords',
      `${SOURCE_PSQL} --command='SELECT rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin FROM pg_roles ORDER BY rolname;'`,
    ),
  ];
}

function dumpCommand(
  pathVariable: 'REHEARSAL_DUMP_PATH' | 'FINAL_DUMP_PATH',
  id: string,
): PostgresRunbookCommand {
  return command(
    id,
    `Create ${pathVariable === 'FINAL_DUMP_PATH' ? 'final' : 'rehearsal'} custom-format dump`,
    `PGPASSFILE="\${SOURCE_PGPASSFILE}" pg_dump --host="\${SOURCE_PGHOST}" --port="\${SOURCE_PGPORT}" --username="\${SOURCE_PGUSER}" --dbname="\${SOURCE_PGDATABASE}" --format=custom --blobs --verbose --no-owner --no-acl --file="\${${pathVariable}}"`,
  );
}

function archiveListCommand(
  pathVariable: 'REHEARSAL_DUMP_PATH' | 'FINAL_DUMP_PATH',
  id: string,
  targetId: PostgresMigrationTarget,
): PostgresRunbookCommand {
  const tocVariable = pathVariable === 'FINAL_DUMP_PATH' ? 'FINAL_TOC_PATH' : 'REHEARSAL_TOC_PATH';
  return command(
    id,
    targetId === 'gcp_cloud_sql_postgresql'
      ? 'Create the Cloud SQL archive list for operator review'
      : 'Inspect archive table of contents',
    targetId === 'gcp_cloud_sql_postgresql'
      ? `pg_restore --list "\${${pathVariable}}" > "\${${tocVariable}}"`
      : `pg_restore --list "\${${pathVariable}}"`,
  );
}

function restoreCommand(
  pathVariable: 'REHEARSAL_DUMP_PATH' | 'FINAL_DUMP_PATH',
  id: string,
  targetId: PostgresMigrationTarget,
): PostgresRunbookCommand {
  const tocVariable = pathVariable === 'FINAL_DUMP_PATH' ? 'FINAL_TOC_PATH' : 'REHEARSAL_TOC_PATH';
  const reviewedToc =
    targetId === 'gcp_cloud_sql_postgresql' ? ` --use-list="\${${tocVariable}}"` : '';
  return command(
    id,
    `Restore ${pathVariable === 'FINAL_DUMP_PATH' ? 'final' : 'rehearsal'} archive into an empty target database`,
    `PGPASSFILE="\${TARGET_PGPASSFILE}" pg_restore --host="\${TARGET_PGHOST}" --port="\${TARGET_PGPORT}" --username="\${TARGET_PGUSER}" --dbname="\${TARGET_PGDATABASE}" --no-owner --no-acl --exit-on-error --jobs="\${RESTORE_JOBS}"${reviewedToc} --verbose "\${${pathVariable}}"`,
    true,
  );
}

function verificationCommands(prefix: string): PostgresRunbookCommand[] {
  return [
    command(
      `${prefix}-target-version`,
      'Read target PostgreSQL version',
      `${TARGET_PSQL} --tuples-only --no-align --command='SHOW server_version;'`,
    ),
    command(
      `${prefix}-target-extensions`,
      'Inventory target extensions',
      `${TARGET_PSQL} --command='SELECT extname, extversion FROM pg_extension ORDER BY extname;'`,
    ),
    command(
      `${prefix}-target-schema-counts`,
      'Count restored schema object kinds',
      `${TARGET_PSQL} --command="SELECT n.nspname, c.relkind, count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') GROUP BY n.nspname, c.relkind ORDER BY n.nspname, c.relkind;"`,
    ),
    command(
      `${prefix}-target-row-estimates`,
      'Record target table row estimates',
      `${TARGET_PSQL} --command='SELECT schemaname, relname, n_live_tup FROM pg_stat_user_tables ORDER BY schemaname, relname;'`,
    ),
    command(
      `${prefix}-target-sequences`,
      'Inventory restored sequences',
      `${TARGET_PSQL} --command='SELECT sequence_schema, sequence_name FROM information_schema.sequences ORDER BY sequence_schema, sequence_name;'`,
    ),
  ];
}

function phases(target: PostgresMigrationRunbookV1['target']): PostgresRunbookPhase[] {
  return [
    {
      id: 'preflight',
      order: 1,
      title: 'Collect inputs and verify native-tool suitability',
      objective:
        'Measure the source and decide whether an offline pg_dump/pg_restore cutover fits the downtime budget.',
      execution_owner: 'operator',
      downtime: 'none',
      commands: inventoryCommands(),
      checklist: [
        'Fill every required input outside this generated document; do not paste passwords into it.',
        'Confirm the pg_dump client major version is compatible with the source server and the target engine version supports the source objects.',
        'Compare measured database size and a timed rehearsal against the accepted downtime budget.',
        'If the native method cannot meet the downtime budget, stop and evaluate an online migration or logical-replication service.',
      ],
      verification: [
        'Source version, database size, extension list, and role inventory are captured in an access-controlled work log.',
        'Every source extension and required role has a documented target disposition.',
      ],
      rollback: ['No changes are made in this phase. Correct inputs and repeat the preflight.'],
    },
    {
      id: 'prepare-target',
      order: 2,
      title: `Prepare ${target.display_name}`,
      objective: 'Provision and configure an empty compatible target without changing the source.',
      execution_owner: 'operator',
      downtime: 'none',
      commands: [],
      checklist: [
        `Provision ${target.service} through an approved cloud workflow; this runbook does not call provider APIs.`,
        'Choose a supported PostgreSQL version, region, network path, storage size, backup policy, maintenance window, and high-availability policy.',
        'Create an empty target database and restore role ownership/privileges through the provider-supported role model.',
        target.id === 'gcp_cloud_sql_postgresql'
          ? 'Map supported extensions and review the pg_restore table of contents to omit extension statements that Cloud SQL instructs operators to remove.'
          : 'Install or enable each compatible extension before restore; document replacements for unsupported extensions.',
        'Restrict source and target network access to the migration operator and approved application paths.',
      ],
      verification: [
        'Target connectivity succeeds from the migration host using the target password file.',
        'The target database is empty and its version, extensions, encoding, locale, and timezone decisions are recorded.',
      ],
      rollback: [
        'Delete or quarantine only the newly provisioned empty target through the approved cloud workflow. Leave the source unchanged.',
      ],
    },
    {
      id: 'rehearsal',
      order: 3,
      title: 'Run a rehearsal dump and restore',
      objective: 'Measure duration and surface compatibility failures before the cutover window.',
      execution_owner: 'operator',
      downtime: 'none',
      commands: [
        dumpCommand('REHEARSAL_DUMP_PATH', 'rehearsal-dump'),
        archiveListCommand('REHEARSAL_DUMP_PATH', 'rehearsal-list', target.id),
        restoreCommand('REHEARSAL_DUMP_PATH', 'rehearsal-restore', target.id),
        ...verificationCommands('rehearsal'),
      ],
      checklist: [
        'Start with an empty rehearsal target database.',
        'Record dump, transfer, restore, index-build, analyze, and application-smoke-test durations separately.',
        'Treat pg_restore warnings and skipped objects as failures until reviewed.',
        ...(target.id === 'gcp_cloud_sql_postgresql'
          ? [
              'Review REHEARSAL_TOC_PATH and omit only the extension statements identified by the Cloud SQL import guidance.',
            ]
          : []),
      ],
      verification: [
        'Compare source and target schemas, extensions, table counts, row-count checks, and sequence state.',
        'Run application read/write smoke tests against the rehearsal target with production traffic still on the source.',
        'Confirm the measured final-cutover estimate fits EXPECTED_MAX_DOWNTIME_MINUTES.',
      ],
      rollback: [
        'Discard or recreate only the rehearsal target database. Production remains on the source.',
      ],
    },
    {
      id: 'final-export',
      order: 4,
      title: 'Freeze writes and create the final dump',
      objective:
        'Establish a single source-of-truth point and capture the final consistent archive.',
      execution_owner: 'operator',
      downtime: 'required',
      commands: [
        dumpCommand('FINAL_DUMP_PATH', 'final-dump'),
        archiveListCommand('FINAL_DUMP_PATH', 'final-list', target.id),
      ],
      checklist: [
        'Announce the cutover window and pause background jobs, schedulers, queues, and every application write path.',
        'Verify writes are actually stopped before starting the final dump.',
        'Record the exact freeze timestamp and final archive checksum in the controlled migration log.',
      ],
      verification: [
        'The final pg_dump command exits successfully and pg_restore can list the archive.',
        'No source writes occurred after the recorded freeze point.',
      ],
      rollback: [
        'If the dump fails, keep traffic off, correct the failure, and retry; or cancel the cutover and explicitly resume source writes.',
      ],
    },
    {
      id: 'final-restore',
      order: 5,
      title: 'Restore and validate the final target',
      objective:
        'Restore the frozen archive into a new empty target and prove data and behavior before traffic moves.',
      execution_owner: 'operator',
      downtime: 'required',
      commands: [
        restoreCommand('FINAL_DUMP_PATH', 'final-restore', target.id),
        ...verificationCommands('final'),
      ],
      checklist: [
        'Recreate an empty target database after the rehearsal using the provider-approved procedure.',
        'Do not use the target for application writes until every blocking verification passes.',
        'Run provider-recommended statistics maintenance if the restore path did not do so.',
      ],
      verification: [
        'Compare exact business-critical row counts or checksums selected by the application owner, not only planner estimates.',
        'Verify schema objects, constraints, indexes, functions, extensions, role grants, and sequence next values.',
        'Run application startup, read, write, transaction, background-job, and health-check smoke tests against the target.',
      ],
      rollback: [
        'Keep source writes frozen and production routing unchanged while the target is repaired or rebuilt from the final archive.',
      ],
    },
    {
      id: 'cutover',
      order: 6,
      title: 'Switch the application and observe',
      objective:
        'Move application connectivity to the verified target while preserving a controlled rollback path.',
      execution_owner: 'operator',
      downtime: 'required',
      commands: [],
      checklist: [
        'Update the destination secret/config store with the target connection value; never copy it into this runbook.',
        'Deploy or restart applications through the approved platform workflow and verify they connect only to the target.',
        'Resume background jobs only after foreground smoke tests pass.',
        'Keep the source read-only or write-frozen through the agreed observation window.',
      ],
      verification: [
        'Application health, representative reads/writes, error rate, latency, connection count, and job processing are acceptable.',
        'No application instance or operator is writing to the source.',
      ],
      rollback: [
        'Stop target writers before redirecting applications to the source.',
        'If the target accepted writes, reconcile or explicitly discard them before making the source authoritative again.',
        'Restore the previous application connection configuration, verify source health, then resume source writes once.',
      ],
    },
    {
      id: 'closeout',
      order: 7,
      title: 'Close the migration safely',
      objective: 'End the rollback window only after evidence and ownership are complete.',
      execution_owner: 'operator',
      downtime: 'none',
      commands: [],
      checklist: [
        'Capture final validation evidence, owner approval, target backup status, and monitoring ownership.',
        'Rotate temporary migration credentials and securely remove local password and dump files according to retention policy.',
        'Decommission the source only through a separately approved change after the rollback window expires.',
      ],
      verification: [
        'Target backups and restore tests are scheduled, alerts are active, and the application owner has accepted the target.',
      ],
      rollback: ['Do not decommission the source until the rollback window is formally closed.'],
    },
  ];
}

function checks(
  snapshot: ProjectMigrationSnapshotV1,
  service: MigrationService,
  postgresMajorVersion: number | null,
): PostgresRunbookCheck[] {
  const result: PostgresRunbookCheck[] = [
    {
      code: 'SOURCE_POSTGRES_SELECTED',
      level: 'pass',
      message: 'A Project-owned PostgreSQL source was selected.',
    },
    postgresMajorVersion === null
      ? {
          code: 'POSTGRES_MAJOR_VERSION_UNCONFIRMED',
          level: 'warning',
          message:
            'The PostgreSQL major version could not be inferred from the stored image reference.',
        }
      : {
          code: 'POSTGRES_MAJOR_VERSION_INFERRED',
          level: 'pass',
          message: `PostgreSQL major version ${String(postgresMajorVersion)} was inferred from the image reference and must be verified against the server.`,
        },
    {
      code: 'DATABASE_SIZE_MUST_BE_MEASURED',
      level: 'warning',
      message:
        'Logical database size and dump/restore duration are unknown until the operator runs preflight and rehearsal.',
    },
    {
      code: 'EXTENSION_COMPATIBILITY_UNVERIFIED',
      level: 'warning',
      message: 'Installed extensions and their destination compatibility have not been queried.',
    },
    {
      code: 'ROLE_MAPPING_REQUIRED',
      level: 'warning',
      message: 'Roles, ownership, and grants require an explicit destination mapping.',
    },
    {
      code: 'WRITE_FREEZE_REQUIRED',
      level: 'warning',
      message: 'This native dump/restore strategy requires a write freeze for the final cutover.',
    },
    {
      code: 'ONLINE_REPLICATION_NOT_INCLUDED',
      level: 'warning',
      message: 'Change-data-capture and logical replication are not included in this runbook.',
    },
    {
      code: 'CREDENTIALS_EXCLUDED',
      level: 'pass',
      message:
        'Credentials and secret values are excluded; command templates use placeholders and password files.',
    },
  ];
  const consumers = snapshot.service_connections.filter(
    (connection) => connection.service_id_provider === service.id,
  );
  if (consumers.length === 0) {
    result.push({
      code: 'APPLICATION_CONNECTION_NOT_OBSERVED',
      level: 'warning',
      message:
        'No Service Connection to the selected PostgreSQL was observed; application cutover ownership must be identified manually.',
    });
  }
  if (snapshot.runtime_inspection.status !== 'complete') {
    result.push({
      code: 'RUNTIME_INSPECTION_INCOMPLETE',
      level: 'warning',
      message:
        'Runtime inspection was partial or unavailable, so the stored source metadata must be verified.',
    });
  }
  return result.sort(
    (left, right) =>
      ({ blocker: 0, warning: 1, pass: 2 })[left.level] -
        { blocker: 0, warning: 1, pass: 2 }[right.level] ||
      left.code.localeCompare(right.code, 'en'),
  );
}

export function createPostgresMigrationRunbook(
  snapshot: ProjectMigrationSnapshotV1,
  service: MigrationService,
  targetId: PostgresMigrationTarget,
): PostgresMigrationRunbookV1 {
  const target = targetDetails[targetId];
  const postgresMajorVersion = parsePostgresMajorVersion(service.source.image_reference);
  const sourceConnections = snapshot.service_connections
    .filter((connection) => connection.service_id_provider === service.id)
    .map((connection) => connection.service_id_consumer)
    .sort((left, right) => left.localeCompare(right, 'en'));
  const sourceVolumes = snapshot.volumes
    .filter((volume) => volume.service_ids.includes(service.id))
    .map((volume) => volume.id)
    .sort((left, right) => left.localeCompare(right, 'en'));
  const readinessChecks = checks(snapshot, service, postgresMajorVersion);

  return {
    schema_version: POSTGRES_MIGRATION_RUNBOOK_SCHEMA_VERSION,
    generated_at: snapshot.generated_at,
    project: {
      id: snapshot.project.id,
      name: snapshot.project.name,
      display_name: snapshot.project.display_name,
    },
    source_service: {
      id: service.id,
      name: service.name,
      kind: 'postgres',
      ownership: 'project',
      image_reference: service.source.image_reference,
      postgres_major_version: postgresMajorVersion,
      runtime_status: service.runtime.status,
      connection_consumer_ids: sourceConnections,
      volume_ids: sourceVolumes,
    },
    target,
    strategy: {
      method: 'native_pg_dump_pg_restore',
      suitability: 'review_required',
      write_freeze_required: true,
      online_replication_included: false,
      database_size_bytes: null,
      note: 'Use the native method only after a timed rehearsal proves it fits the measured database size and accepted downtime budget.',
    },
    readiness: {
      status: readinessChecks.some((check) => check.level === 'blocker')
        ? 'blocked'
        : 'needs_input',
      checks: readinessChecks,
    },
    required_inputs: requiredInputs(targetId),
    phases: phases(target),
    execution_policy: {
      commands_executed: false,
      credentials_included: false,
      cloud_changes_made: false,
      data_copied: false,
      dns_changed: false,
    },
    limitations: [
      'OpenLander did not query database schemas, tables, rows, roles, extensions, WAL, or replication state.',
      'The generated commands are templates. An operator must review versions, quoting, paths, network access, permissions, and provider restrictions before execution.',
      'Native pg_dump/pg_restore does not copy writes that occur after the final dump snapshot; the final procedure therefore requires a verified write freeze.',
      'The runbook does not provision cloud resources, transfer dump files, change application secrets, switch DNS, or decommission the source.',
    ],
    references: [
      {
        title: 'PostgreSQL pg_dump documentation',
        url: 'https://www.postgresql.org/docs/current/app-pgdump.html',
      },
      {
        title: 'PostgreSQL pg_restore documentation',
        url: 'https://www.postgresql.org/docs/current/app-pgrestore.html',
      },
      ...(targetId === 'aws_rds_postgresql'
        ? [
            {
              title: 'AWS: Migrating PostgreSQL with pg_dump and pg_restore',
              url: 'https://docs.aws.amazon.com/dms/latest/sbs/chap-manageddatabases.postgresql-rds-postgresql-full-load-pd_dump.html',
            },
            {
              title: 'Amazon RDS: Importing data into PostgreSQL',
              url: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Procedural.Importing.html',
            },
          ]
        : [
            {
              title: 'Cloud SQL: Export and import using pg_dump and pg_restore',
              url: 'https://cloud.google.com/sql/docs/postgres/import-export/import-export-dmp',
            },
            {
              title: 'Cloud SQL: Data migration options',
              url: 'https://cloud.google.com/sql/docs/postgres/migrate-data-to-cloud-sql-instance',
            },
          ]),
    ],
  };
}
