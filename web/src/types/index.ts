export interface Project {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'building' | 'error';
  visibility: 'internal' | 'quick-share' | 'production';
  repoUrl: string;
  branch?: string;
  port?: number;
  previousImageTag?: string | null;
  url?: string;
  publicUrl?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export type ChatStreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'thinking' }
  | { type: 'tool_call'; toolName: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; success: boolean; result?: unknown; error?: string }
  | { type: 'message'; content: string }
  | { type: 'done'; toolResults?: ToolResult[] }
  | { type: 'error'; error: string }
  | {
      type: 'question';
      request: {
        id: string;
        questions: Array<{
          question: string;
          header?: string;
          options: Array<{ label: string; description?: string }>;
          multiple?: boolean;
        }>;
      };
    };
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
}

export interface SystemStats {
  cpu: number | { cores: number; usagePercent: number; loadAvg1m: number };
  memory: number | { totalMB: number; usedMB: number; usagePercent: number };
  uptime: number | { seconds: number; formatted: string };
  disk?: { totalGB: number; usedGB: number; usagePercent: number };
}

export interface DeployResult {
  success: boolean;
  projectId?: string;
  error?: string;
}

export interface DeployLogSummary {
  id: string;
  status: 'success' | 'failed' | 'cancelled';
  trigger: 'chat' | 'webhook' | 'api';
  commitSha: string | null;
  durationMs: number | null;
  createdAt: string;
}

export interface DeployLogDetail extends DeployLogSummary {
  projectId: string;
  buildLog: string | null;
}
