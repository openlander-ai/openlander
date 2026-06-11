import { describe, expect, it, vi } from 'vitest';

import type { Channel } from '../../src/channels/base.js';
import type { AiOpsBriefingRow, AiOpsProjectPolicyRow } from '../../src/db/types.js';
import {
  formatAiOpsTelegramBriefing,
  notifyAiOpsBriefingTelegram,
} from '../../src/monitor/ai-ops-telegram-notification.js';

function makeBriefing(overrides: Partial<AiOpsBriefingRow> = {}): AiOpsBriefingRow {
  return {
    id: 'brief-1',
    project_id: 'proj-1',
    service_id: 'svc-1',
    dedupe_key: 'proj-1:service:svc-1:traffic:/:500',
    fingerprint: 'traffic:/:500',
    classification: 'traffic_health_mismatch',
    severity: 'high',
    title: 'Public traffic is failing',
    deterministic_summary: 'Representative traffic probe to / failed with 500.',
    llm_summary: 'The public route is returning 500 while health still passes.',
    suggested_call_json: JSON.stringify({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { service_id: 'svc-1' },
    }),
    evidence_json: '{}',
    status: 'open',
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    server_id: 'local',
    ...overrides,
  };
}

function makeProjectPolicy(overrides: Partial<AiOpsProjectPolicyRow> = {}): AiOpsProjectPolicyRow {
  return {
    project_id: 'proj-1',
    mode: 'briefing',
    daily_briefing_limit: 20,
    fingerprint_cooldown_minutes: 30,
    created_at: '2026-06-11T00:00:00.000Z',
    updated_at: '2026-06-11T00:00:00.000Z',
    ...overrides,
  };
}

function makeConfig(channelId = '12345') {
  return {
    channels: {
      telegram: { recoveryChannelId: channelId },
    },
  } as never;
}

function makeChannel() {
  return {
    isConnected: vi.fn(() => true),
    sendMessage: vi.fn(async () => 'tg-msg-1'),
  } as unknown as Channel;
}

function makeDb(overrides: Record<string, unknown> = {}) {
  return {
    resolveAiOpsServicePolicy: vi.fn(async () => ({ mode: 'briefing', source: 'project' })),
    getAiOpsProjectPolicy: vi.fn(async () => makeProjectPolicy()),
    claimAiOpsDedupeWindow: vi.fn(async () => ({
      status: 'created',
      dedupe: { id: 'dedupe-1' },
    })),
    ...overrides,
  } as never;
}

describe('AI Ops Telegram notification', () => {
  it('sends a briefing to Telegram only and records durable fingerprint dedupe', async () => {
    const channel = makeChannel();
    const getChannel = vi.fn((type: string) => (type === 'telegram' ? channel : undefined));
    const db = makeDb();

    const result = await notifyAiOpsBriefingTelegram({
      db,
      channelManager: { getChannel } as never,
      config: makeConfig(),
      briefing: makeBriefing(),
      now: new Date('2026-06-11T01:00:00.000Z'),
    });

    expect(result).toEqual({ status: 'sent', messageId: 'tg-msg-1' });
    expect(db.resolveAiOpsServicePolicy).toHaveBeenCalledWith('proj-1', 'svc-1');
    expect(db.claimAiOpsDedupeWindow).toHaveBeenCalledWith({
      projectId: 'proj-1',
      serviceId: 'svc-1',
      fingerprint: 'traffic:/:500',
      cooldownMinutes: 30,
      briefingId: 'brief-1',
      now: new Date('2026-06-11T01:00:00.000Z'),
    });
    expect(getChannel).toHaveBeenCalledWith('telegram');
    expect(channel.sendMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('No automatic remediation was run.'),
    );
    expect(channel.sendMessage).toHaveBeenCalledWith(
      '12345',
      expect.stringContaining('openlander\\_monitor.diagnose\\_service'),
    );
  });

  it('does not send when Project or Service policy resolves to off', async () => {
    const channel = makeChannel();
    const db = makeDb({
      resolveAiOpsServicePolicy: vi.fn(async () => ({ mode: 'off', source: 'service_override' })),
    });

    const result = await notifyAiOpsBriefingTelegram({
      db,
      channelManager: { getChannel: vi.fn(() => channel) } as never,
      config: makeConfig(),
      briefing: makeBriefing(),
    });

    expect(result).toEqual({ status: 'skipped', reason: 'ai_ops_off' });
    expect(db.claimAiOpsDedupeWindow).not.toHaveBeenCalled();
    expect(channel.sendMessage).not.toHaveBeenCalled();
  });

  it('suppresses duplicate fingerprints through durable dedupe before sending', async () => {
    const channel = makeChannel();
    const db = makeDb({
      claimAiOpsDedupeWindow: vi.fn(async () => ({
        status: 'suppressed',
        dedupe: { id: 'dedupe-1' },
      })),
    });

    const result = await notifyAiOpsBriefingTelegram({
      db,
      channelManager: { getChannel: vi.fn(() => channel) } as never,
      config: makeConfig(),
      briefing: makeBriefing(),
    });

    expect(result).toEqual({ status: 'skipped', reason: 'dedupe_suppressed' });
    expect(channel.sendMessage).not.toHaveBeenCalled();
  });

  it('skips without fanout when Telegram is not configured or connected', async () => {
    const channel = makeChannel();
    vi.mocked(channel.isConnected).mockReturnValue(false);

    await expect(
      notifyAiOpsBriefingTelegram({
        db: makeDb(),
        channelManager: { getChannel: vi.fn(() => channel) } as never,
        config: makeConfig(''),
        briefing: makeBriefing(),
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'telegram_not_configured' });

    await expect(
      notifyAiOpsBriefingTelegram({
        db: makeDb(),
        channelManager: { getChannel: vi.fn(() => channel) } as never,
        config: makeConfig(),
        briefing: makeBriefing(),
      }),
    ).resolves.toEqual({ status: 'skipped', reason: 'telegram_not_connected' });
  });

  it('formats a send-only message without claiming remediation', () => {
    const text = formatAiOpsTelegramBriefing(makeBriefing({ service_id: 'api__svc' }));

    expect(text).toContain('OpenLander AI Ops Briefing');
    expect(text).toContain('The public route is returning 500');
    expect(text).toContain('Resource: api\\_\\_svc');
    expect(text).toContain('No automatic remediation was run.');
    expect(text).not.toMatch(/fixed|restarted|redeployed|rolled back/i);
  });
});
