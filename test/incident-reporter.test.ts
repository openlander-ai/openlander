import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChannelManager } from '../src/channels/base.js';
import type { Database } from '../src/db/index.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import { EventBus } from '../src/events/index.js';
import { IncidentReporter } from '../src/monitor/incident-reporter.js';

function createMockConfig(language: 'en' | 'ko' = 'en'): OpenLanderConfig {
  return {
    language,
    llm: {
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-2.0-flash',
      authToken: '',
      ollamaEndpoint: 'http://localhost:11434',
    },
    server: {
      port: 10114,
      host: '0.0.0.0',
      baseUrl: 'http://localhost:10114',
    },
    docker: {
      socketPath: '',
      networkName: 'web',
      portRangeStart: 10001,
      portRangeEnd: 10999,
    },
    git: {
      sshKeyPath: '',
      cloneDir: '',
    },
    cloudflare: {
      apiToken: '',
      tunnelId: '',
      accountId: '',
    },
    monitoring: {
      healthcheckIntervalSec: 60,
      inactivityThresholdDays: 14,
    },
    mcp: {
      enabled: false,
      transport: 'stdio',
      servers: [],
    },
    channels: {
      slack: { enabled: false, token: '', signingSecret: '' },
      discord: { enabled: false, token: '', applicationId: '', publicKey: '' },
      telegram: { enabled: false, token: '', webhookSecret: '' },
    },
    gitProviders: {
      github: { token: '', username: '' },
      gitlab: { token: '', username: '' },
    },
    localModel: {
      preferLocal: false,
      modelName: 'openlander-agent',
    },
    traefik: {
      mode: 'managed',
    },
  };
}

describe('IncidentReporter - dynamic locale behavior', () => {
  let reporter: IncidentReporter;
  let events: EventBus;
  let broadcast: ReturnType<typeof vi.fn>;
  let config: OpenLanderConfig;

  beforeEach(() => {
    events = new EventBus();
    broadcast = vi.fn().mockResolvedValue(undefined);
    const channelManager = {
      broadcast,
    } as unknown as ChannelManager;
    const db = {
      getProject: vi.fn().mockReturnValue({ name: 'Test Project' }),
    } as unknown as Database;
    config = createMockConfig('en');

    reporter = new IncidentReporter(channelManager, events, db, config);
  });

  it('respects runtime language changes in success reports', async () => {
    reporter.start();

    await events.emit('recovery:start', {
      projectId: 'project-1',
      error: 'Build failed',
      attempt: 1,
    });

    await events.emit('recovery:success', {
      projectId: 'project-1',
      attempt: 1,
      durationMs: 5000,
      lastError: 'Build failed',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(broadcast).toHaveBeenCalledOnce();
    const firstReport = broadcast.mock.calls[0]?.[0] as string;
    expect(firstReport).toContain('Incident Recovery Complete');
    expect(firstReport).not.toContain('장애 복구 완료');

    broadcast.mockClear();

    config.language = 'ko';

    await events.emit('recovery:start', {
      projectId: 'project-2',
      error: 'Build failed',
      attempt: 1,
    });

    await events.emit('recovery:success', {
      projectId: 'project-2',
      attempt: 1,
      durationMs: 5000,
      lastError: 'Build failed',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(broadcast).toHaveBeenCalledOnce();
    const secondReport = broadcast.mock.calls[0]?.[0] as string;
    expect(secondReport).toContain('장애 복구 완료');
    expect(secondReport).not.toContain('Incident Recovery Complete');
  });

  it('respects runtime language changes in exhausted reports', async () => {
    reporter.start();

    await events.emit('recovery:start', {
      projectId: 'project-1',
      error: 'Build failed',
      attempt: 1,
    });

    await events.emit('recovery:exhausted', {
      projectId: 'project-1',
      totalAttempts: 3,
      lastError: 'Build failed',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(broadcast).toHaveBeenCalledOnce();
    const firstReport = broadcast.mock.calls[0]?.[0] as string;
    expect(firstReport).toContain('Incident Recovery Failed');
    expect(firstReport).not.toContain('장애 복구 실패');

    broadcast.mockClear();

    config.language = 'ko';

    await events.emit('recovery:start', {
      projectId: 'project-2',
      error: 'Build failed',
      attempt: 1,
    });

    await events.emit('recovery:exhausted', {
      projectId: 'project-2',
      totalAttempts: 3,
      lastError: 'Build failed',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(broadcast).toHaveBeenCalledOnce();
    const secondReport = broadcast.mock.calls[0]?.[0] as string;
    expect(secondReport).toContain('장애 복구 실패');
    expect(secondReport).not.toContain('Incident Recovery Failed');
  });

  it('formats timestamps according to current locale', async () => {
    reporter.start();

    await events.emit('recovery:start', {
      projectId: 'project-1',
      error: 'Build failed',
      attempt: 1,
    });

    await events.emit('recovery:success', {
      projectId: 'project-1',
      attempt: 1,
      durationMs: 5000,
      lastError: 'Build failed',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(broadcast).toHaveBeenCalledOnce();
    const report = broadcast.mock.calls[0]?.[0] as string;
    expect(report).toMatch(/\d+/);

    broadcast.mockClear();

    config.language = 'ko';

    await events.emit('recovery:start', {
      projectId: 'project-2',
      error: 'Build failed',
      attempt: 1,
    });

    await events.emit('recovery:success', {
      projectId: 'project-2',
      attempt: 1,
      durationMs: 5000,
      lastError: 'Build failed',
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(broadcast).toHaveBeenCalledOnce();
    const koReport = broadcast.mock.calls[0]?.[0] as string;
    expect(koReport).toMatch(/\d+/);
  });
});
