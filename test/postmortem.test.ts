import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from '../src/llm/agent.js';
import type { Database } from '../src/db/index.js';
import type { OpenLanderConfig } from '../src/config/index.js';
import { EventBus } from '../src/events/index.js';
import {
  getPostmortemInstance,
  PostmortemGenerator,
  setPostmortemInstance,
} from '../src/monitor/postmortem.js';

type RedactSecretsAccessor = {
  redactSecrets: (text: string) => string;
};

const redactionFixtures = {
  awsAccessKey: ['AKIA', '1234567890ABCDEF'].join(''),
  awsTempKey: ['ASIA', '1111222233334444'].join(''),
  githubToken: ['ghp_', 'abcdefghijklmnopqrstuvwxyz1234'].join(''),
  openAiKey: ['sk-', 'abcDEF1234567890_ABC-xyz123'].join(''),
  stripeLiveKey: ['sk_', 'live_', '1234567890ABCDEF1234'].join(''),
  stripeTestKey: ['sk_', 'test_', 'ABCDEF1234567890ABCD'].join(''),
  slackToken: ['xoxb-', '123456-abcDEF123456'].join(''),
  postgresUrl: ['postgres://', 'admin:secretpass@db.internal:5432/app'].join(''),
  privateKeyHeader: ['-----BEGIN RSA ', 'PRIVATE KEY-----'].join(''),
};

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
      email: {
        enabled: false,
        host: '',
        port: 587,
        secure: false,
        auth: { user: '', pass: '' },
        from: '',
        to: [],
      },
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
    ai: {
      autoRecovery: { enabled: false },
      buildDebugger: { enabled: false },
      webAgent: { enabled: false },
      envDetection: { enabled: false },
      secretScan: { enabled: false },
      rollbackSuggestion: { enabled: false },
      operationalMonitoring: { enabled: false },
    },
    google: {
      clientId: '',
      clientSecret: '',
    },
    ops: {
      enabled: false,
      recovery: {
        enabled: false,
        automation: { restart: 'auto', diagnosis: 'auto', apply_fixes: 'auto', rollback: 'auto' },
      },
      auto_cleanup: false,
      drift_detection: false,
      production_only: false,
      thresholds: {
        disk_cleanup_percent: 80,
        recovery_max_per_day: 5,
        alert_dedup_minutes: 15,
        digest_time: '09:00',
      },
      channels: {},
    },
  };
}

async function waitForAssertion(assertion: () => void, timeoutMs = 500): Promise<void> {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }

  throw new Error('Timed out while waiting for assertion to pass.');
}

describe('PostmortemGenerator - redactSecrets', () => {
  let generator: PostmortemGenerator;

  beforeEach(() => {
    const events = new EventBus();
    const db = {
      getProject: vi.fn(),
      getDeployLogs: vi.fn(),
      // PR 4.5: canonical-first reads need this helper.
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    } as unknown as Database;
    const agent = {
      chat: vi.fn().mockResolvedValue({ message: 'test markdown' }),
    } as unknown as Agent;
    const config = createMockConfig();

    generator = new PostmortemGenerator(events, db, agent, config);
  });

  it('redacts all supported secret patterns', () => {
    const input = [
      `aws access key: ${redactionFixtures.awsAccessKey}`,
      `aws session key: ${redactionFixtures.awsTempKey}`,
      `github token: ${redactionFixtures.githubToken}`,
      `openai key: ${redactionFixtures.openAiKey}`,
      `stripe live key: ${redactionFixtures.stripeLiveKey}`,
      `stripe test key: ${redactionFixtures.stripeTestKey}`,
      `slack token: ${redactionFixtures.slackToken}`,
      `database url: ${redactionFixtures.postgresUrl}`,
      `private key header: ${redactionFixtures.privateKeyHeader}`,
    ].join('\n');

    const redacted = (generator as unknown as RedactSecretsAccessor).redactSecrets(input);

    expect(redacted).not.toContain(redactionFixtures.awsAccessKey);
    expect(redacted).not.toContain(redactionFixtures.awsTempKey);
    expect(redacted).not.toContain(redactionFixtures.githubToken);
    expect(redacted).not.toContain(redactionFixtures.openAiKey);
    expect(redacted).not.toContain(redactionFixtures.stripeLiveKey);
    expect(redacted).not.toContain(redactionFixtures.stripeTestKey);
    expect(redacted).not.toContain(redactionFixtures.slackToken);
    expect(redacted).not.toContain('postgres://admin:secretpass@');
    expect(redacted).not.toContain(redactionFixtures.privateKeyHeader);
    expect(redacted.match(/\[REDACTED\]/g)?.length ?? 0).toBeGreaterThanOrEqual(9);
  });
});

describe('PostmortemGenerator - lifecycle and generation', () => {
  let events: EventBus;
  let getProject: ReturnType<typeof vi.fn>;
  let getDeployLogs: ReturnType<typeof vi.fn>;
  let chat: ReturnType<typeof vi.fn>;
  let generator: PostmortemGenerator;

  beforeEach(() => {
    events = new EventBus();
    getProject = vi.fn().mockReturnValue({ name: 'Demo Project' });
    getDeployLogs = vi.fn().mockReturnValue([
      {
        build_log: `Build failed with token ${redactionFixtures.stripeLiveKey} in logs`,
      },
    ]);
    chat = vi.fn().mockResolvedValue({ message: 'test markdown' });

    const db = {
      getProject,
      getDeployLogs,
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    } as unknown as Database;
    const agent = {
      chat,
    } as unknown as Agent;
    const config = createMockConfig();

    generator = new PostmortemGenerator(events, db, agent, config);
  });

  it('start() is a noop (no event subscriptions)', () => {
    expect(events.listenerCount('recovery:success')).toBe(0);
    expect(events.listenerCount('recovery:exhausted')).toBe(0);

    generator.start();

    expect(events.listenerCount('recovery:success')).toBe(0);
    expect(events.listenerCount('recovery:exhausted')).toBe(0);
  });

  it('stop() is a noop (no subscriptions to clean up)', () => {
    generator.start();
    expect(events.listenerCount('recovery:success')).toBe(0);
    expect(events.listenerCount('recovery:exhausted')).toBe(0);

    generator.stop();

    expect(events.listenerCount('recovery:success')).toBe(0);
    expect(events.listenerCount('recovery:exhausted')).toBe(0);
  });

  it('generatePostmortem() generates postmortem with redacted build logs', async () => {
    getProject.mockReturnValue({ name: 'Demo Project', status: 'running' });

    await generator.generatePostmortem('project-1');

    await waitForAssertion(() => {
      expect(chat).toHaveBeenCalledOnce();
    });

    const prompt = chat.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('[REDACTED]');
    expect(prompt).not.toContain(redactionFixtures.stripeLiveKey);
  });

  it('getLatest() returns generated postmortem entry', async () => {
    getProject.mockReturnValue({ name: 'Demo Project', status: 'running' });

    await generator.generatePostmortem('project-1');

    await waitForAssertion(() => {
      expect(generator.getLatest('project-1')).toBeDefined();
    });

    const latest = generator.getLatest('project-1');
    expect(latest?.projectId).toBe('project-1');
    expect(latest?.projectName).toBe('Demo Project');
    expect(latest?.markdown).toBe('test markdown');
    expect(latest?.createdAt).toBeInstanceOf(Date);
  });
});

describe('PostmortemGenerator singleton helpers', () => {
  it('setPostmortemInstance() and getPostmortemInstance() manage singleton instance', () => {
    const events = new EventBus();
    const db = {
      getProject: vi.fn(),
      getDeployLogs: vi.fn(),
      // PR 4.5: canonical-first reads need this helper.
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    } as unknown as Database;
    const agent = {
      chat: vi.fn().mockResolvedValue({ message: 'test markdown' }),
    } as unknown as Agent;
    const config = createMockConfig();
    const instance = new PostmortemGenerator(events, db, agent, config);

    setPostmortemInstance(instance);

    expect(getPostmortemInstance()).toBe(instance);
  });
});

describe('PostmortemGenerator - dynamic locale behavior', () => {
  it('respects runtime language changes in generated prompts', async () => {
    const events = new EventBus();
    const getProject = vi.fn().mockReturnValue({ name: 'Demo Project', status: 'running' });
    const getDeployLogs = vi.fn().mockReturnValue([
      {
        build_log: 'Build failed',
      },
    ]);
    const chat = vi.fn().mockResolvedValue({ message: 'test markdown' });

    const db = {
      getProject,
      getDeployLogs,
      getDeployableForProject: vi.fn().mockReturnValue(undefined),
    } as unknown as Database;
    const agent = {
      chat,
    } as unknown as Agent;
    const config = createMockConfig('en');

    const generator = new PostmortemGenerator(events, db, agent, config);

    await generator.generatePostmortem('project-1');

    await waitForAssertion(() => {
      expect(chat).toHaveBeenCalledOnce();
    });

    const firstPrompt = chat.mock.calls[0]?.[0] as string;
    expect(firstPrompt).toContain('Write the entire report in English');

    chat.mockClear();

    config.language = 'ko';

    await generator.generatePostmortem('project-2');

    await waitForAssertion(() => {
      expect(chat).toHaveBeenCalledOnce();
    });

    const secondPrompt = chat.mock.calls[0]?.[0] as string;
    expect(secondPrompt).toContain('Write the entire report in Korean');
  });
});
