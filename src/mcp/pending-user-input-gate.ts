import type { ToolContext, ToolDef } from '../tools/defs/types.js';
import { resolveMcpScopeTarget } from './scope-policy.js';

interface PendingInputBlock {
  status: 'blocked';
  error: 'USER_INPUT_REQUIRED';
  code: 'USER_INPUT_REQUIRED';
  blocked_action: string;
  field: string;
  fields: string[];
  service_id: string | null;
  project_id: string | null;
  message: string;
  report_to_user: {
    status: 'needs_user_input';
    message: string;
  };
  safe_alternatives: Array<{
    tool: string;
    action: string;
    effect: 'read_only';
  }>;
  _agent_guidance: {
    message: string;
    next_steps: string[];
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractEnvKeys(value: unknown): string[] {
  const parsed = typeof value === 'string' ? parseJsonRecord(value) : asRecord(value);
  if (!parsed) return [];
  return [...new Set(Object.keys(parsed).filter((key) => key.trim().length > 0))];
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function envKeysForAction(def: ToolDef, args: Record<string, unknown>): string[] {
  if (def.name === 'set_env_vars') {
    return extractEnvKeys(args['variables']);
  }
  if (def.name === 'update_app' || def.name === 'redeploy_app') {
    return extractEnvKeys(args['env_vars']);
  }
  return [];
}

function shouldCheckProjectScope(def: ToolDef, args: Record<string, unknown>): boolean {
  if (def.name !== 'set_env_vars') return false;
  return args['scope'] === 'project' || args['scope'] === 'project_environment';
}

function buildBlockResponse(input: {
  action: string;
  fields: string[];
  serviceId: string | null;
  projectId: string | null;
}): PendingInputBlock {
  const field = input.fields[0] ?? 'required field';
  const message = `${field} requires a user-provided value before OpenLander will apply this mutation.`;
  return {
    status: 'blocked',
    error: 'USER_INPUT_REQUIRED',
    code: 'USER_INPUT_REQUIRED',
    blocked_action: input.action,
    field,
    fields: input.fields,
    service_id: input.serviceId,
    project_id: input.projectId,
    message,
    report_to_user: {
      status: 'needs_user_input',
      message: `Please provide the correct ${field} value. I should not guess or invent one.`,
    },
    safe_alternatives: [
      {
        tool: 'openlander_monitor',
        action: 'diagnose_service',
        effect: 'read_only',
      },
    ],
    _agent_guidance: {
      message,
      next_steps: [
        'Report report_to_user.message to the user.',
        'Do not retry with a guessed value.',
        'After the user provides the value in the Web UI, call diagnose_service again.',
      ],
    },
  };
}

export async function maybeRejectPendingUserInput(
  def: ToolDef,
  args: Record<string, unknown>,
  context: ToolContext,
): Promise<PendingInputBlock | undefined> {
  if (context.target !== 'mcp') return undefined;

  const keys = envKeysForAction(def, args);
  if (keys.length === 0) return undefined;

  const target = await resolveMcpScopeTarget(context.appCtx, args, context.identity);
  if (!target?.projectId) return undefined;

  const pending = shouldCheckProjectScope(def, args)
    ? await context.appCtx.db.listPendingAiOpsInputsForProjectKeys(target.projectId, keys)
    : target.serviceId
      ? await context.appCtx.db.listPendingAiOpsInputsForServiceKeys(target.serviceId, keys)
      : await context.appCtx.db.listPendingAiOpsInputsForProjectKeys(target.projectId, keys);

  if (pending.length === 0) return undefined;
  const fields = [...new Set(pending.map((row) => row.field))];
  return buildBlockResponse({
    action: def.name,
    fields,
    serviceId: target.serviceId,
    projectId: target.projectId,
  });
}
