import type { AppContext } from '../app.js';
import type { QuestionBridge } from '../lib/question-bridge.js';
import type { ToolDef } from './defs/types.js';
import { toAiSdkTools } from './adapters/ai-sdk.js';
import { composeToolDefs } from './defs/compose.js';
import { debugToolDefs } from './defs/debug.js';
import { deployableServiceToolDefs } from './defs/deployable-service.js';
import { deployToolDefs } from './defs/deploy.js';
import { deployPlanToolDefs } from './defs/deploy-plan.js';
import { envToolDefs } from './defs/env.js';
import { gitToolDefs } from './defs/git.js';
import { infraToolDefs } from './defs/infra.js';
import { monitoringToolDefs } from './defs/monitoring.js';
import { projectOpsToolDefs } from './defs/project-ops.js';
import { serviceToolDefs } from './defs/service.js';

export { toAiSdkTools } from './adapters/ai-sdk.js';
export { registerCompositeMcpTools } from './adapters/mcp.js';
export {
  composeToolDefs,
  debugToolDefs,
  deployableServiceToolDefs,
  deployToolDefs,
  deployPlanToolDefs,
  envToolDefs,
  gitToolDefs,
  infraToolDefs,
  monitoringToolDefs,
  projectOpsToolDefs,
  serviceToolDefs,
} from './defs/index.js';
export type { McpResultTransform, ToolContext, ToolDef, ToolTarget } from './defs/types.js';

const agentToolDefs: ToolDef[] = [
  ...deployToolDefs,
  ...deployableServiceToolDefs,
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
