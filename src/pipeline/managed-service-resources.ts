import { nanoid } from 'nanoid';

import type { Database, ServiceRow } from '../db/index.js';
import { isManagedServiceKind } from '../db/repos/service.repo.js';
import { withDeployLock } from '../db/repos/deploy-lock-helper.js';
import {
  ProjectNotFoundError,
  ServiceConfigError,
  ServiceContainerStateError,
  ServiceNotFoundError,
  ServiceOperationError,
  ServiceOperationUnsupportedError,
} from '../errors.js';
import { CONFIG_VERSION, deserializeConfig, serializeConfig } from './config-snapshot.js';
import { buildResourceLimitConfig } from './docker.js';
import { assertProjectMutable } from './mutation-policy.js';
import {
  applyResourceProfileUpdate,
  validateResourceProfileUpdate,
  type ResourceProfileUpdate,
} from './resource-limits-policy.js';
import type { RuntimeBackend } from './runtime/index.js';

async function resolveService(db: Database, serviceId: string): Promise<ServiceRow> {
  const service = await db.getService(serviceId);
  if (!service) throw new ServiceNotFoundError(serviceId);
  if (!isManagedServiceKind(service.kind)) {
    throw new ServiceOperationUnsupportedError('Update resource limits', service.kind);
  }
  if (!service.container_id && !service.container_name) {
    throw new ServiceContainerStateError(serviceId, 'missing');
  }
  return service;
}

export async function getManagedServiceResources(
  db: Database,
  runtime: RuntimeBackend,
  serviceId: string,
) {
  const service = await resolveService(db, serviceId);
  const info = await runtime.inspectContainer(service.container_id ?? service.container_name ?? '');
  const row = await db.loadDeployConfigForService(serviceId);
  const snapshot = row ? deserializeConfig(row.config_json)?.snapshot : undefined;
  const saved = buildResourceLimitConfig(snapshot?.resourceProfile, snapshot?.memoryLimitBytes);
  const limitBytes = info.HostConfig.Memory;
  if (typeof limitBytes !== 'number') {
    throw new ServiceContainerStateError(
      serviceId,
      'unknown',
      'Docker memory limit is unavailable.',
    );
  }
  return {
    // Inspect is authoritative, including old containers and out-of-band changes.
    profile:
      limitBytes > 0
        ? saved && saved.memoryLimitBytes === limitBytes
          ? saved.profile
          : ('custom' as const)
        : null,
    memory:
      limitBytes > 0
        ? {
            limitBytes,
            reservationBytes: info.HostConfig.MemoryReservation ?? 0,
            swapBytes: info.HostConfig.MemorySwap ?? 0,
          }
        : null,
    cpu: { shares: info.HostConfig.CpuShares ?? 0 },
    running: info.State.Running,
  };
}

export async function updateManagedServiceResources(
  db: Database,
  runtime: RuntimeBackend,
  serviceId: string,
  input: ResourceProfileUpdate,
) {
  const validationError = validateResourceProfileUpdate(input);
  if (validationError) throw new ServiceConfigError(validationError);
  const initialService = await resolveService(db, serviceId);
  return withDeployLock(
    db,
    {
      projectId: initialService.project_id,
      sessionId: `managed-resources-${nanoid()}`,
    },
    async () => {
      const service = await resolveService(db, serviceId);
      const project = await db.getProject(service.project_id);
      if (!project) throw new ProjectNotFoundError(service.project_id);
      const circuitOpen = await db.isCircuitBreakerOpen(service.project_id);
      assertProjectMutable(
        { ...project, archived_at: service.archived_at ?? project.archived_at },
        {
          db: { service, isCircuitBreakerOpen: () => circuitOpen },
        },
      );
      const containerId = service.container_id ?? service.container_name ?? '';
      const before = await runtime.inspectContainer(containerId);
      const previousMemory = before.HostConfig.Memory;
      if (typeof previousMemory !== 'number') {
        throw new ServiceContainerStateError(
          serviceId,
          'unknown',
          'Docker memory limit is unavailable.',
        );
      }
      const row = await db.loadDeployConfigForService(serviceId);
      const previousSnapshot = row ? (deserializeConfig(row.config_json)?.snapshot ?? {}) : {};
      const snapshot = applyResourceProfileUpdate(previousSnapshot, input);
      const memory = snapshot.memoryLimitBytes;
      if (!memory) throw new ServiceConfigError('A memory limit is required.');
      if (before.State.Running && (previousMemory === 0 || memory < previousMemory)) {
        throw new ServiceContainerStateError(
          serviceId,
          'running',
          'Stop the service before lowering its memory limit to avoid terminating the database.',
        );
      }
      await runtime.updateContainerMemory(containerId, memory);
      const applied = await runtime.inspectContainer(containerId);
      if (
        applied.HostConfig.Memory !== memory ||
        applied.HostConfig.MemorySwap !== memory ||
        applied.HostConfig.MemoryReservation !== Math.floor(memory * 0.5)
      ) {
        throw new ServiceOperationError(
          'update_resource_limits',
          'Docker did not apply the requested memory limit. Reload the current limits and retry.',
          {
            service_id: serviceId,
            requested_memory_bytes: memory,
            applied_memory_bytes: applied.HostConfig.Memory,
          },
        );
      }
      try {
        await db.saveDeployConfigForService(serviceId, serializeConfig(snapshot), CONFIG_VERSION);
      } catch (cause) {
        // Reverting a live increase could OOM the database. Keep the applied limit
        // and report the persistence failure so the operator can retry safely.
        throw new ServiceOperationError(
          'update_resource_limits',
          'Memory was applied to Docker, but could not be saved for recovery. Retry saving the limit.',
          { service_id: serviceId, applied_memory_bytes: memory, cause: String(cause) },
        );
      }
      await db.insertActivityLog({
        event_type: 'service:resources_updated',
        activity_type: 'config',
        severity: 'info',
        project_id: service.project_id,
        correlation_id: service.id,
        title: 'Service memory limit updated',
        description: `Memory limit for ${service.name} updated`,
        status: 'completed',
        metadata: JSON.stringify({
          service_id: serviceId,
          previous_memory_bytes: before.HostConfig.Memory,
          memory_bytes: memory,
        }),
      });
      return getManagedServiceResources(db, runtime, serviceId);
    },
  );
}
