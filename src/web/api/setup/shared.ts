import type { LanguageModel, ToolSet } from 'ai';

import type { AppContext } from '../../../app.js';
import type { OpenLanderConfig } from '../../../config/index.js';
import { Agent } from '../../../llm/agent.js';
import { createModel } from '../../../llm/index.js';
import { buildContextSnapshot } from '../../../llm/prompts.js';
import { mergeWithMcpTools } from '../../../mcp/client-manager.js';
import { createTools } from '../../../tools/index.js';

export async function mergeToolsIfMcpEnabled(
  ctx: AppContext,
  baseTools: ToolSet,
): Promise<ToolSet> {
  if (ctx.config.mcp.enabled && ctx.mcpClientManager.connectedCount > 0) {
    return mergeWithMcpTools(baseTools, ctx.mcpClientManager);
  }

  return baseTools;
}

export async function reloadAgent(
  ctx: AppContext,
  options: {
    provider: OpenLanderConfig['llm']['provider'];
    apiKey: string;
    authToken?: string;
    model: string;
    language: 'en' | 'ko';
  },
): Promise<LanguageModel> {
  const llmModel = createModel({
    provider: options.provider,
    apiKey: options.apiKey,
    authToken: options.authToken,
    model: options.model,
  });

  const agent = new Agent(
    llmModel,
    ctx.db,
    async () => buildContextSnapshot(ctx.db, ctx.docker),
    options.provider,
    options.language,
  );

  const tools = await mergeToolsIfMcpEnabled(ctx, createTools(ctx, ctx.questionBridge));
  agent.setTools(tools);
  agent.setQuestionBridge(ctx.questionBridge);

  ctx.agent = agent;

  return llmModel;
}
