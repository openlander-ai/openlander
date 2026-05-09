export type EnvironmentType = 'production' | 'development';

export interface Environment {
  id: string;
  projectId: string;
  type: EnvironmentType;
  branch: string | null;
  status: 'running' | 'stopped' | 'building' | 'error' | 'idle';
  assignedPort: number | null;
  containerId: string | null;
  imageTag: string | null;
  previousImageTag: string | null;
  publicUrl: string | null;
  url?: string;
  urls?: { url: string; type: 'lan' | 'vpn'; ip: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  /** Immutable slug used in routes/container identity. */
  name: string;
  /** Editable user-facing name. Defaults to `name` for older rows. */
  displayName?: string;
  display_name?: string;
  description?: string | null;
  tags?: string[];
  status: 'running' | 'stopped' | 'building' | 'error' | 'idle';
  visibility: 'internal' | 'quick-share' | 'shared' | 'production';
  port?: number;
  previousImageTag?: string | null;
  url?: string;
  urls?: { url: string; type: 'lan' | 'vpn'; ip: string }[];
  publicUrl?: string | null;
  accessCode?: string | null;
  createdAt: string;
  updatedAt: string;
  source?: 'git' | 'image';
  imageUrl?: string;
  imageCmd?: string[];
  containerPort?: number;
  parentProjectId?: string | null;
  isCompose?: boolean;
  serviceCount?: number;
  archived_at?: string | null;
}

export interface ProjectWithEnvironments extends Project {
  environments: Environment[];
}

export interface ToolResult {
  toolName: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export interface UsageSummary {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
}

export type ChatStreamEvent =
  | { type: 'session'; sessionId: string }
  | { type: 'thinking' }
  | { type: 'tool_call'; toolName: string; arguments: Record<string, unknown> }
  | { type: 'tool_result'; toolName: string; success: boolean; result?: unknown; error?: string }
  | { type: 'text_delta'; text: string }
  | { type: 'message'; content: string }
  | { type: 'done'; toolResults?: ToolResult[]; usage?: UsageSummary }
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
          metadata?: Record<string, unknown>;
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
  triggerDetail?: string | null;
  commitSha: string | null;
  commitMessage?: string | null;
  durationMs: number | null;
  createdAt: string;
  failureSummary?: string | null;
}

export interface DeployLogDetail extends DeployLogSummary {
  projectId: string;
  buildLog: string | null;
  runtimeLog: string | null;
}

export type DeploymentHistoryFilter = 'all' | 'failed' | 'success' | 'in_progress';

export interface DeploymentViewModel extends DeployLogSummary {
  failureSummary?: string | null;
  isInProgress?: boolean;
}

export * from './console';
