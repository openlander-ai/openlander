import { networkMaintenanceOperations } from '../../operations/definitions/network-maintenance.js';
import { operationToolDef } from './agent-delivery.js';
import type { ToolDef } from './types.js';

export const networkOperationToolDefs: ToolDef[] = networkMaintenanceOperations.map((definition) =>
  operationToolDef(
    definition,
    'openlander_monitor',
    definition.name === 'remove_unused_docker_network' ? 'high' : 'low',
  ),
);
