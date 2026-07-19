import type { Database, ServiceRow } from '../db/index.js';
import { ServiceConfigError, ServiceNotFoundError } from '../errors.js';

export interface ComposeRedeployTarget {
  service: ServiceRow;
  composeServices?: string[];
}

export function composeChildServiceName(service: Pick<ServiceRow, 'name'>): string {
  return (
    service.name
      .replace(/__svc$/, '')
      .split('/')
      .at(-1) ?? service.name
  );
}

/**
 * A Compose child is not an independently reproducible workload. Resolve it to
 * the parent Compose service and carry the requested child as a selective
 * Compose deployment target.
 */
export async function resolveComposeRedeployTarget(
  db: Pick<Database, 'getService'>,
  service: ServiceRow,
): Promise<ComposeRedeployTarget> {
  if (service.kind !== 'compose-child') {
    return { service };
  }

  const parentServiceId = service.parent_service_id;
  if (!parentServiceId) {
    throw new ServiceConfigError('Compose child is missing its parent service reference.', {
      serviceId: service.id,
    });
  }

  const parentService = await db.getService(parentServiceId);
  if (!parentService) {
    throw new ServiceNotFoundError(parentServiceId);
  }
  if (parentService.kind !== 'compose') {
    throw new ServiceConfigError('Compose child parent is not a Compose workload.', {
      serviceId: service.id,
      parentServiceId,
      parentKind: parentService.kind,
    });
  }

  return {
    service: parentService,
    composeServices: [composeChildServiceName(service)],
  };
}
