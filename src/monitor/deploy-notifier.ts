import type { ChannelManager } from '../channels/base.js';
import type { Database } from '../db/index.js';
import type { EventBus, EventPayload } from '../events/index.js';
import type { OpenLanderConfig } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('deploy-notifier');

type Locale = 'en' | 'ko';

export class DeployNotifier {
  private readonly channelManager: ChannelManager;
  private readonly events: EventBus;
  private readonly db: Database;
  private readonly config: OpenLanderConfig;
  private unsubscribers: Array<() => void> = [];

  constructor(
    channelManager: ChannelManager,
    events: EventBus,
    db: Database,
    config: OpenLanderConfig,
  ) {
    this.channelManager = channelManager;
    this.events = events;
    this.db = db;
    this.config = config;
  }

  private getCurrentLocale(): Locale {
    return this.config.language === 'ko' ? 'ko' : 'en';
  }

  start(): void {
    this.unsubscribers.push(
      this.events.on('deploy:success', (payload) => {
        void this.notifySuccess(payload);
      }),
      this.events.on('deploy:failed', (payload) => {
        void this.notifyFailure(payload);
      }),
    );
  }

  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
  }

  private resolveProjectName(projectId: string): string {
    const project = this.db.getProject(projectId);
    return project?.name ?? projectId;
  }

  private async notifySuccess(payload: EventPayload['deploy:success']): Promise<void> {
    if (payload.parentProjectId) {
      return;
    }

    const projectName = this.resolveProjectName(payload.projectId);
    const durationSec = Math.max(1, Math.round(payload.totalDurationMs / 1000));
    const message = this.formatSuccessMessage(projectName, payload.url, durationSec);

    try {
      await this.channelManager.broadcast(message);
    } catch (error) {
      log.error({ error, projectId: payload.projectId }, 'Failed to broadcast deploy success');
    }
  }

  private async notifyFailure(payload: EventPayload['deploy:failed']): Promise<void> {
    if (payload.parentProjectId) {
      return;
    }

    const projectName = this.resolveProjectName(payload.projectId);
    const message = this.formatFailureMessage(projectName, payload.step, payload.error);

    try {
      await this.channelManager.broadcast(message);
    } catch (error) {
      log.error({ error, projectId: payload.projectId }, 'Failed to broadcast deploy failure');
    }
  }

  private formatSuccessMessage(projectName: string, url: string, durationSec: number): string {
    const locale = this.getCurrentLocale();

    if (locale === 'ko') {
      return [`✅ 배포 성공 — ${projectName}`, `🔗 ${url}`, `⏱ ${String(durationSec)}초`].join(
        '\n',
      );
    }

    return [`✅ Deploy succeeded — ${projectName}`, `🔗 ${url}`, `⏱ ${String(durationSec)}s`].join(
      '\n',
    );
  }

  private formatFailureMessage(projectName: string, step: string, error: string): string {
    const locale = this.getCurrentLocale();
    const truncatedError = error.length > 500 ? `${error.slice(0, 500)}...` : error;

    if (locale === 'ko') {
      return [`❌ 배포 실패 — ${projectName}`, `📍 단계: ${step}`, `📝 ${truncatedError}`].join(
        '\n',
      );
    }

    return [`❌ Deploy failed — ${projectName}`, `📍 Step: ${step}`, `📝 ${truncatedError}`].join(
      '\n',
    );
  }
}
