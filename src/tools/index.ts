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
import { networkOperationToolDefs } from './defs/network-operations.js';
import { projectOpsToolDefs } from './defs/project-ops.js';
import { deliveryToolDefs } from './defs/delivery.js';
import { engagementToolDefs } from './defs/engagement.js';
import { agentDeliveryToolDefs, projectManifestToolDefs } from './defs/agent-delivery.js';
import { releaseOperationToolDefs } from './defs/release-operations.js';
import { reportingOperationToolDefs } from './defs/reporting-operations.js';
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
  networkOperationToolDefs,
  projectOpsToolDefs,
  deliveryToolDefs,
  engagementToolDefs,
  agentDeliveryToolDefs,
  projectManifestToolDefs,
  releaseOperationToolDefs,
  reportingOperationToolDefs,
  serviceToolDefs,
} from './defs/index.js';
export type { McpResultTransform, ToolContext, ToolDef, ToolTarget } from './defs/types.js';

const agentToolDefs: ToolDef[] = [
  ...deployToolDefs,
  ...deployableServiceToolDefs,
  ...deployPlanToolDefs,
  ...composeToolDefs,
  ...projectOpsToolDefs,
  ...deliveryToolDefs,
  ...engagementToolDefs,
  ...agentDeliveryToolDefs,
  ...projectManifestToolDefs,
  ...releaseOperationToolDefs,
  ...reportingOperationToolDefs,
  ...envToolDefs,
  ...serviceToolDefs,
  ...infraToolDefs,
  ...gitToolDefs,
  ...monitoringToolDefs,
  ...networkOperationToolDefs,
  ...debugToolDefs,
];

export function createTools(ctx: AppContext, questionBridge?: QuestionBridge) {
  return toAiSdkTools(agentToolDefs, ctx, questionBridge);
}
