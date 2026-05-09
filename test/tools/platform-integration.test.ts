import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppContext } from '../../src/app.js';
import { EventBus } from '../../src/events/index.js';
import {
  getEventBuffer,
  platformReadToolDefs,
  wireEventCapture,
} from '../../src/tools/defs/platform-read.js';

/**
 * Create a minimal mock AppContext for testing platform tools.
 * Supports overriding containers, projects, and services.
 */
function createMockAppContext(overrides?: {
  containers?: Array<{
    id: string;
    name: string;
    image: string;
    status: string;
    labels?: Record<string, string>;
  }>;
  projects?: Array<{ id: string; name: string; container_id: string | null }>;
  services?: Array<{ id: string; container_id: string | null; container_name: string }>;
}) {
  const containers = overrides?.containers ?? [];
  const projects = overrides?.projects ?? [];
  const services = overrides?.services ?? [];

  return {
    config: {
      llm: { apiKey: 'llm-key', authToken: 'llm-token', model: 'gpt' },
      cloudflare: { apiToken: 'cf-token', tunnelId: 'tid' },
      gitProviders: {
        github: { token: 'gh-token', username: 'gh-user' },
        gitlab: { token: 'gl-token', username: 'gl-user' },
      },
      channels: {
        slack: { token: 'slack-token', signingSecret: 'slack-secret', enabled: true },
        discord: { token: 'discord-token', enabled: true },
        telegram: { token: 'telegram-token', webhookSecret: 'telegram-secret', enabled: true },
      },
      docker: { networkName: 'web' },
      mcp: { enabled: true, platformTools: true },
    },
    docker: {
      listManagedContainers: vi.fn(async () => containers),
    },
    db: {
      listProjects: vi.fn(() => projects),
      listServices: vi.fn(() => services),
    },
  } as unknown as AppContext;
}

describe('platform-integration: EventBus → RingBuffer → platform_event_log', () => {
  beforeEach(() => {
    // Clear the shared event buffer before each test to avoid pollution
    getEventBuffer().clear();
    vi.restoreAllMocks();
  });

  it('Test 1: Full event flow — emit to tool output', async () => {
    const appCtx = createMockAppContext();
    const bus = new EventBus();

    // Wire the capture hook to connect EventBus to the shared RingBuffer
    wireEventCapture(bus);

    // Emit an event
    await bus.emit('deploy:start', {
      projectId: 'test-p1',
      repoUrl: 'https://example.com/repo',
    });

    // Find the platform_event_log tool
    const eventLogTool = platformReadToolDefs.find((t) => t.name === 'platform_event_log');
    expect(eventLogTool).toBeDefined();

    // Execute it with mock context
    const result = (await eventLogTool!.execute({ limit: 10 }, { target: 'mcp', appCtx })) as {
      count: number;
      events: Array<{ type: string; payload: unknown; timestamp: number }>;
    };

    // Assert the event was captured
    expect(result.count).toBe(1);
    expect(result.events[0]?.type).toBe('deploy:start');
    const payload = result.events[0]?.payload as Record<string, unknown>;
    expect(payload?.projectId).toBe('test-p1');
    expect(payload?.repoUrl).toBe('https://example.com/repo');
  });

  it('Test 2: Multiple events flow through buffer in order', async () => {
    const appCtx = createMockAppContext();
    const bus = new EventBus();
    wireEventCapture(bus);

    // Emit multiple events in sequence
    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'https://example.com/repo' });
    await bus.emit('deploy:clone', {
      projectId: 'p1',
      path: '/tmp/repo',
      commitSha: 'abc123',
    });
    await bus.emit('deploy:build', {
      projectId: 'p1',
      imageTag: 'p1:latest',
      durationMs: 5000,
    });

    const eventLogTool = platformReadToolDefs.find((t) => t.name === 'platform_event_log');
    const result = (await eventLogTool!.execute({ limit: 10 }, { target: 'mcp', appCtx })) as {
      count: number;
      events: Array<{ type: string }>;
    };

    // Verify all events are captured in order
    expect(result.count).toBe(3);
    expect(result.events.map((e) => e.type)).toEqual([
      'deploy:start',
      'deploy:clone',
      'deploy:build',
    ]);
  });

  it('Test 3: Event buffer respects limit parameter', async () => {
    const appCtx = createMockAppContext();
    const bus = new EventBus();
    wireEventCapture(bus);

    // Emit 5 events
    for (let i = 0; i < 5; i++) {
      await bus.emit('deploy:start', {
        projectId: `p${i}`,
        repoUrl: `https://example.com/repo${i}`,
      });
    }

    const eventLogTool = platformReadToolDefs.find((t) => t.name === 'platform_event_log');

    // Query with limit=2, should get only the last 2
    const result = (await eventLogTool!.execute({ limit: 2 }, { target: 'mcp', appCtx })) as {
      count: number;
      events: Array<{ type: string; payload: unknown }>;
    };

    expect(result.count).toBe(2);
    const payloads = result.events.map((e) => e.payload as Record<string, unknown>);
    expect(payloads[0]?.projectId).toBe('p3');
    expect(payloads[1]?.projectId).toBe('p4');
  });

  it('Test 4: Event type prefix filtering works end-to-end', async () => {
    const appCtx = createMockAppContext();
    const bus = new EventBus();
    wireEventCapture(bus);

    // Emit mixed event types
    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'https://example.com/repo' });
    await bus.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://localhost:3000',
      totalDurationMs: 10000,
    });
    await bus.emit('monitor:healthcheck', {
      projectId: 'p1',
      healthy: true,
      responseTimeMs: 50,
    });
    await bus.emit('deploy:failed', {
      projectId: 'p2',
      step: 'build',
      error: 'Build failed',
    });

    const eventLogTool = platformReadToolDefs.find((t) => t.name === 'platform_event_log');

    // Query with deploy: prefix
    const result = (await eventLogTool!.execute(
      { event_type: 'deploy:' },
      { target: 'mcp', appCtx },
    )) as {
      count: number;
      events: Array<{ type: string }>;
    };

    expect(result.count).toBe(3);
    expect(result.events.every((e) => e.type.startsWith('deploy:'))).toBe(true);
    expect(result.events.map((e) => e.type)).toEqual([
      'deploy:start',
      'deploy:success',
      'deploy:failed',
    ]);
  });

  it('Test 5: platform_health reflects event buffer size', async () => {
    const appCtx = createMockAppContext();
    const bus = new EventBus();
    wireEventCapture(bus);

    // Emit some events
    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'https://example.com/repo' });
    await bus.emit('deploy:clone', {
      projectId: 'p1',
      path: '/tmp/repo',
      commitSha: 'abc123',
    });

    const healthTool = platformReadToolDefs.find((t) => t.name === 'platform_health');
    const result = (await healthTool!.execute({}, { target: 'mcp', appCtx })) as {
      event_bus_buffer_size: number;
      docker_status: string;
      db_status: string;
    };

    expect(result.event_bus_buffer_size).toBe(2);
    expect(result.docker_status).toBe('running');
    expect(result.db_status).toBe('ok');
  });

  it('Test 6: Capture hook does not break EventBus emit on error', async () => {
    const appCtx = createMockAppContext();
    const bus = new EventBus();

    // Set a capture hook that throws
    bus.setCaptureHook(() => {
      throw new Error('Capture hook error');
    });

    // Emit should still succeed (errors in capture hook are swallowed)
    await bus.emit('deploy:start', { projectId: 'p1', repoUrl: 'https://example.com/repo' });

    // Now wire the normal capture hook
    bus.removeCaptureHook();
    wireEventCapture(bus);

    // Emit another event
    await bus.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://localhost:3000',
      totalDurationMs: 5000,
    });

    // Only the second event should be in the buffer (first one was lost due to bad hook)
    const eventLogTool = platformReadToolDefs.find((t) => t.name === 'platform_event_log');
    const result = (await eventLogTool!.execute({ limit: 10 }, { target: 'mcp', appCtx })) as {
      count: number;
      events: Array<{ type: string }>;
    };

    expect(result.count).toBe(1);
    expect(result.events[0]?.type).toBe('deploy:success');
  });

  it('Test 7: Event buffer is shared across multiple EventBus instances', async () => {
    const appCtx = createMockAppContext();

    // Create two separate EventBus instances
    const bus1 = new EventBus();
    const bus2 = new EventBus();

    // Wire both to the same shared buffer
    wireEventCapture(bus1);
    wireEventCapture(bus2);

    // Emit from bus1
    await bus1.emit('deploy:start', { projectId: 'p1', repoUrl: 'https://example.com/repo' });

    // Emit from bus2
    await bus2.emit('deploy:success', {
      projectId: 'p1',
      url: 'http://localhost:3000',
      totalDurationMs: 5000,
    });

    // Query the buffer
    const eventLogTool = platformReadToolDefs.find((t) => t.name === 'platform_event_log');
    const result = (await eventLogTool!.execute({ limit: 10 }, { target: 'mcp', appCtx })) as {
      count: number;
      events: Array<{ type: string }>;
    };

    // Both events should be in the shared buffer
    expect(result.count).toBe(2);
    expect(result.events.map((e) => e.type)).toEqual(['deploy:start', 'deploy:success']);
  });
});
