import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { existsSync } from 'node:fs';
import type { ChatStreamEvent, AgentResponse } from '../agent/index.js';
import type { Alert } from '../monitor/alerts.js';
import type { SystemStats } from '../monitor/stats.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('ipc');

/**
 * OpenLander IPC Client.
 *
 * Thin client that talks to the daemon over a Unix socket.
 * Used by the CLI and any other client that needs to interact with OpenLander.
 *
 * All methods map 1:1 to the existing Hono API routes —
 * the only difference is transport (Unix socket instead of TCP).
 */

export interface Project {
  id: string;
  name: string;
  status: string;
  visibility: string;
  repoUrl: string | null;
  branch: string | null;
  port: number | null;
  url: string | null;
  publicUrl: string | null;
  createdAt: string;
  updatedAt: string;
  parentProjectId: string | null;
  isCompose: boolean;
  serviceCount: number;
}

export interface ActivityEvent {
  type: string;
  message: string;
  timestamp: string;
  projectId?: string;
  user: string;
}

export interface BuildProgressEvent {
  type: 'log' | 'status' | 'error' | 'complete';
  message: string;
  timestamp: string;
  projectId: string;
}

export interface ProjectStats {
  containerId: string;
  cpu: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
  pids: number;
}

export interface LogEntry {
  timestamp: string;
  stream: 'stdout' | 'stderr';
  message: string;
}

export interface SessionInfo {
  sessionId: string;
  messageCount: number;
  lastActivity: string;
  preview: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface DeployResponse {
  success: boolean;
  projectId: string;
  projectName: string;
  containerId?: string;
  url?: string;
  publicUrl?: string;
  port?: number;
  commitSha?: string;
  buildDurationMs?: number;
  error?: string;
}

export interface StartDeployResponse {
  projectId: string;
  projectName: string;
  status: string;
}

export type { SystemStats } from '../monitor/stats.js';

export interface HealthResponse {
  status: string;
  version: string;
  llmConfigured: boolean;
  timestamp: string;
  uptime: number;
  dockerContainers: number;
}

export interface ServerStatusResponse {
  containers: {
    total: number;
    managed: number;
    external: number;
  };
  portsInUse: number;
  proxy: {
    type: string;
    status: string;
    version?: string;
  };
  externalContainers: Array<{
    name: string;
    image: string;
    ports: number[];
  }>;
}

export class OpenLanderClient {
  constructor(private readonly socketPath: string) {}

  /** Check if the daemon is reachable. */
  async ping(): Promise<HealthResponse> {
    return this.get<HealthResponse>('/health');
  }

  /** Check if the daemon socket file exists. */
  isSocketPresent(): boolean {
    return existsSync(this.socketPath);
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  /** Send a chat message and get a full response. */
  async chat(message: string, sessionId: string): Promise<AgentResponse & { sessionId: string }> {
    return this.post<AgentResponse & { sessionId: string }>('/api/chat', {
      message,
      session_id: sessionId,
    });
  }

  /**
   * Send a chat message with streaming events (NDJSON over SSE).
   * Calls `onEvent` for each event as it arrives.
   */
  async chatStream(
    message: string,
    sessionId: string,
    onEvent: (event: ChatStreamEvent) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const body = JSON.stringify({ message, session_id: sessionId });

      const req = request(
        {
          socketPath: this.socketPath,
          path: '/api/chat/stream',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
            Accept: 'text/event-stream',
          },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 400) {
            let data = '';
            res.on('data', (chunk: Buffer) => {
              data += chunk.toString();
            });
            res.on('end', () => {
              reject(new Error(`Daemon error ${String(res.statusCode)}: ${data}`));
            });
            return;
          }

          let buffer = '';

          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString();

            // Parse SSE events
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            let currentData = '';
            for (const line of lines) {
              if (line.startsWith('data:')) {
                currentData = line.slice(5).trim();
              } else if (line === '' && currentData) {
                // Empty line = end of event
                try {
                  const event = JSON.parse(currentData) as ChatStreamEvent;
                  onEvent(event);
                } catch (err) {
                  log.debug({ err }, 'Skipping malformed SSE event');
                  // Skip malformed events
                }
                currentData = '';
              }
            }
          });

          res.on('end', resolve);
          res.on('error', reject);
        },
      );

      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('Daemon not running. Start with: openlander daemon'));
        } else {
          reject(err);
        }
      });

      req.write(body);
      req.end();
    });
  }

  // ---------------------------------------------------------------------------
  // Question Bridge (ask_user_question tool support)
  // ---------------------------------------------------------------------------

  /** Reply to a pending question from the agent. */
  async replyQuestion(
    requestId: string,
    answers: Array<{ questionIndex: number; selectedLabels: string[]; customText?: string }>,
  ): Promise<{ status: string }> {
    return this.post('/api/question/reply', { request_id: requestId, answers });
  }

  /** Dismiss a pending question without answering. */
  async dismissQuestion(): Promise<{ status: string }> {
    return this.post('/api/question/dismiss', {});
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  async listProjects(status?: string): Promise<{ count: number; projects: Project[] }> {
    const qs = status ? `?status=${status}` : '';
    return this.get(`/api/projects${qs}`);
  }

  async getProject(id: string): Promise<Project> {
    return this.get(`/api/projects/${id}`);
  }

  async deploy(
    repoUrl: string,
    options?: { branch?: string; name?: string; envVars?: Record<string, string> },
  ): Promise<DeployResponse> {
    return this.post('/api/projects/deploy', {
      repo_url: repoUrl,
      branch: options?.branch,
      name: options?.name,
      env_vars: options?.envVars,
    });
  }

  async startDeploy(
    repoUrl: string,
    options?: { branch?: string; name?: string },
  ): Promise<StartDeployResponse> {
    return this.post('/api/deploy/start', {
      repo_url: repoUrl,
      branch: options?.branch,
      name: options?.name,
    });
  }

  async stopProject(id: string): Promise<{ status: string }> {
    return this.post(`/api/projects/${id}/stop`, {});
  }

  async redeployProject(id: string): Promise<{ success: boolean }> {
    return this.post(`/api/projects/${id}/redeploy`, {});
  }

  async removeProject(id: string): Promise<{ status: string }> {
    return this.delete(`/api/projects/${id}`);
  }

  async exposeProject(id: string): Promise<{ publicUrl: string }> {
    return this.post(`/api/projects/${id}/expose`, {});
  }

  async unexposeProject(id: string): Promise<{ status: string }> {
    return this.post(`/api/projects/${id}/unexpose`, {});
  }

  async getProjectLogs(id: string, lines = 50): Promise<{ logs: string }> {
    return this.get(`/api/projects/${id}/logs?lines=${String(lines)}`);
  }

  async getProjectEnv(id: string): Promise<{ envVars: Record<string, string> }> {
    return this.get(`/api/projects/${id}/env`);
  }

  async setProjectEnv(id: string, variables: Record<string, string>): Promise<{ status: string }> {
    return this.post(`/api/projects/${id}/env`, { variables });
  }

  // ---------------------------------------------------------------------------
  // Activity & Build Progress
  // ---------------------------------------------------------------------------

  async getActivity(limit = 50): Promise<ActivityEvent[]> {
    const res = await this.get<{ activities: ActivityEvent[] }>(
      `/api/activity?limit=${String(limit)}`,
    );
    return res.activities;
  }

  async *streamActivity(signal?: AbortSignal): AsyncGenerator<ActivityEvent> {
    yield* this.streamNDJSON<ActivityEvent>('/api/activity/stream', signal);
  }

  async *streamBuildProgress(
    projectId: string,
    signal?: AbortSignal,
  ): AsyncGenerator<BuildProgressEvent> {
    yield* this.streamNDJSON<BuildProgressEvent>(`/api/projects/${projectId}/build/stream`, signal);
  }

  // ---------------------------------------------------------------------------
  // Container Stats
  // ---------------------------------------------------------------------------

  async getProjectStats(id: string): Promise<ProjectStats> {
    return this.get<ProjectStats>(`/api/projects/${id}/stats`);
  }

  // ---------------------------------------------------------------------------
  // Container Lifecycle
  // ---------------------------------------------------------------------------

  async startProject(id: string): Promise<{ status: string }> {
    return this.post<{ status: string }>(`/api/projects/${id}/start`, {});
  }

  // ---------------------------------------------------------------------------
  // Log Streaming
  // ---------------------------------------------------------------------------

  async *streamLogs(id: string, signal?: AbortSignal): AsyncGenerator<LogEntry> {
    yield* this.streamNDJSON<LogEntry>(`/api/projects/${id}/logs/stream`, signal);
  }

  // ---------------------------------------------------------------------------
  // Sessions & Chat History
  // ---------------------------------------------------------------------------

  async listSessions(): Promise<SessionInfo[]> {
    return this.get<SessionInfo[]>('/api/sessions');
  }

  async getSessionMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.get<ChatMessage[]>(`/api/sessions/${sessionId}/messages`);
  }

  // ---------------------------------------------------------------------------
  // System
  // ---------------------------------------------------------------------------

  async getSystemStats(): Promise<SystemStats> {
    return this.get('/api/system/stats');
  }

  // ---------------------------------------------------------------------------
  // Server Status (v0.0.9)
  // ---------------------------------------------------------------------------

  async getServerStatus(): Promise<ServerStatusResponse> {
    return this.get<ServerStatusResponse>('/api/server/status');
  }

  // Alerts
  // ---------------------------------------------------------------------------

  async getAlerts(): Promise<Alert[]> {
    const res = await this.get<{ alerts: Alert[] }>('/api/alerts');
    return res.alerts;
  }

  async dismissAlert(alertId: string): Promise<void> {
    await this.post<{ success: boolean }>(`/api/alerts/${alertId}/dismiss`, {});
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers (Unix socket transport)
  // ---------------------------------------------------------------------------

  private get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }

  private post<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('POST', path, body);
  }

  private delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  private async *streamNDJSON<T>(path: string, signal?: AbortSignal): AsyncGenerator<T> {
    const res = await new Promise<IncomingMessage>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error('Aborted'));
        return;
      }

      const req = request(
        {
          socketPath: this.socketPath,
          path,
          method: 'GET',
          headers: { Accept: 'application/x-ndjson' },
        },
        (response) => {
          if (response.statusCode && response.statusCode >= 400) {
            let data = '';
            response.on('data', (chunk: Buffer) => {
              data += chunk.toString();
            });
            response.on('end', () => {
              reject(new Error(`Daemon error ${String(response.statusCode)}: ${data}`));
            });
            return;
          }
          resolve(response);
        },
      );

      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('Daemon not running. Start with: openlander daemon'));
        } else {
          reject(err);
        }
      });

      signal?.addEventListener(
        'abort',
        () => {
          req.destroy();
          reject(new Error('Aborted'));
        },
        { once: true },
      );

      req.end();
    });

    let buffer = '';

    try {
      for await (const chunk of res) {
        buffer += (chunk as Buffer).toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            yield JSON.parse(trimmed) as T;
          } catch (err) {
            log.debug({ err, line: trimmed }, 'Skipping malformed NDJSON line');
            // Skip malformed lines
          }
        }
      }

      // Process remaining buffer
      if (buffer.trim()) {
        try {
          yield JSON.parse(buffer.trim()) as T;
        } catch (err) {
          log.debug({ err, buffer: buffer.trim() }, 'Skipping malformed trailing NDJSON data');
          // Skip malformed trailing data
        }
      }
    } finally {
      res.destroy();
    }
  }

  private request<T>(method: string, path: string, body?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const jsonBody = body ? JSON.stringify(body) : undefined;

      const req = request(
        {
          socketPath: this.socketPath,
          path,
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(jsonBody ? { 'Content-Length': String(Buffer.byteLength(jsonBody)) } : {}),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk.toString()));
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 400) {
              reject(new Error(`Daemon error ${String(res.statusCode)}: ${data}`));
              return;
            }
            try {
              resolve(JSON.parse(data) as T);
            } catch (err) {
              log.debug({ err, data: data.slice(0, 200) }, 'Invalid JSON from daemon');
              reject(new Error(`Invalid JSON from daemon: ${data.slice(0, 200)}`));
            }
          });
          res.on('error', reject);
        },
      );

      req.on('error', (err) => {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('Daemon not running. Start with: openlander daemon'));
        } else if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
          reject(new Error('Daemon not responding. Try: openlander daemon'));
        } else {
          reject(err);
        }
      });

      if (jsonBody) req.write(jsonBody);
      req.end();
    });
  }
}
