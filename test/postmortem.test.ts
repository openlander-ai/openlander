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
    } as unknown as Database;
    const agent = {
      chat: vi.fn().mockResolvedValue({ message: 'test markdown' }),
    } as unknown as Agent;
    const config = createMockConfig();

    generator = new PostmortemGenerator(events, db, agent, config);
  });

  it('redacts all supported secret patterns', () => {
    const input = [
      'aws access key: AKIA1234567890ABCDEF',
      'aws session key: ASIA1111222233334444',
      'github token: ghp_abcdefghijklmnopqrstuvwxyz1234',
      'openai key: sk-abcDEF1234567890_ABC-xyz123',
      'stripe live key: sk_live_1234567890ABCDEF1234',
      'stripe test key: sk_test_ABCDEF1234567890ABCD',
      'slack token: xoxb-123456-abcDEF123456',
      'database url: postgres://admin:secretpass@db.internal:5432/app',
      'private key header: -----BEGIN RSA PRIVATE KEY-----',
    ].join('\n');

    const redacted = (generator as unknown as RedactSecretsAccessor).redactSecrets(input);

    expect(redacted).not.toContain('AKIA1234567890ABCDEF');
    expect(redacted).not.toContain('ASIA1111222233334444');
    expect(redacted).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz1234');
    expect(redacted).not.toContain('sk-abcDEF1234567890_ABC-xyz123');
    expect(redacted).not.toContain('sk_live_1234567890ABCDEF1234');
    expect(redacted).not.toContain('sk_test_ABCDEF1234567890ABCD');
    expect(redacted).not.toContain('xoxb-123456-abcDEF123456');
    expect(redacted).not.toContain('postgres://admin:secretpass@');
    expect(redacted).not.toContain('-----BEGIN RSA PRIVATE KEY-----');
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
        build_log: 'Build failed with token sk_live_1234567890ABCDEF1234 in logs',
      },
    ]);
    chat = vi.fn().mockResolvedValue({ message: 'test markdown' });

    const db = {
      getProject,
      getDeployLogs,
    } as unknown as Database;
    const agent = {
      chat,
    } as unknown as Agent;
    const config = createMockConfig();

    generator = new PostmortemGenerator(events, db, agent, config);
  });

  it('start() subscribes to recovery success and exhausted events', () => {
    expect(events.listenerCount('recovery:success')).toBe(0);
    expect(events.listenerCount('recovery:exhausted')).toBe(0);

    generator.start();

    expect(events.listenerCount('recovery:success')).toBe(1);
    expect(events.listenerCount('recovery:exhausted')).toBe(1);
  });

  it('stop() unsubscribes all handlers', () => {
    generator.start();
    expect(events.listenerCount('recovery:success')).toBe(1);
    expect(events.listenerCount('recovery:exhausted')).toBe(1);

    generator.stop();

    expect(events.listenerCount('recovery:success')).toBe(0);
    expect(events.listenerCount('recovery:exhausted')).toBe(0);
  });

  it('generates postmortem from recovery event with redacted build logs', async () => {
    generator.start();

    await events.emit('recovery:success', {
      projectId: 'project-1',
      attempt: 2,
      durationMs: 1800,
      lastError: 'build failed',
    });

    await waitForAssertion(() => {
      expect(chat).toHaveBeenCalledOnce();
    });

    const prompt = chat.mock.calls[0]?.[0] as string;
    expect(prompt).toContain('[REDACTED]');
    expect(prompt).not.toContain('sk_live_1234567890ABCDEF1234');
  });

  it('getLatest() returns generated postmortem entry', async () => {
    generator.start();

    await events.emit('recovery:exhausted', {
      projectId: 'project-1',
      totalAttempts: 3,
      lastError: 'still failing',
    });

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
    const getProject = vi.fn().mockReturnValue({ name: 'Demo Project' });
    const getDeployLogs = vi.fn().mockReturnValue([
      {
        build_log: 'Build failed',
      },
    ]);
    const chat = vi.fn().mockResolvedValue({ message: 'test markdown' });

    const db = {
      getProject,
      getDeployLogs,
    } as unknown as Database;
    const agent = {
      chat,
    } as unknown as Agent;
    const config = createMockConfig('en');

    const generator = new PostmortemGenerator(events, db, agent, config);
    generator.start();

    await events.emit('recovery:success', {
      projectId: 'project-1',
      attempt: 1,
      durationMs: 1000,
      lastError: 'test error',
    });

    await waitForAssertion(() => {
      expect(chat).toHaveBeenCalledOnce();
    });

    const firstPrompt = chat.mock.calls[0]?.[0] as string;
    expect(firstPrompt).toContain('Write the entire report in English');

    chat.mockClear();

    config.language = 'ko';

    await events.emit('recovery:success', {
      projectId: 'project-2',
      attempt: 1,
      durationMs: 1000,
      lastError: 'test error',
    });

    await waitForAssertion(() => {
      expect(chat).toHaveBeenCalledOnce();
    });

    const secondPrompt = chat.mock.calls[0]?.[0] as string;
    expect(secondPrompt).toContain('Write the entire report in Korean');
  });
});
