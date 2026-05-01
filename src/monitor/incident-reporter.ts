import type { ChannelManager } from '../channels/base.js';
import type { Database } from '../db/index.js';
import type { EventBus, EventPayload } from '../events/index.js';
import type { OpenLanderConfig } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('incident-reporter');

interface IncidentState {
  projectId: string;
  projectName: string;
  failedAt: Date;
  lastError: string;
  attempt: number;
}

type Locale = 'en' | 'ko';

export class IncidentReporter {
  private readonly channelManager: ChannelManager;
  private readonly events: EventBus;
  private readonly db: Database;
  private readonly config: OpenLanderConfig;
  private readonly incidents = new Map<string, IncidentState>();
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

  /**
   * Get the current locale from config.
   * This allows the reporter to respect runtime language changes.
   */
  private getCurrentLocale(): Locale {
    return this.config.language === 'ko' ? 'ko' : 'en';
  }

  start(): void {
    this.unsubscribers.push(
      this.events.on('recovery:start', (payload) => {
        this.trackRecoveryStart(payload);
      }),
      this.events.on('recovery:failed', (payload) => {
        this.trackRecoveryFailure(payload);
      }),
      this.events.on('recovery:success', (payload) => {
        void this.reportRecoverySuccess(payload);
      }),
      this.events.on('recovery:exhausted', (payload) => {
        void this.reportRecoveryExhausted(payload);
      }),
      this.events.on('recovery:degraded', (payload) => {
        this.trackRecoveryDegraded(payload);
      }),
    );
  }

  stop(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.incidents.clear();
  }

  private trackRecoveryDegraded(payload: EventPayload['recovery:degraded']): void {
    log.warn(
      {
        projectId: payload.projectId,
        stage: payload.stage,
        reason: payload.reason,
        metadata: payload.metadata,
      },
      'recovery:degraded — partial failure observed during recovery stage',
    );
  }

  private trackRecoveryStart(payload: EventPayload['recovery:start']): void {
    const current = this.incidents.get(payload.projectId);
    const projectName = this.resolveProjectName(payload.projectId);

    this.incidents.set(payload.projectId, {
      projectId: payload.projectId,
      projectName,
      failedAt: current?.failedAt ?? new Date(),
      lastError: payload.error,
      attempt: payload.attempt,
    });
  }

  private trackRecoveryFailure(payload: EventPayload['recovery:failed']): void {
    const incident = this.ensureIncident(payload.projectId);
    incident.lastError = payload.error;
    incident.attempt = payload.attempt;
    this.incidents.set(payload.projectId, incident);
  }

  private async reportRecoverySuccess(payload: EventPayload['recovery:success']): Promise<void> {
    const incident = this.ensureIncident(payload.projectId);
    const recoveredAt = new Date();
    const report = this.formatSuccessReport(
      incident,
      recoveredAt,
      payload.durationMs,
      payload.attempt,
    );

    try {
      await this.channelManager.broadcast(report);
    } catch (error) {
      log.error(
        { error, projectId: payload.projectId },
        'Failed to broadcast incident recovery success',
      );
    } finally {
      this.incidents.delete(payload.projectId);
    }
  }

  private async reportRecoveryExhausted(
    payload: EventPayload['recovery:exhausted'],
  ): Promise<void> {
    const incident = this.ensureIncident(payload.projectId);
    const report = this.formatExhaustedReport(incident, payload.totalAttempts, payload.lastError);

    try {
      await this.channelManager.broadcast(report);
    } catch (error) {
      log.error(
        { error, projectId: payload.projectId },
        'Failed to broadcast incident recovery exhaustion',
      );
    } finally {
      this.incidents.delete(payload.projectId);
    }
  }

  private ensureIncident(projectId: string): IncidentState {
    const current = this.incidents.get(projectId);
    if (current) {
      return current;
    }

    return {
      projectId,
      projectName: this.resolveProjectName(projectId),
      failedAt: new Date(),
      lastError: 'unknown',
      attempt: 1,
    };
  }

  private resolveProjectName(projectId: string): string {
    const project = this.db.getProject(projectId);
    return project?.name ?? projectId;
  }

  private formatSuccessReport(
    incident: IncidentState,
    recoveredAt: Date,
    durationMs: number,
    attempt: number,
  ): string {
    const durationSec = Math.max(1, Math.round(durationMs / 1000));
    const locale = this.getCurrentLocale();

    if (locale === 'ko') {
      return [
        '🛬 OpenLander — 장애 복구 완료',
        '',
        `📋 프로젝트: ${incident.projectName}`,
        `⏰ 발생 시각: ${this.formatTimestamp(incident.failedAt)}`,
        `✅ 복구 시각: ${this.formatTimestamp(recoveredAt)}`,
        `⏱ 소요 시간: ${String(durationSec)}초`,
        `🔄 시도 횟수: ${String(attempt)}회`,
        '',
        `📝 원인: ${incident.lastError}`,
        '🤖 AI가 자동으로 문제를 분석하고 복구했습니다.',
      ].join('\n');
    }

    return [
      '🛬 OpenLander - Incident Recovery Complete',
      '',
      `📋 Project: ${incident.projectName}`,
      `⏰ Detected At: ${this.formatTimestamp(incident.failedAt)}`,
      `✅ Recovered At: ${this.formatTimestamp(recoveredAt)}`,
      `⏱ Duration: ${String(durationSec)}s`,
      `🔄 Attempts: ${String(attempt)}`,
      '',
      `📝 Root Cause: ${incident.lastError}`,
      '🤖 AI analyzed the issue and recovered automatically.',
    ].join('\n');
  }

  private formatExhaustedReport(
    incident: IncidentState,
    totalAttempts: number,
    lastError: string,
  ): string {
    const locale = this.getCurrentLocale();

    if (locale === 'ko') {
      return [
        '🛬 OpenLander — 장애 복구 실패',
        '',
        `📋 프로젝트: ${incident.projectName}`,
        `⏰ 발생 시각: ${this.formatTimestamp(incident.failedAt)}`,
        `❌ 복구 실패 — ${String(totalAttempts)}회 시도 후 포기`,
        `📝 마지막 에러: ${lastError}`,
        '',
        '⚠️ 수동 확인이 필요합니다.',
      ].join('\n');
    }

    return [
      '🛬 OpenLander - Incident Recovery Failed',
      '',
      `📋 Project: ${incident.projectName}`,
      `⏰ Detected At: ${this.formatTimestamp(incident.failedAt)}`,
      `❌ Recovery exhausted after ${String(totalAttempts)} attempts`,
      `📝 Last Error: ${lastError}`,
      '',
      '⚠️ Manual investigation is required.',
    ].join('\n');
  }

  private formatTimestamp(date: Date): string {
    const currentLocale = this.getCurrentLocale();
    const locale = currentLocale === 'ko' ? 'ko-KR' : 'en-US';
    return date.toLocaleString(locale, { hour12: false });
  }
}
