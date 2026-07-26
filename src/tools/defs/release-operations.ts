import { releaseOperations } from '../../operations/definitions/release.js';
import { operationToolDef } from './agent-delivery.js';
import type { ToolDef } from './types.js';

export const releaseOperationToolDefs: ToolDef[] = releaseOperations.map((definition) =>
  operationToolDef(definition, 'openlander_deploy'),
);
