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

  it('replaces compose-only recovery section with broad error intelligence protocol', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    expect(prompt).toContain('## Error Intelligence Protocol');
    expect(prompt).toContain('## Structured Error Output Format');
    expect(prompt).toContain('## Fix Proposal Protocol');
    expect(prompt).not.toContain('## Compose Environment Variable Recovery');
  });

  it('includes concrete recovery examples for major error classes', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    expect(prompt).toContain('missing env_file');
    expect(prompt).toContain('Dockerfile build error');
    expect(prompt).toContain('port conflict');
    expect(prompt).toContain('runtime crash');
  });

  it('enforces explain-options-choose workflow with recommendation and bounded retries', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    expect(prompt).toContain('For EVERY deploy error, follow explain');
    expect(prompt).toContain('Present options (2-4 numbered solution patterns)');
    expect(prompt).toContain('pros/cons');
    expect(prompt).toContain('Include one recommended option');
    expect(prompt).toContain('Let user choose via ask_user_question');
    expect(prompt).toContain('Maximum 3 fix attempts per failure chain');
  });

  it('keeps auto-recovery section and aligns it with explain-options-choose protocol', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    expect(prompt).toContain('## Auto-Recovery Mode');
    expect(prompt).toContain('Follow Error Intelligence Protocol');
    expect(prompt).toContain('present 2-4 options');
  });

  it('includes bounded post-failure env recovery loop for build and runtime failures', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    expect(prompt).toContain('Post-failure env recovery loop (build failure or runtime crash)');
    expect(prompt).toContain('get_deploy_status for latest state');
    expect(prompt).toContain('debug_build_error for build context');
    expect(prompt).toContain('get_logs for runtime crashes');
    expect(prompt).toContain('Ask only for missing keys via ask_user_question');
    expect(prompt).toContain('Call set_env_vars with only the missing keys/values');
    expect(prompt).toContain('hard cap at 3 attempts per failure chain');
  });

  it('classifies conflict/build/runtime/env error classes and blocks env questions on non-env failures', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    expect(prompt).toContain('already in use');
    expect(prompt).toContain('Conflict');
    expect(prompt).toContain('network already exists');
    expect(prompt).toContain('build failed');
    expect(prompt).toContain('COPY failed');
    expect(prompt).toContain('module not found');
    expect(prompt).toContain('exit code');
    expect(prompt).toContain('healthcheck failed');
    expect(prompt).toContain('undefined');
    expect(prompt).toContain('required');
    expect(prompt).toContain('not set');
    expect(prompt).toContain('Do NOT ask for env vars when evidence matches non-env classes');
  });

  it('preserves locale directive while including new protocol sections', () => {
    const prompt = buildSystemPrompt('## Context\nfoo', 'gemini', 'ko');

    expect(prompt).toContain('CRITICAL: You MUST respond to the user in Korean (한국어).');
    expect(prompt).toContain('## Error Intelligence Protocol');
    expect(prompt).toContain('## Structured Error Output Format');
    expect(prompt).toContain('## Fix Proposal Protocol');
  });

  it('includes smart env setup protocol with classification and tool flow', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    expect(prompt).toContain('## Smart Environment Variable Setup');
    expect(prompt).toContain('infrastructure');
    expect(prompt).toContain('config');
    expect(prompt).toContain('secret');
    expect(prompt).toContain('localhost');
    expect(prompt).toContain('127.0.0.1');
    expect(prompt).toContain('192.168.x.x');
    expect(prompt).toContain('call list_services');
    expect(prompt).toContain('before -> after summary');
    expect(prompt).toContain('call set_env_vars ONCE');
  });

  it('includes concrete pasted env and transformed examples', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    expect(prompt).toContain('Example pasted .env input:');
    expect(prompt).toContain('DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app');
    expect(prompt).toContain('REDIS_URL=redis://192.168.0.15:6379');
    expect(prompt).toContain('Example transformed result');
    expect(prompt).toContain('DATABASE_URL=postgresql://postgres:postgres@postgres-main:5432/app');
    expect(prompt).toContain('REDIS_URL=redis://redis-cache:6379');
  });

  it('adds deploy planning mode with explicit scan-first planning flow', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    expect(prompt).toContain('## Deploy Planning Mode');
    expect(prompt).toContain(
      'Flow is strict: scan -> classify -> ask (if needed) -> match services/env -> confirm -> execute.',
    );
    expect(prompt).toContain('Call scan_project before any deploy call.');
  });

  it('covers monorepo disambiguation and service-env-deploy sequence in planning mode', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    expect(prompt).toContain(
      'ask_user_question to let the user choose which app/service(s) to deploy.',
    );
    expect(prompt).toContain('call set_env_vars before deploy');
    expect(prompt).toContain(
      'list_services + set_env_vars -> map REDIS_URL/DB_URL for selected services',
    );
    expect(prompt).toContain('On confirmation -> deploy_monorepo, then get_deploy_status');
  });

  it('keeps deploy planning, smart env setup, and post-failure recovery sections together', () => {
    const prompt = buildSystemPrompt('', 'gemini');

    const planningIndex = prompt.indexOf('## Deploy Planning Mode');
    const smartEnvIndex = prompt.indexOf('## Smart Environment Variable Setup');
    const recoveryIndex = prompt.indexOf('## Auto-Recovery Mode');

    expect(planningIndex).toBeGreaterThan(-1);
    expect(smartEnvIndex).toBeGreaterThan(-1);
    expect(recoveryIndex).toBeGreaterThan(-1);
    expect(planningIndex).toBeLessThan(smartEnvIndex);
    expect(smartEnvIndex).toBeLessThan(recoveryIndex);

    expect(prompt).toContain(
      'Flow is strict: scan -> classify -> ask (if needed) -> match services/env -> confirm -> execute.',
    );
    expect(prompt).toContain('before -> after summary');
    expect(prompt).toContain('Post-failure env recovery loop (build failure or runtime crash)');
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
