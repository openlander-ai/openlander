import type { Agent } from '../agent/index.js';
import type { Database, DeployLogRow } from '../db/index.js';
import type { EventBus, EventPayload } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('postmortem');

interface PostmortemEntry {
  projectId: string;
  projectName: string;
  markdown: string;
  generatedAt: Date;
}

export class PostmortemGenerator {
  private readonly events: EventBus;
  private readonly db: Database;
  private readonly agent: Agent;
  private readonly postmortems = new Map<string, PostmortemEntry>();

  constructor(events: EventBus, db: Database, agent: Agent) {
    this.events = events;
    this.db = db;
    this.agent = agent;
  }

  start(): void {
    this.events.on('recovery:success', (payload) => {
      void this.generatePostmortem(payload.projectId, true, payload);
    });

    this.events.on('recovery:exhausted', (payload) => {
      void this.generatePostmortem(payload.projectId, false, payload);
    });
  }

  getLatest(projectId: string): PostmortemEntry | undefined {
    return this.postmortems.get(projectId);
  }

  private async generatePostmortem(
    projectId: string,
    recovered: boolean,
    payload: EventPayload['recovery:success'] | EventPayload['recovery:exhausted'],
  ): Promise<void> {
    try {
      const project = this.db.getProject(projectId);
      const projectName = project?.name ?? projectId;

      const logs = this.db.getDeployLogs(projectId, 1);
      const latestLog: DeployLogRow | undefined = logs[0];
      const buildLogTail = latestLog?.build_log?.slice(-3000) ?? 'No build log available';
      const errorMessage = 'lastError' in payload ? payload.lastError : 'unknown';

      const attempts =
        'attempt' in payload
          ? payload.attempt
          : 'totalAttempts' in payload
            ? payload.totalAttempts
            : 0;
      const durationMs = 'durationMs' in payload ? payload.durationMs : 0;

      const prompt = `Generate a postmortem markdown for this incident.
Project: ${projectName}, Error: ${errorMessage}, Build log (last 3000 chars): ${buildLogTail}
Recovery: ${recovered ? 'success' : 'failed'}, Attempts: ${String(attempts)}, Duration: ${String(durationMs)}ms

Format:
# 장애 포스트모템 — ${projectName}
## 타임라인
## 근본 원인
## 수정 내용
## 예방 조치`;

      const result = await this.agent.chat(prompt, `postmortem-${projectId}`);

      this.postmortems.set(projectId, {
        projectId,
        projectName,
        markdown: result.message,
        generatedAt: new Date(),
      });

      log.info({ projectId }, 'Postmortem generated');
    } catch (error) {
      log.error({ error, projectId }, 'Failed to generate postmortem');
    }
  }
}

let instance: PostmortemGenerator | null = null;

export function setPostmortemInstance(newInstance: PostmortemGenerator): void {
  instance = newInstance;
}

export function getPostmortemInstance(): PostmortemGenerator | null {
  return instance;
}
