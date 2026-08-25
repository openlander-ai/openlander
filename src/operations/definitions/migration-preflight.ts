import { z } from 'zod';

import type { ApplicationOperationDefinition } from '../types.js';

const preflightCheckSchema = z
  .object({
    code: z.string(),
    level: z.enum(['pass', 'warning', 'blocker']),
    message: z.string(),
  })
  .strict();

const postgresMigrationPreflightSchema = z
  .object({
    schema_version: z.literal('openlander.postgresql-preflight/v1'),
    generated_at: z.string(),
    project: z.object({ id: z.string(), name: z.string(), display_name: z.string() }).strict(),
    source_service: z
      .object({
        id: z.string(),
        name: z.string(),
        kind: z.literal('postgres'),
        runtime_status: z.string().nullable(),
      })
      .strict(),
    metadata: z
      .object({
        server_version: z.string(),
        server_version_num: z.number().int().nonnegative(),
        server_major_version: z.number().int().nonnegative(),
        database_name: z.string(),
        database_size_bytes: z.number().nonnegative(),
        encoding: z.string(),
        collate: z.string(),
        ctype: z.string(),
        schema_count: z.number().int().nonnegative(),
        relation_count: z.number().int().nonnegative(),
        table_count: z.number().int().nonnegative(),
        sequence_count: z.number().int().nonnegative(),
        estimated_row_count: z.number().nonnegative(),
        extensions: z.array(z.object({ name: z.string(), version: z.string() }).strict()),
        roles: z.array(
          z
            .object({
              name: z.string(),
              can_login: z.boolean(),
              superuser: z.boolean(),
              create_role: z.boolean(),
              create_database: z.boolean(),
            })
            .strict(),
        ),
        roles_truncated: z.boolean(),
      })
      .strict(),
    readiness: z
      .object({
        status: z.enum(['ready_for_rehearsal', 'blocked']),
        checks: z.array(preflightCheckSchema),
      })
      .strict(),
    inspection_policy: z
      .object({
        read_only: z.literal(true),
        row_contents_read: z.literal(false),
        credentials_included: z.literal(false),
        secret_values_included: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const getMigrationPreflightOperation: ApplicationOperationDefinition = {
  name: 'get_migration_preflight',
  version: 1,
  description:
    'Inspect Project-owned PostgreSQL version, size, extensions, roles, and logical object counts without reading row contents or returning credentials.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z
    .object({
      project_id: z.string().min(1),
      service_id: z.string().min(1).optional(),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('inspected'),
      project_id: z.string(),
      service_id: z.string(),
      preflight: postgresMigrationPreflightSchema,
      _agent_guidance: z
        .object({ message: z.string(), next_steps: z.array(z.string()).max(3) })
        .strict(),
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const projectId = String(input['project_id']);
    const serviceId = typeof input['service_id'] === 'string' ? input['service_id'] : undefined;
    const preflight = await context.appCtx.projectMigrationService.createPostgresMigrationPreflight(
      projectId,
      serviceId,
    );
    return {
      status: 'inspected',
      project_id: projectId,
      service_id: preflight.source_service.id,
      preflight,
      _agent_guidance: {
        message:
          'PostgreSQL source metadata was inspected read-only. No row contents, credentials, cloud resources, data copy, or DNS changes were involved.',
        next_steps: [
          'Review extension availability and the cluster-global roles that a database dump will not recreate.',
          'Use the OpenLander Web migration dialog for a human-confirmed rehearsal against a fresh empty target.',
        ],
      },
    };
  },
};
