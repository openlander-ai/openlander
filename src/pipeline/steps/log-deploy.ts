import { nanoid } from 'nanoid';

import type { Database } from '../../db/index.js';
import type { DeployTrigger } from '../types.js';

export interface LogDeployStepConfig {
  db: Database;
  projectId: string;
  status: 'success' | 'failed' | 'cancelled';
  trigger: DeployTrigger;
  commitSha?: string;
  buildLog?: string;
  durationMs?: number;
}

export function executeLogDeployStep(config: LogDeployStepConfig): void {
  config.db.createDeployLog({
    id: nanoid(12),
    projectId: config.projectId,
    status: config.status,
    trigger: config.trigger,
    commitSha: config.commitSha,
    buildLog: config.buildLog,
    durationMs: config.durationMs,
  });
}
