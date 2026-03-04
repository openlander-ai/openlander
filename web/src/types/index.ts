export interface Project {
  id: string;
  name: string;
  status: 'running' | 'stopped' | 'building' | 'error';
  visibility: 'internal' | 'quick-share' | 'production';
  repoUrl: string;
  branch?: string;
  port?: number;
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
  | { type: 'error'; error: string };

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
