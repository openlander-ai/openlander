import { reportingOperations } from '../../operations/definitions/reporting.js';
import { operationToolDef } from './agent-delivery.js';
import type { ToolDef } from './types.js';

export const reportingOperationToolDefs: ToolDef[] = reportingOperations.map((definition) =>
  operationToolDef(definition),
);
