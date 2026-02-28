import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

// Mock getSystemStats before importing prompts
vi.mock('../src/monitor/stats.js', () => ({
  getSystemStats: vi.fn(() => ({
    hostname: 'test-host',
    uptime: { seconds: 3600, formatted: '1h 0m' },
    cpu: {
      cores: 4,
      model: 'Test CPU',
      loadAvg1m: 0.5,
      loadAvg5m: 0.4,
      loadAvg15m: 0.3,
      usagePercent: 12,
    },
    memory: { totalMB: 8192, usedMB: 4096, freeMB: 4096, usagePercent: 50 },
    disk: { totalGB: 500, usedGB: 100, freeGB: 400, usagePercent: 20 },
  })),
}));

import { buildSystemPrompt, buildContextSnapshot } from '../src/agent/prompts.js';
import type { LLMProvider } from '../src/agent/prompts.js';
import { Database } from '../src/db/index.js';
import { getSystemStats } from '../src/monitor/stats.js';
import type { Docker, AllContainerInfo } from '../src/pipeline/docker.js';

describe('buildSystemPrompt', () => {
  it('includes base prompt without context or overlay', () => {
    // Even without context, the base prompt should be present
    const prompt = buildSystemPrompt('', 'gemini');
    expect(prompt).toContain('You are OpenLander');
    expect(prompt).toContain('Tool Usage Guide');
    expect(prompt).toContain('Multi-Step Operations');
  });

  it('includes context snapshot when provided', () => {
    const context = '## Current Server State\nProjects deployed: 2';
    const prompt = buildSystemPrompt(context, 'gemini');
    expect(prompt).toContain('Current Server State');
    expect(prompt).toContain('Projects deployed: 2');
  });

  it('includes gemini overlay', () => {
    const prompt = buildSystemPrompt('', 'gemini');
    expect(prompt).toContain('ALWAYS call tools for actions');
    expect(prompt).toContain('Structure responses with bullet points');
  });

  it('includes anthropic overlay', () => {
    const prompt = buildSystemPrompt('', 'anthropic');
    expect(prompt).toContain('Be concise');
    expect(prompt).toContain('scannable responses');
  });

  it('includes openai overlay', () => {
    const prompt = buildSystemPrompt('', 'openai');
    expect(prompt).toContain('Only state facts returned by tools');
  });

  it('includes openrouter overlay', () => {
    const prompt = buildSystemPrompt('', 'openrouter');
    expect(prompt).toContain('ALWAYS call tools for actions');
    expect(prompt).toContain('concise and structured');
  });

  it('includes ollama overlay', () => {
    const prompt = buildSystemPrompt('', 'ollama');
    expect(prompt).toContain('very short and direct');
    expect(prompt).toContain('saves tokens');
  });

  it('each provider produces different overlay content', () => {
    const providers: LLMProvider[] = ['gemini', 'anthropic', 'openai', 'openrouter', 'ollama'];
    const prompts = providers.map((p) => buildSystemPrompt('', p));

    // Each prompt should be unique (base is same, overlay differs)
    for (let i = 0; i < prompts.length; i++) {
      for (let j = i + 1; j < prompts.length; j++) {
        expect(prompts[i]).not.toBe(prompts[j]);
      }
    }
  });

  it('includes all three sections when context is present', () => {
    const context = '## Server State\nRunning: 3';
    const prompt = buildSystemPrompt(context, 'anthropic');

    // Base prompt
    expect(prompt).toContain('You are OpenLander');
    // Context
    expect(prompt).toContain('Server State');
    // Model overlay
    expect(prompt).toContain('Be concise');
  });
});

describe('buildContextSnapshot', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-prompts-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shows "no projects deployed yet" when DB is empty', async () => {
    const snapshot = await buildContextSnapshot(db);
    expect(snapshot).toContain('Projects deployed: 0');
    expect(snapshot).toContain('no projects deployed yet');
  });

  it('lists deployed projects with status', async () => {
    db.createProject({ id: 'p1', name: 'my-app', repoUrl: 'https://github.com/user/my-app' });
    db.createProject({ id: 'p2', name: 'api-server', repoUrl: 'https://github.com/user/api' });

    const snapshot = await buildContextSnapshot(db);
    expect(snapshot).toContain('Projects deployed: 2');
    expect(snapshot).toContain('my-app');
    expect(snapshot).toContain('api-server');
  });

  it('includes system resource stats', async () => {
    const snapshot = await buildContextSnapshot(db);
    expect(snapshot).toContain('CPU 12%');
    expect(snapshot).toContain('Memory 4096/8192MB');
    expect(snapshot).toContain('Disk 20%');
  });

  it('warns when memory is high', async () => {
    (getSystemStats as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      hostname: 'test-host',
      uptime: { seconds: 3600, formatted: '1h 0m' },
      cpu: {
        cores: 4,
        model: 'Test CPU',
        loadAvg1m: 0.5,
        loadAvg5m: 0.4,
        loadAvg15m: 0.3,
        usagePercent: 12,
      },
      memory: { totalMB: 8192, usedMB: 7200, freeMB: 992, usagePercent: 88 },
      disk: { totalGB: 500, usedGB: 100, freeGB: 400, usagePercent: 20 },
    });

    const snapshot = await buildContextSnapshot(db);
    expect(snapshot).toContain('⚠️ Memory usage is high');
  });

  it('warns when disk is critical', async () => {
    (getSystemStats as ReturnType<typeof vi.fn>).mockReturnValueOnce({
      hostname: 'test-host',
      uptime: { seconds: 3600, formatted: '1h 0m' },
      cpu: {
        cores: 4,
        model: 'Test CPU',
        loadAvg1m: 0.5,
        loadAvg5m: 0.4,
        loadAvg15m: 0.3,
        usagePercent: 12,
      },
      memory: { totalMB: 8192, usedMB: 4096, freeMB: 4096, usagePercent: 50 },
      disk: { totalGB: 500, usedGB: 470, freeGB: 30, usagePercent: 94 },
    });

    const snapshot = await buildContextSnapshot(db);
    expect(snapshot).toContain('⚠️ Disk usage is critical');
  });
});

// --- Server Context Tests (v0.0.9) ---

describe('buildContextSnapshot with Docker', () => {
  let db: Database;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'openlander-prompts-test-'));
    db = new Database(join(tmpDir, 'test.db'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('works without Docker instance (backward compatibility)', async () => {
    const snapshot = await buildContextSnapshot(db);

    // Should not include server context but still work
    expect(snapshot).toContain('Projects deployed: 0');
    expect(snapshot).toContain('Resources:');
    expect(snapshot).toContain('CPU');
  });

  it('includes server context when Docker is provided', async () => {
    // Create mock Docker with listAllContainers method
    const mockListAllContainers = vi.fn().mockResolvedValue([
      {
        id: 'abc123',
        name: 'nginx',
        image: 'nginx:1.25',
        state: 'running',
        status: 'Up 2 days',
        ports: [{ PublicPort: 80 }],
        labels: {},
        managedByOpenLander: false,
        composeProject: null,
        created: Date.now(),
      },
    ] as AllContainerInfo[]);

    const mockDocker = {
      listAllContainers: mockListAllContainers,
    } as unknown as Docker;

    const snapshot = await buildContextSnapshot(db, mockDocker);

    // Should include server context section (since we have an external container)
    expect(snapshot).toContain('Server Context');
    expect(snapshot).toContain('Deployment Rules');
    expect(mockListAllContainers).toHaveBeenCalled();
  });

  it('summarizes external containers when over 20', async () => {
    // Create 25 mock containers
    const containers: AllContainerInfo[] = [];
    for (let i = 0; i < 25; i++) {
      containers.push({
        id: `container-${i}`,
        name: `app-${i}`,
        image: i % 3 === 0 ? 'nginx:1.25' : i % 3 === 1 ? 'node:18' : 'postgres:15',
        state: 'running',
        status: 'Up 1 day',
        ports: [{ PublicPort: 3000 + i }],
        labels: {},
        managedByOpenLander: false,
        composeProject: null,
        created: Date.now(),
      });
    }

    const mockListAllContainers = vi.fn().mockResolvedValue(containers);
    const mockDocker = {
      listAllContainers: mockListAllContainers,
    } as unknown as Docker;

    const snapshot = await buildContextSnapshot(db, mockDocker);

    // Should include server context with summary format
    expect(snapshot).toContain('Server Context');
    // The summary should mention the total count
    expect(snapshot).toContain('25');
  });

  it('gracefully handles Docker scan failures', async () => {
    // Mock Docker to throw an error
    const mockListAllContainers = vi.fn().mockRejectedValue(new Error('Docker not running'));
    const mockDocker = {
      listAllContainers: mockListAllContainers,
    } as unknown as Docker;

    // Should not throw, just skip server context
    const snapshot = await buildContextSnapshot(db, mockDocker);

    // Should still have basic context
    expect(snapshot).toContain('Projects deployed:');
    expect(snapshot).toContain('Resources:');
  });
});
