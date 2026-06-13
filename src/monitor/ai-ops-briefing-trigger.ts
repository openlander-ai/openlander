import type { ChannelManager } from '../channels/base.js';
import type { OpenLanderConfig } from '../config/index.js';
import type { Database } from '../db/index.js';
import type { DeployLogRow, ServiceRow } from '../db/types.js';
import type { EventBus, EventPayload } from '../events/index.js';
import { createModuleLogger } from '../lib/logger.js';
import type { ModelRegistry } from '../llm/model-registry.js';
import { parseRepresentativeTraffic } from '../tools/defs/representative-traffic.js';
import {
  buildDeterministicAiOpsBriefing,
  type BuildAiOpsBriefingInput,
  type DeterministicAiOpsBriefing,
} from './ai-ops-briefing.js';
import {
  createAiOpsBriefingWithOptionalLlm,
  type AiOpsLlmSummaryResult,
} from './ai-ops-llm-summary.js';
import {
  notifyAiOpsBriefingTelegram,
  type AiOpsTelegramNotificationResult,
} from './ai-ops-telegram-notification.js';

const log = createModuleLogger('ai-ops-briefing-trigger');

type TriggerDb = Pick<
  Database,
  | 'getDeployableForProject'
  | 'getLastDeployLogForService'
  | 'resolveAiOpsServicePolicy'
  | 'getAiOpsProjectPolicy'
  | 'getAiOpsBriefingBudgetStatus'
  | 'claimAiOpsDedupeWindow'
  | 'attachAiOpsDedupeBriefing'
  | 'createAiOpsBriefing'
  | 'updateAiOpsBriefingLlmSummary'
>;

export type AiOpsBriefingTriggerSkipReason =
  | 'ai_ops_off'
  | 'service_not_found'
  | 'dedupe_suppressed'
  | 'no_issue_detected';

export interface AiOpsBriefingTriggerResult {
  status: 'created' | 'skipped';
  reason?: AiOpsBriefingTriggerSkipReason;
  briefingId?: string;
  deterministic?: DeterministicAiOpsBriefing;
  llmSummary?: AiOpsLlmSummaryResult;
  notification?: AiOpsTelegramNotificationResult;
}

export interface AiOpsBriefingTriggerOptions {
  eventBus: EventBus;
  db: TriggerDb;
  modelRegistry: Pick<ModelRegistry, 'getModel'>;
  channelManager: Pick<ChannelManager, 'getChannel'>;
  config: Pick<OpenLanderConfig, 'channels'>;
  now?: () => Date;
}

function parseStatusCode(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const match = /\bHTTP\s+(\d{3})\b/i.exec(value) ?? /\bstatus(?: code)?\s+(\d{3})\b/i.exec(value);
  if (!match?.[1]) return undefined;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function serviceName(service: ServiceRow | null): string | null {
  if (!service) return null;
  return service.name;
}

function deployLogEvidence(log: DeployLogRow | undefined, fallback?: string) {
  return {
    id: log?.id,
    status: 'failed',
    commitSha: log?.commit_sha ?? null,
    buildLogTail: log?.build_log ?? fallback ?? null,
    runtimeLogTail: log?.runtime_log ?? null,
    createdAt: log?.created_at ?? null,
  } as const;
}

function representativeTrafficEvidence(log: DeployLogRow | undefined) {
  return parseRepresentativeTraffic(log?.representative_traffic_json);
}

export class AiOpsBriefingTrigger {
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly options: AiOpsBriefingTriggerOptions) {}

  start(): void {
    if (this.unsubscribers.length > 0) return;

    this.unsubscribers.push(
      this.options.eventBus.on('health:degraded', (payload) => {
        void this.handleHealthDegraded(payload).catch((err: unknown) => {
          log.warn({ err, projectId: payload.projectId }, 'AI Ops health briefing trigger failed');
        });
      }),
      this.options.eventBus.on('container:die', (payload) => {
        void this.handleContainerDie(payload).catch((err: unknown) => {
          log.warn({ err, projectId: payload.projectId }, 'AI Ops crash briefing trigger failed');
        });
      }),
      this.options.eventBus.on('deploy:failed', (payload) => {
        void this.handleDeployFailed(payload).catch((err: unknown) => {
          log.warn({ err, projectId: payload.projectId }, 'AI Ops deploy briefing trigger failed');
        });
      }),
    );

    log.info('AI Ops briefing trigger started');
  }

  stop(): void {
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    log.info('AI Ops briefing trigger stopped');
  }

  async handleHealthDegraded(
    payload: EventPayload['health:degraded'],
  ): Promise<AiOpsBriefingTriggerResult> {
    const service = (await this.options.db.getDeployableForProject(payload.projectId)) ?? null;
    if (!service) return { status: 'skipped', reason: 'service_not_found' };
    const lastLog = await this.options.db.getLastDeployLogForService(service.id);

    return this.createFromEvidence({
      projectId: payload.projectId,
      serviceId: service.id,
      serviceName: serviceName(service),
      observedAt: this.options.now?.() ?? new Date(),
      representativeTraffic: representativeTrafficEvidence(lastLog),
      routeHealth: {
        status: 'unhealthy',
        statusCode: parseStatusCode(payload.lastError),
        message:
          payload.lastError ?? `Health check failed ${String(payload.consecutiveFailures)} times.`,
      },
    });
  }

  async handleContainerDie(
    payload: EventPayload['container:die'],
  ): Promise<AiOpsBriefingTriggerResult> {
    const service = (await this.options.db.getDeployableForProject(payload.projectId)) ?? null;
    if (!service) return { status: 'skipped', reason: 'service_not_found' };

    return this.createFromEvidence({
      projectId: payload.projectId,
      serviceId: service.id,
      serviceName: serviceName(service),
      observedAt: this.options.now?.() ?? new Date(),
      container: {
        name: payload.containerName,
        running: false,
        status: 'exited',
        exitCode: payload.exitCode,
        restartCount: null,
      },
      runtimeIncident: {
        category: 'container_restart',
        errorSnippet: `Container ${payload.containerName} exited with code ${String(
          payload.exitCode,
        )}.`,
      },
    });
  }

  async handleDeployFailed(
    payload: EventPayload['deploy:failed'],
  ): Promise<AiOpsBriefingTriggerResult> {
    const service = (await this.options.db.getDeployableForProject(payload.projectId)) ?? null;
    if (!service) return { status: 'skipped', reason: 'service_not_found' };

    const lastLog = await this.options.db.getLastDeployLogForService(service.id);
    return this.createFromEvidence({
      projectId: payload.projectId,
      serviceId: service.id,
      serviceName: serviceName(service),
      observedAt: this.options.now?.() ?? new Date(),
      representativeTraffic: representativeTrafficEvidence(lastLog),
      deployLog: deployLogEvidence(lastLog, payload.buildLog ?? payload.error),
    });
  }

  private async createFromEvidence(
    input: BuildAiOpsBriefingInput,
  ): Promise<AiOpsBriefingTriggerResult> {
    const serviceId = input.serviceId ?? null;
    const policy = await this.options.db.resolveAiOpsServicePolicy(input.projectId, serviceId);
    if (policy.mode !== 'briefing') {
      return { status: 'skipped', reason: 'ai_ops_off' };
    }

    const deterministic = buildDeterministicAiOpsBriefing(input);
    if (deterministic.classification === 'no_issue_detected') {
      return { status: 'skipped', reason: 'no_issue_detected', deterministic };
    }

    const projectPolicy = await this.options.db.getAiOpsProjectPolicy(input.projectId);
    const claimed = await this.options.db.claimAiOpsDedupeWindow({
      projectId: deterministic.projectId,
      serviceId: deterministic.serviceId,
      fingerprint: deterministic.fingerprint,
      cooldownMinutes: projectPolicy.fingerprint_cooldown_minutes,
      now: input.observedAt,
    });
    if (claimed.status === 'suppressed') {
      return { status: 'skipped', reason: 'dedupe_suppressed', deterministic };
    }

    const budget = await this.options.db.getAiOpsBriefingBudgetStatus(
      input.projectId,
      input.observedAt,
    );
    const created = await createAiOpsBriefingWithOptionalLlm({
      db: this.options.db,
      input,
      modelRegistry: this.options.modelRegistry,
      enableLlmSummary: budget.decision.llmSummaryAllowed,
    });
    await this.options.db.attachAiOpsDedupeBriefing(
      created.deterministic.dedupeKey,
      created.briefing.id,
    );

    const notification = await notifyAiOpsBriefingTelegram({
      db: this.options.db,
      channelManager: this.options.channelManager,
      config: this.options.config,
      briefing: created.briefing,
      dedupeAlreadyClaimed: true,
      now: input.observedAt,
    });

    return {
      status: 'created',
      briefingId: created.briefing.id,
      deterministic: created.deterministic,
      llmSummary: created.summary,
      notification,
    };
  }
}
