import { createModuleLogger } from '../lib/logger.js';
import { autoInjectServiceEnv } from './env-inject.js';
import { projectIdToDeployableServiceId } from '../db/service-ids.js';
import { kindToLegacyType } from '../db/repos/service.repo.js';
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
}

export interface ManagedServiceConnectResult {
  resolvedProjectId: string;
  autoInjectedEnvKeys: string[];
  droppedEnvVarKeys: string[];
  droppedSecretFiles: string[];
}

function serviceDependencyType(serviceKind: string): 'database' | 'cache' | 'custom' {
  const normalized = serviceKind === 'postgresql' ? 'postgres' : serviceKind;
  if (normalized === 'postgres' || normalized === 'mysql') {
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
    const { projectId, service, source, credentials } = params;

    const moved = await this.db.attachServiceToProject(service.id, projectId);
    const resolvedProjectId = moved.targetProjectId;

    await this.db.upsertServiceConnection({ projectId: resolvedProjectId, serviceId: service.id });
    const connection = await this.db.getServiceConnectionByProjectAndService(
      resolvedProjectId,
      service.id,
    );

    const serviceKind = service.type ?? kindToLegacyType(service.kind);
    const autoInjectedEnvKeys = await autoInjectServiceEnv({
      db: this.db,
      env: this.env,
      projectId: resolvedProjectId,
      serviceId: service.id,
      serviceName: service.name,
      serviceType: serviceKind,
      containerName: service.container_name ?? '',
      credentials,
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

    // Best-effort: a missing dependency edge must not fail the connect.
    try {
      await this.db.createProjectDependency({
        source_service_id: projectIdToDeployableServiceId(resolvedProjectId),
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
}
