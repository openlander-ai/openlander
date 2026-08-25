import { z } from 'zod';

import type { ApplicationOperationDefinition } from '../types.js';

const nullableString = z.string().nullable();
const migrationServiceSchema = z
  .object({
    id: z.string(),
    project_id: z.string(),
    ownership: z.enum(['project', 'connected']),
    name: z.string(),
    kind: z.enum([
      'git',
      'image',
      'compose',
      'compose-child',
      'postgres',
      'mysql',
      'redis',
      'mongo',
      'neo4j',
      'minio',
    ]),
    runtime_role: z.enum(['application', 'job', 'resource']),
    parent_service_id: nullableString,
    archived_at: nullableString,
    source: z
      .object({
        type: z.string(),
        repo_url: nullableString,
        branch: nullableString,
        dockerfile_path: nullableString,
        docker_target: nullableString,
        build_context: nullableString,
        build_method: z.enum(['dockerfile', 'compose']).nullable(),
        image_reference: nullableString,
        image_id: nullableString,
        image_command: nullableString,
      })
      .strict(),
    runtime: z
      .object({
        status: nullableString,
        container_id: nullableString,
        container_name: nullableString,
        container_state: nullableString,
        container_status: nullableString,
        assigned_port: z.number().int().nullable(),
        container_port: z.number().int().nullable(),
        health_check_strategy: z.enum(['http', 'tcp', 'exec', 'none']).nullable(),
        health_check_path: nullableString,
        public_url: nullableString,
      })
      .strict(),
    last_deploy: z
      .object({
        deploy_id: z.string(),
        status: z.enum(['success', 'failed', 'cancelled']),
        commit_sha: nullableString,
        created_at: z.string(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const projectMigrationSnapshotSchema = z
  .object({
    schema_version: z.literal('openlander.project-migration/v1'),
    generated_at: z.string(),
    project: z
      .object({
        id: z.string(),
        name: z.string(),
        display_name: z.string(),
        description: nullableString,
        tags: z.array(z.string()),
        archived_at: nullableString,
      })
      .strict(),
    environments: z.array(
      z
        .object({
          id: z.string(),
          key: z.string(),
          display_name: z.string(),
          scope: z.enum(['project', 'service']),
          service_id: nullableString,
          tier: z.enum(['development', 'validation', 'production']).nullable(),
          promotion_order: z.number().int().nullable(),
          branch: nullableString,
          status: nullableString,
        })
        .strict(),
    ),
    services: z.array(migrationServiceSchema),
    service_connections: z.array(
      z
        .object({
          id: z.string(),
          service_id_consumer: z.string(),
          service_id_provider: z.string(),
          environment_id: nullableString,
          auto_injected_env_keys: z.array(z.string()),
        })
        .strict(),
    ),
    volumes: z.array(
      z
        .object({
          id: z.string(),
          name: nullableString,
          type: z.enum(['volume', 'bind']),
          source: z.string(),
          destination: nullableString,
          driver: nullableString,
          read_only: z.boolean(),
          size_bytes: z.number().nullable(),
          service_ids: z.array(z.string()),
        })
        .strict(),
    ),
    domain_routes: z.array(
      z
        .object({
          id: z.string(),
          service_id: z.string(),
          domain: z.string(),
          path_prefix: z.string(),
          upstream_path_prefix: nullableString,
          strip_prefix: z.boolean(),
          target_port: z.number().int().nullable(),
          tls_enabled: z.boolean().nullable(),
          status: z.enum(['active', 'pending', 'error']),
        })
        .strict(),
    ),
    environment_variables: z.array(
      z
        .object({
          key: z.string(),
          scope: z.enum(['project', 'service', 'environment']),
          service_id: nullableString,
          environment_id: nullableString,
          sensitive: z.boolean(),
          public: z.boolean(),
        })
        .strict(),
    ),
    secret_files: z.array(
      z
        .object({
          filename: z.string(),
          mount_path: z.string(),
          scope: z.literal('project'),
        })
        .strict(),
    ),
    runtime_inspection: z
      .object({
        status: z.enum(['complete', 'partial', 'unavailable']),
        checked_at: z.string(),
        container_count: z.number().int().nonnegative(),
        matched_container_count: z.number().int().nonnegative(),
        volume_count: z.number().int().nonnegative(),
        warnings: z.array(z.object({ code: z.string(), message: z.string() }).strict()),
      })
      .strict(),
    readiness: z
      .object({
        status: z.enum(['ready', 'needs_attention', 'blocked']),
        checks: z.array(
          z
            .object({
              code: z.string(),
              level: z.enum(['pass', 'warning', 'blocker']),
              message: z.string(),
              service_id: nullableString,
            })
            .strict(),
        ),
      })
      .strict(),
    export_policy: z
      .object({
        secret_values_included: z.literal(false),
        global_secrets_included: z.literal(false),
        secret_file_contents_included: z.literal(false),
        data_payloads_included: z.literal(false),
      })
      .strict(),
  })
  .strict();

export const getMigrationSnapshotOperation: ApplicationOperationDefinition = {
  name: 'get_migration_snapshot',
  version: 1,
  description:
    'Generate a provider-neutral Project migration snapshot without reading secret values or changing runtime/cloud resources.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org', 'project'],
  projectIdField: 'project_id',
  inputSchema: z.object({ project_id: z.string().min(1) }).strict(),
  outputSchema: z
    .object({
      status: z.literal('generated'),
      project_id: z.string(),
      snapshot: projectMigrationSnapshotSchema,
      _agent_guidance: z
        .object({ message: z.string(), next_steps: z.array(z.string()).max(3) })
        .strict(),
    })
    .strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => {
    const projectId = String(input['project_id']);
    const snapshot = await context.appCtx.projectMigrationService.createSnapshot(projectId);
    const issueCount = snapshot.readiness.checks.filter((check) => check.level !== 'pass').length;
    return {
      status: 'generated',
      project_id: projectId,
      snapshot,
      _agent_guidance: {
        message: `Migration snapshot generated with readiness ${snapshot.readiness.status} and ${String(issueCount)} issue(s). No cloud or runtime changes were made.`,
        next_steps: [
          'Review blockers and warnings before selecting a destination platform.',
          'Provide secret/config values directly to the destination; they are not included here.',
          'Plan logical export/import for each stateful data resource.',
        ],
      },
    };
  },
};
