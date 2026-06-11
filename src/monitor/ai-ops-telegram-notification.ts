import type { Channel, ChannelManager } from '../channels/base.js';
import type { OpenLanderConfig } from '../config/index.js';
import type { Database } from '../db/index.js';
import type { AiOpsBriefingRow } from '../db/types.js';

export type AiOpsTelegramNotificationStatus = 'sent' | 'skipped';

export interface AiOpsTelegramNotificationResult {
  status: AiOpsTelegramNotificationStatus;
  reason?:
    | 'ai_ops_off'
    | 'dedupe_suppressed'
    | 'telegram_not_configured'
    | 'telegram_not_connected';
  messageId?: string;
}

interface NotifyAiOpsBriefingTelegramOptions {
  db: Pick<
    Database,
    'getAiOpsProjectPolicy' | 'resolveAiOpsServicePolicy' | 'claimAiOpsDedupeWindow'
  >;
  channelManager: Pick<ChannelManager, 'getChannel'>;
  config: Pick<OpenLanderConfig, 'channels'>;
  briefing: AiOpsBriefingRow;
  now?: Date;
}

function getTelegramChannelId(config: Pick<OpenLanderConfig, 'channels'>): string | null {
  const channelId = config.channels.telegram.recoveryChannelId?.trim();
  return channelId && channelId.length > 0 ? channelId : null;
}

function formatSuggestedCall(raw: string | null): string {
  if (!raw) return 'none';

  try {
    const call = JSON.parse(raw) as { tool?: string; action?: string; params?: unknown };
    if (!call.tool || !call.action) return 'none';
    return `${call.tool}.${call.action} ${JSON.stringify(call.params ?? {})}`;
  } catch {
    return 'none';
  }
}

function escapeTelegramMarkdown(value: string): string {
  return value.replace(/([_*`[\]])/g, '\\$1');
}

export function formatAiOpsTelegramBriefing(briefing: AiOpsBriefingRow): string {
  const summary = briefing.llm_summary ?? briefing.deterministic_summary;
  const lines = [
    'OpenLander AI Ops Briefing',
    '',
    `Severity: ${briefing.severity}`,
    `Classification: ${briefing.classification}`,
    `Project: ${briefing.project_id}`,
    briefing.service_id ? `Resource: ${briefing.service_id}` : null,
    '',
    briefing.title,
    summary,
    '',
    `Suggested MCP call: ${formatSuggestedCall(briefing.suggested_call_json)}`,
    '',
    'No automatic remediation was run.',
  ].filter((line): line is string => line !== null);

  return escapeTelegramMarkdown(lines.join('\n'));
}

export async function notifyAiOpsBriefingTelegram(
  options: NotifyAiOpsBriefingTelegramOptions,
): Promise<AiOpsTelegramNotificationResult> {
  const policy = await options.db.resolveAiOpsServicePolicy(
    options.briefing.project_id,
    options.briefing.service_id,
  );
  if (policy.mode !== 'briefing') {
    return { status: 'skipped', reason: 'ai_ops_off' };
  }

  const projectPolicy = await options.db.getAiOpsProjectPolicy(options.briefing.project_id);
  const dedupe = await options.db.claimAiOpsDedupeWindow({
    projectId: options.briefing.project_id,
    serviceId: options.briefing.service_id,
    fingerprint: options.briefing.fingerprint,
    cooldownMinutes: projectPolicy.fingerprint_cooldown_minutes,
    briefingId: options.briefing.id,
    now: options.now,
  });
  if (dedupe.status === 'suppressed') {
    return { status: 'skipped', reason: 'dedupe_suppressed' };
  }

  const channelId = getTelegramChannelId(options.config);
  if (!channelId) {
    return { status: 'skipped', reason: 'telegram_not_configured' };
  }

  const channel: Channel | undefined = options.channelManager.getChannel('telegram');
  if (!channel?.isConnected()) {
    return { status: 'skipped', reason: 'telegram_not_connected' };
  }

  const messageId = await channel.sendMessage(
    channelId,
    formatAiOpsTelegramBriefing(options.briefing),
  );
  return { status: 'sent', messageId };
}
