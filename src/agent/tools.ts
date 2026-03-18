import type { AppContext } from '../app.js';
import type { QuestionBridge } from './question-bridge.js';
import { toAiSdkTools } from '../tools/adapters/ai-sdk.js';
import { composeToolDefs } from '../tools/defs/compose.js';
import { debugToolDefs } from '../tools/defs/debug.js';
import { deployToolDefs } from '../tools/defs/deploy.js';
import { deployPlanToolDefs } from '../tools/defs/deploy-plan.js';
import { envToolDefs } from '../tools/defs/env.js';
import { gitToolDefs } from '../tools/defs/git.js';
import { infraToolDefs } from '../tools/defs/infra.js';
import { monitoringToolDefs } from '../tools/defs/monitoring.js';
import { projectOpsToolDefs } from '../tools/defs/project-ops.js';
import { serviceToolDefs } from '../tools/defs/service.js';
import type { ToolDef } from '../tools/defs/types.js';

const agentToolDefs: ToolDef[] = [
  ...deployToolDefs,
  ...deployPlanToolDefs,
  ...composeToolDefs,
  ...projectOpsToolDefs,
  ...envToolDefs,
  ...serviceToolDefs,
  ...infraToolDefs,
  ...gitToolDefs,
  ...monitoringToolDefs,
  ...debugToolDefs,
];

export function createTools(ctx: AppContext, questionBridge?: QuestionBridge) {
  return toAiSdkTools(agentToolDefs, ctx, questionBridge);
}
