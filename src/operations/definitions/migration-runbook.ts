import { z } from 'zod';

import type { ApplicationOperationDefinition } from '../types.js';

export const postgresMigrationTargetSchema = z.enum([
  'aws_rds_postgresql',
  'gcp_cloud_sql_postgresql',
]);

const postgresRunbookCommandSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    shell: z.string(),
    contains_placeholders: z.literal(true),
    mutates_source: z.literal(false),
    mutates_target: z.boolean(),
  })
  .strict();

export const postgresMigrationRunbookSchema = z
  .object({
    schema_version: z.literal('openlander.postgresql-migration-runbook/v1'),
    generated_at: z.string(),
    project: z.object({ id: z.string(), name: z.string(), display_name: z.string() }).strict(),
    source_service: z
      .object({
        id: z.string(),
        name: z.string(),
        kind: z.literal('postgres'),
        ownership: z.literal('project'),
        image_reference: z.string().nullable(),
        postgres_major_version: z.number().int().positive().nullable(),
        runtime_status: z.string().nullable(),
        connection_consumer_ids: z.array(z.string()),
        volume_ids: z.array(z.string()),
      })
      .strict(),
    target: z
      .object({
        id: postgresMigrationTargetSchema,
        provider: z.enum(['aws', 'gcp']),
        service: z.enum(['Amazon RDS for PostgreSQL', 'Cloud SQL for PostgreSQL']),
        display_name: z.string(),
      })
      .strict(),
    strategy: z
      .object({
        method: z.literal('native_pg_dump_pg_restore'),
        suitability: z.literal('review_required'),
        write_freeze_required: z.literal(true),
        online_replication_included: z.literal(false),
        database_size_bytes: z.null(),
        note: z.string(),
      })
      .strict(),
    readiness: z
      .object({
        status: z.enum(['needs_input', 'blocked']),
        checks: z.array(
          z
            .object({
              code: z.string(),
              level: z.enum(['pass', 'warning', 'blocker']),
              message: z.string(),
            })
            .strict(),
        ),
      })
      .strict(),
    required_inputs: z.array(
      z
        .object({
          key: z.string(),
          label: z.string(),
          sensitive: z.boolean(),
          description: z.string(),
          placeholder: z.string(),
        })
        .strict(),
    ),
    phases: z.array(
      z
        .object({
          id: z.string(),
          order: z.number().int().positive(),
          title: z.string(),
          objective: z.string(),
          execution_owner: z.literal('operator'),
          downtime: z.enum(['none', 'required']),
          commands: z.array(postgresRunbookCommandSchema),
          checklist: z.array(z.string()),
          verification: z.array(z.string()),
          rollback: z.array(z.string()),
        })
        .strict(),
    ),
    execution_policy: z
      .object({
        commands_executed: z.literal(false),
        credentials_included: z.literal(false),
        cloud_changes_made: z.literal(false),
        data_copied: z.literal(false),
        dns_changed: z.literal(false),
      })
      .strict(),
    limitations: z.array(z.string()),
    references: z.array(z.object({ title: z.string(), url: z.url() }).strict()),
  })
  .strict();

export const getMigrationRunbookOperation: ApplicationOperationDefinition = {
  name: 'get_migration_runbook',
  version: 1,
  description:
    'Generate a reviewed PostgreSQL pg_dump/pg_restore runbook for AWS RDS or Google Cloud SQL without executing commands, reading credentials, or changing resources.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z
    .object({
      project_id: z.string().min(1),
      target: postgresMigrationTargetSchema,
      service_id: z.string().min(1).optional(),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('generated'),
      project_id: z.string(),
      service_id: z.string(),
      runbook: postgresMigrationRunbookSchema,
      _agent_guidance: z
        .object({ message: z.string(), next_steps: z.array(z.string()).max(3) })
        .strict(),
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const projectId = String(input['project_id']);
    const target = postgresMigrationTargetSchema.parse(input['target']);
    const serviceId = typeof input['service_id'] === 'string' ? input['service_id'] : undefined;
    const runbook = await context.appCtx.projectMigrationService.createPostgresMigrationRunbook(
      projectId,
      target,
      serviceId,
    );
    return {
      status: 'generated',
      project_id: projectId,
      service_id: runbook.source_service.id,
      runbook,
      _agent_guidance: {
        message: `Generated a ${runbook.target.display_name} PostgreSQL migration runbook in ${runbook.readiness.status} state. No commands, cloud changes, data copy, credentials, or DNS changes were performed.`,
        next_steps: [
          'Resolve every required input and warning outside the generated document.',
          'Run the rehearsal and prove the measured duration fits the downtime budget.',
          'Obtain human approval before the write freeze and final cutover.',
        ],
      },
    };
  },
};
