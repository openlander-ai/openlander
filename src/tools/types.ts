import type { z } from 'zod';

export type ToolParameterType = 'string' | 'number' | 'boolean';

export interface ToolParameter {
  type: ToolParameterType;
  description: string;
  required: boolean;
}

export type ToolTarget = 'agent' | 'mcp';

export interface ToolExecutionContext {
  target: ToolTarget;
}

export type ToolExecuteFn = (
  args: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<unknown> | unknown;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, ToolParameter>;
  inputSchema: z.ZodType<Record<string, unknown>>;
  execute: ToolExecuteFn;
  targets?: ToolTarget[];
}
