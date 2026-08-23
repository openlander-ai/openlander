import { createModuleLogger } from '../lib/logger.js';
import { autoInjectServiceEnv, cleanupAutoInjectedEnv } from './env-inject.js';
import { kindToLegacyType } from '../db/repos/service.repo.js';
import { targetIdentityResolver } from '../db/target-identity-resolver.js';
import type { Database } from '../db/index.js';
import type { EnvManager } from './env.js';

const log = createModuleLogger('managed-service-linker');

export type ManagedServiceConnectSource = 'mcp' | 'web' | 'deploy_plan';

/** Minimal shape of the managed service being connected (a ServiceRow satisfies it). */
export interface ConnectableService {
  id: string;
  name: string;
  kind: string;
  type?: string | null;
  container_name: string | null;
}

export interface ManagedServiceConnectParams {
  projectId: string;
  /** The managed service to connect; the caller already holds it (created or loaded). */
  service: ConnectableService;
  /** Origin of the connect, for telemetry/audit. */
  source: ManagedServiceConnectSource;
  /**
   * Pre-parsed managed-service credentials for env auto-injection. Parsing lives
   * at the call site because the parser depends on tool-layer helpers; the linker
   * stays in the pipeline layer.
   */
  credentials?: Record<string, string>;
  /** Exact connection env selected before attach; persisted without renaming. */
  connectionEnv?: ReadonlyArray<{ key: string; value: string }>;
}

export interface ManagedServiceConnectResult {
  resolvedProjectId: string;
  autoInjectedEnvKeys: string[];
  droppedEnvVarKeys: string[];
  droppedSecretFiles: string[];
}

function serviceDependencyType(serviceKind: string): 'database' | 'cache' | 'custom' {
  const normalized = serviceKind === 'postgresql' ? 'postgres' : serviceKind;
  if (normalized === 'postgres' || normalized === 'mysql' || normalized === 'neo4j') {
    return 'database';
  }
  if (normalized === 'redis') {
    return 'cache';
  }
  return 'custom';
}

/**
 * Single owner of the "connect a managed service to a project" invariant.
 *
 * Previously each entry point (MCP create_service, REST connect route,
 * deploy-plan auto-provision) re-implemented this sequence and diverged — some
 * skipped env injection or dependency creation — which produced partially
 * linked services. Routing every caller through here keeps the steps in lockstep
 * and idempotent.
 */
export class ManagedServiceLinker {
  constructor(
    private readonly db: Database,
    private readonly env: EnvManager,
  ) {}

  /**
   * Attach the service to the project and wire it up: connection row, env
   * auto-injection, injected-key metadata, and a best-effort dependency edge.
   * Idempotent — re-running is a no-op: the connection upsert is conflict-safe
   * and the injected-key metadata is preserved when nothing new is injected.
   */
  async connect(params: ManagedServiceConnectParams): Promise<ManagedServiceConnectResult> {
    const { projectId, service, source, credentials, connectionEnv } = params;

    const moved = await this.db.attachServiceToProject(service.id, projectId);
    const resolvedProjectId = moved.targetProjectId;
    const serviceKind = service.type ?? kindToLegacyType(service.kind);

    // Resolve the REAL deployable workload that consumes this managed service.
    // Both the connection (service_id_consumer) and the dependency edge
    // (source_service_id) are FKs to services.id. getDeployablesByGroup finds the
    // row(s) by project_id — unlike the legacy `<projectId>__svc` derivation it
    // also matches a workload ATTACHED into the group under its own runtime __svc
    // id. Prefer the canonical <group>__svc when present, else the most recent.
    const workloads = await this.db.getDeployablesByGroup(resolvedProjectId);
    const canonicalId =
      targetIdentityResolver.deployableServiceIdForRuntimeProject(resolvedProjectId);
    const consumer = workloads.find((w) => w.id === canonicalId) ?? workloads[0];

    // Connection row — `service_id_consumer` is a FK to services.id, so it needs
    // a real consumer. A future app workload cannot satisfy this FK until its
    // services row exists, so empty groups skip FK-bearing rows for every source.
    let connection: Awaited<ReturnType<Database['getServiceConnectionByProjectAndService']>>;
    if (consumer) {
      await this.db.upsertServiceConnection({
        projectId: resolvedProjectId,
        serviceId: service.id,
        consumerServiceId: consumer.id,
      });
      connection = await this.db.getServiceConnectionByProjectAndService(
        resolvedProjectId,
        service.id,
      );
    } else {
      log.debug(
        { source, projectId: resolvedProjectId, serviceId: service.id },
        'Deferred managed-service connection row until a deployable workload exists',
      );
    }

    // Env injection always runs: autoInjectServiceEnv handles a group with no
    // deployable workload (project-scoped injection), so a DB-first flow still
    // seeds the env the app will read on its first deploy.
    const autoInjectedEnvKeys = await autoInjectServiceEnv({
      db: this.db,
      env: this.env,
      projectId: resolvedProjectId,
      serviceId: service.id,
      serviceName: service.name,
      serviceType: serviceKind,
      containerName: service.container_name ?? '',
      credentials,
      connectionEnv,
    });

    // Only (over)write the injected-key metadata when this call actually injected
    // something. On an idempotent re-connect autoInjectServiceEnv returns [] (the
    // env is already present); clobbering the saved keys with [] would strip the
    // record that disconnect cleanup relies on to remove the injected vars.
    if (connection && autoInjectedEnvKeys.length > 0) {
      await this.db.updateServiceConnection(connection.id, {
        autoInjectedEnvKeys: JSON.stringify(autoInjectedEnvKeys),
      });
    }

    // Dependency edge: only when a real consumer workload resolved — its source is
    // that workload's real services.id, never a derived `<projectId>__svc`. With
    // no workload there is no valid source, so skip (matches the prior behavior of
    // skipping when the deployable lookup came back empty). Best-effort.
    if (consumer) {
      try {
        await this.db.createProjectDependency({
          source_service_id: consumer.id,
          target_service_id: service.id,
          dependency_type: serviceDependencyType(serviceKind),
          source: 'auto',
        });
      } catch (err) {
        log.debug(
          { err, projectId: resolvedProjectId, serviceId: service.id },
          'Auto dependency sync failed',
        );
      }
    }

    log.debug(
      { source, projectId: resolvedProjectId, serviceId: service.id },
      'Managed service connected',
    );

    return {
      resolvedProjectId,
      autoInjectedEnvKeys,
      droppedEnvVarKeys: moved.droppedEnvVarKeys,
      droppedSecretFiles: moved.droppedSecretFiles,
    };
  }

  /**
   * Reverse of connect() for one (project, service) pair: remove the
   * auto-injected env, delete the connection row, and drop the auto-created
   * dependency edge. Idempotent — a no-op when the service isn't connected to
   * the project.
   */
  async disconnect(params: { projectId: string; serviceId: string }): Promise<void> {
    const { projectId, serviceId } = params;

    const connection = await this.db.getServiceConnectionByProjectAndService(projectId, serviceId);
    if (!connection) {
      return;
    }

    const parsed = JSON.parse(connection.auto_injected_env_keys ?? '[]') as unknown;
    const autoInjectedEnvKeys = Array.isArray(parsed)
      ? parsed.filter((key): key is string => typeof key === 'string')
      : [];
    await cleanupAutoInjectedEnv({
      db: this.db,
      env: this.env,
      projectId,
      autoInjectedEnvKeys,
    });

    await this.db.deleteServiceConnectionByProjectAndService(projectId, serviceId);

    // Best-effort: drop the auto-created dependency edge.
    try {
      const deps = await this.db.findDependenciesBySourceAndTargetService(
        connection.service_id_consumer,
        serviceId,
      );
      const matchingDep = deps.find(
        (d) => d.target_service_id === serviceId && d.source === 'auto',
      );
      if (matchingDep) {
        await this.db.deleteProjectDependency(matchingDep.id);
      }
    } catch (err) {
      log.debug({ err, projectId, serviceId }, 'Auto dependency cleanup failed');
    }
  }
}
