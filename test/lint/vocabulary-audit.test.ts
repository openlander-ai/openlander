/**
 * Vocabulary audit — guardrails for the Project=group / Service=deployable model.
 *
 * Runtime/deploy actions belong to services only. Project composite keeps group
 * lifecycle, listing, and project-scoped configuration, but no deploy/runtime
 * *_project aliases.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MANAGED_SERVICE_ACTIONS,
  PROJECT_ACTIONS,
  SERVICE_ACTIONS,
} from '../../src/mcp/composite-tools.js';
import { VERSION } from '../../src/version.js';

const REPO_ROOT = resolve(__dirname, '..', '..');

const PROJECT_RUNTIME_ACTIONS_REMOVED = [
  'stop_project',
  'start_project',
  'restart_project',
  'redeploy_project',
  'rollback_project',
  'update_project_config',
] as const;

const FROZEN_PROJECT_GROUP_ACTIONS = [
  'create_project',
  'list_projects',
  'archive_project',
  'unarchive_project',
  'list_env_vars',
  'get_env_var',
  'set_env_vars',
  'export_env_vars',
  'delete_env_var',
  'bulk_delete_env_vars',
  'set_global_secret',
  'list_global_secrets',
  'upload_secret_file',
  'list_secret_files',
  'remove_secret_file',
  'expose_public',
  'unexpose_public',
] as const;

const FROZEN_MANAGED_SERVICE_ACTIONS = [
  'create_service',
  'list_services',
  'get_service_status',
  'get_service_credentials',
  'get_service_logs',
  'start_service',
  'stop_service',
  'remove_service',
  'backup_service',
  'restore_service',
  'list_service_backups',
  'create_service_user',
  'create_bucket',
  'list_buckets',
  'delete_bucket',
  'exec_service_container',
  'add_volume',
  'list_volumes',
  'remove_volume',
  'get_disk_usage',
  'cleanup_docker',
] as const;

const FROZEN_DEPLOYABLE_SERVICE_ACTIONS = [
  'list_archived_services',
  'archive_service',
  'unarchive_service',
  'restart_service',
  'redeploy_app',
  'rollback_service',
  'apply_route_config',
  'update_service_config',
  'update_application_source',
  'list_env_vars',
  'get_env_var',
  'set_env_vars',
  'export_env_vars',
  'delete_env_var',
  'bulk_delete_env_vars',
  'set_global_secret',
  'list_global_secrets',
  'upload_secret_file',
  'list_secret_files',
  'remove_secret_file',
  'expose_public',
  'unexpose_public',
  'add_domain_route',
  'list_domain_routes',
] as const;

describe('vocabulary-audit (Project=group / Service=deployable guardrail)', () => {
  it('PROJECT_ACTIONS contains only group/config actions', () => {
    const actions = PROJECT_ACTIONS as readonly string[];
    expect(actions).toEqual([...FROZEN_PROJECT_GROUP_ACTIONS]);
    for (const removed of PROJECT_RUNTIME_ACTIONS_REMOVED) {
      expect(actions, `${removed} must not return to openlander_project`).not.toContain(removed);
    }
  });

  it('SERVICE_ACTIONS contains the canonical deployable runtime actions', () => {
    const actions = SERVICE_ACTIONS as readonly string[];
    expect(actions).toEqual([...FROZEN_DEPLOYABLE_SERVICE_ACTIONS]);
    expect(actions).toEqual(
      expect.arrayContaining([
        'archive_service',
        'redeploy_app',
        'restart_service',
        'rollback_service',
        'apply_route_config',
        'update_service_config',
        'update_application_source',
      ]),
    );
  });

  it('MANAGED_SERVICE_ACTIONS remains the infrastructure-service surface', () => {
    expect(MANAGED_SERVICE_ACTIONS as readonly string[]).toEqual([
      ...FROZEN_MANAGED_SERVICE_ACTIONS,
    ]);
  });

  it('App.tsx exposes deployable and project-scoped infrastructure routes', () => {
    const source = readFileSync(resolve(REPO_ROOT, 'web', 'src', 'App.tsx'), 'utf8');
    expect(/<Route\s+path="\/services\/:id"/.test(source)).toBe(true);
    expect(/<Route\s+path="\/projects\/:p\/infrastructure\/:id"/.test(source)).toBe(true);
    expect(/<Route\s+path="\/managed-services/.test(source)).toBe(false);
    expect(/path="\/services"\s+element=\{<Navigate\s+to="\/projects"/.test(source)).toBe(true);
  });

  it('frontend API does not keep a global managed-services list helper', () => {
    const source = readFileSync(
      resolve(REPO_ROOT, 'web', 'src', 'lib', 'api', 'services.ts'),
      'utf8',
    );
    expect(/export\s+async\s+function\s+getServices/.test(source)).toBe(false);
    expect(/managedServices\s*=\s*\{[\s\S]*?\blist\s*:/.test(source)).toBe(false);
  });

  it('i18n key services.detail.header.backToServices still exists', () => {
    const en = readFileSync(resolve(REPO_ROOT, 'web', 'src', 'i18n', 'en.ts'), 'utf8');
    expect(/backToServices\s*:/.test(en)).toBe(true);
  });

  it('MCP serverInfo.version reads VERSION from package.json', () => {
    const versionTs = readFileSync(resolve(REPO_ROOT, 'src', 'version.ts'), 'utf8');
    expect(/export const VERSION/.test(versionTs)).toBe(true);

    const serverTs = readFileSync(resolve(REPO_ROOT, 'src', 'mcp', 'server.ts'), 'utf8');
    expect(/name:\s*'openlander',\s*version:\s*VERSION/.test(serverTs)).toBe(true);
    expect(typeof VERSION === 'string' && VERSION.length > 0).toBe(true);
  });

  it('project archived/default filters derive deployable service kinds from the shared set', () => {
    const projectRepo = readFileSync(
      resolve(REPO_ROOT, 'src', 'db', 'repos', 'project.repo.ts'),
      'utf8',
    );
    const serviceRepo = readFileSync(
      resolve(REPO_ROOT, 'src', 'db', 'repos', 'service.repo.ts'),
      'utf8',
    );

    expect(serviceRepo).toContain(
      "export const NON_DEPLOYABLE_SERVICE_KINDS = [...MANAGED_SERVICE_KINDS, 'compose-child'] as const;",
    );
    expect(projectRepo).not.toContain(
      "const NON_DEPLOYABLE_SERVICE_KINDS = [...MANAGED_SERVICE_KINDS, 'compose'] as const;",
    );
    expect(projectRepo).not.toMatch(
      /s\.kind NOT IN \('postgres', 'mysql', 'redis', 'mongo', 'minio'/,
    );
    expect(projectRepo.match(/deployableServiceKindFilter\(sql`s\.kind`\)/g)).toHaveLength(3);
  });
});
