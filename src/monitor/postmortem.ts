import type { Agent } from '../llm/agent.js';
import type { Database, DeployLogRow } from '../db/index.js';
import type { EventBus, EventPayload } from '../events/index.js';
import type { OpenLanderConfig } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('postmortem');

export interface PostmortemEntry {
  id?: string;
  projectId: string;
  projectName: string;
  markdown: string;
  createdAt: Date;
}

type Locale = 'en' | 'ko';

export class PostmortemGenerator {
  private readonly events: EventBus;
  private readonly db: Database;
  private readonly agent: Agent;
  private readonly config: OpenLanderConfig;
  private readonly postmortems = new Map<string, PostmortemEntry>();
  private unsubscribers: Array<() => void> = [];

  constructor(events: EventBus, db: Database, agent: Agent, config: OpenLanderConfig) {
    this.events = events;
    this.db = db;
    this.agent = agent;
    this.config = config;
  }

  /**
   * Get the current locale from config.
   * This allows the generator to respect runtime language changes.
   */
  private getCurrentLocale(): Locale {
    return this.config.language === 'ko' ? 'ko' : 'en';
  }

  start(): void {
    this.unsubscribers.push(
      this.events.on('recovery:success', (payload) => {
        void this.generatePostmortem(payload.projectId, true, payload);
      }),
      this.events.on('recovery:exhausted', (payload) => {
        void this.generatePostmortem(payload.projectId, false, payload);
      }),
    );
  }

  getLatest(projectId: string): PostmortemEntry | undefined {
    return this.postmortems.get(projectId);
  }

  listPostmortems(): Array<{
    id: string;
    projectId: string;
    projectName: string;
    createdAt: string;
  }> {
    return Array.from(this.postmortems.values()).map((p) => ({
      id: p.id ?? p.projectId,
      projectId: p.projectId,
      projectName: p.projectName,
      createdAt: p.createdAt.toISOString(),
    }));
  }

  getPostmortem(identifier: string): PostmortemEntry | undefined {
    const byId = this.postmortems.get(identifier);
    if (byId) return byId;
    return Array.from(this.postmortems.values()).find(
      (p) => p.projectId === identifier || p.projectName === identifier,
    );
  }

  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  private redactSecrets(text: string): string {
    const patterns = [
      /AKIA[0-9A-Z]{16}/g,
      /ASIA[0-9A-Z]{16}/g,
      /(gh[ps]_|gho_|ghu_|ghr_|github_pat_)[a-zA-Z0-9_]{20,}/g,
      /sk-[a-zA-Z0-9_-]{20,}/g,
      /sk_live_[a-zA-Z0-9]{20,}/g,
      /sk_test_[a-zA-Z0-9]{20,}/g,
      /xox[bps]-[0-9]+-[a-zA-Z0-9]+/g,
      /(postgres|mysql|mongodb):\/\/[^@\s]+:[^@\s]+@/g,
      /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
    ];
    let result = text;
    for (const pattern of patterns) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
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
      const rawBuildLog = latestLog?.build_log?.slice(-3000) ?? 'No build log available';
      const buildLogTail = this.redactSecrets(rawBuildLog);
      const errorMessage = ('lastError' in payload ? payload.lastError : undefined) ?? 'unknown';

      const attempts =
        'attempt' in payload
          ? payload.attempt
          : 'totalAttempts' in payload
            ? payload.totalAttempts
            : 0;
      const durationMs = 'durationMs' in payload ? payload.durationMs : 0;

      const locale = this.getCurrentLocale();
      const languageInstruction =
        locale === 'ko'
          ? 'Write the entire report in Korean (한국어). Keep technical identifiers (service names, URLs, ports, error codes) in English.'
          : 'Write the entire report in English.';

      const prompt = `You are generating an incident postmortem for an SRE audience.

${languageInstruction}

Tone and quality requirements:
- Write like a senior SRE incident report: direct, factual, actionable.
- Avoid filler and avoid vague language.
- Ground all claims in the given incident data and logs.

Output requirements (Markdown):
- Use clear headers.
- Include a timeline table with event, timestamp/sequence, and evidence.
- Include root cause analysis with "Immediate Cause", "Contributing Factors", and "Why It Escaped".
- Include remediation and prevention actions with owner and priority.
- Include a short "Next 24 Hours" checklist.

Required structure:
## Incident Summary
## Impact
## Timeline
| Sequence | Event | Evidence |
|----------|-------|----------|
## Root Cause Analysis
### Immediate Cause
### Contributing Factors
### Why It Escaped
## Remediation Completed
## Prevention Actions
| Action | Owner | Priority | Status |
|--------|-------|----------|--------|
## Next 24 Hours

Incident data:
- Project: ${projectName}
- Recovery Status: ${recovered ? 'success' : 'failed'}
- Attempts: ${String(attempts)}
- Recovery Duration: ${String(durationMs)}ms
- Last Error: ${errorMessage}

Build log tail (last 3000 chars, secrets redacted):
\`\`\`
${buildLogTail}
\`\`\``;

      const result = await this.agent.chat(prompt, `postmortem-${projectId}`);

      this.postmortems.set(projectId, {
        id: projectId,
        projectId,
        projectName,
        markdown: result.message,
        createdAt: new Date(),
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
