import { vi } from 'vitest';
import type { AppContext } from '../../src/app.js';
import type { Database } from '../../src/db/index.js';
import { DeployQueue } from '../../src/pipeline/deploy-queue.js';

// ---------------------------------------------------------------------------
// Shared mock factories for deploy-plan tests (T5-T10)
// ---------------------------------------------------------------------------

/**
 * Mock PlanEngine with vi.fn() stubs for all methods.
 * Used by tests that need to verify plan creation/execution without real logic.
 */
export function createMockPlanEngine(overrides?: Record<string, unknown>) {
  return {
    createPlan: vi.fn().mockResolvedValue({
      plan_id: 'plan_test123',
      status: 'ready',
    }),
    updatePlan: vi.fn().mockResolvedValue(undefined),
    executePlan: vi.fn().mockResolvedValue({
      status: 'building',
      plan_id: 'plan_test123',
      project_name: 'test-app',
      project_id: 'p1',
      estimated_seconds: 60,
    }),
    getPlan: vi.fn().mockResolvedValue(null),
    listPlans: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

/**
 * Mock DeployPlan object with sensible defaults.
 * Matches the DeployPlan structure with realistic values.
 */
export function createMockDeployPlan(overrides?: Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    plan_id: 'plan_test123',
    status: 'ready' as const,
    complexity: 'simple' as const,
    app: {
      name: 'test-app',
      source: {
        repo_url: 'https://github.com/test/repo',
        branch: 'main',
        commit_sha: 'abc123def456',
      },
    },
    build: {
      method: 'dockerfile' as const,
      dockerfile: 'Dockerfile',
      context: '.',
    },
    services: [],
    secrets: [],
    env: {
      auto: {},
      required: [],
      provided: {},
      detected: [],
    },
    health: {
      path: '/',
      retries: 10,
      interval_ms: 2000,
    },
    missing: [],
    warnings: [],
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/**
 * Mock AppContext configured for plan tests.
 * Follows the pattern from web-route-mocks.ts.
 */
export function createMockPlanContext(db?: Database): AppContext {
  // Create a minimal mock database if not provided
  const mockDb = db || ({} as Database);

  return {
    config: {
      git: { sshKeyPath: '', cloneDir: '' },
      channels: {
        slack: { enabled: false, token: '', signingSecret: '' },
        discord: { enabled: false, applicationId: '', publicKey: '', token: '' },
        telegram: { enabled: false, token: '', webhookSecret: '' },
      },
      gitProviders: { github: { token: '', username: '' }, gitlab: { token: '', username: '' } },
    } as unknown as AppContext['config'],
    db: mockDb,
    docker: {
      getClient: vi.fn(() => ({
        listContainers: vi.fn().mockResolvedValue([]),
      })),
    } as unknown as AppContext['docker'],
    pipeline: {
      deploy: vi.fn().mockResolvedValue({ success: true, projectId: 'p1' }),
    } as unknown as AppContext['pipeline'],
    composePipeline: {} as unknown as AppContext['composePipeline'],
    traefik: {} as unknown as AppContext['traefik'],
    env: {
      getAll: vi.fn().mockReturnValue({}),
      getAllMasked: vi.fn().mockReturnValue({}),
      setBulk: vi.fn().mockReturnValue(true),
      getGlobalSecrets: vi.fn().mockReturnValue({}),
    } as unknown as AppContext['env'],
    agent: null,
    deployQueue: new DeployQueue(),
    healthMonitor: {
      start: vi.fn(),
      stop: vi.fn(),
    } as unknown as AppContext['healthMonitor'],
    webhookManager: {
      triggerWebhook: vi.fn(),
    } as unknown as AppContext['webhookManager'],
    cloudflare: {} as unknown as AppContext['cloudflare'],
    blueGreen: {
      deploy: vi.fn().mockResolvedValue({ success: true }),
    } as unknown as AppContext['blueGreen'],
    dbProvisioner: {
      provision: vi.fn().mockResolvedValue({ host: 'localhost', port: 5432 }),
    } as unknown as AppContext['dbProvisioner'],
    buildDebugger: null,
    channelManager: {
      register: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      getChannel: vi.fn(),
      listConnected: vi.fn().mockReturnValue([]),
      handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppContext['channelManager'],
    previewDeployer: {
      deploy: vi.fn().mockResolvedValue({ success: true, url: 'http://preview' }),
      list: vi.fn().mockReturnValue([]),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppContext['previewDeployer'],
    jobManager: {
      trackJob: vi.fn(),
      getStatus: vi.fn().mockReturnValue(null),
      updatePhase: vi.fn(),
    } as unknown as AppContext['jobManager'],
    autoDetector: {} as unknown as AppContext['autoDetector'],
    alertMonitor: {
      getActiveAlerts: vi.fn().mockReturnValue([]),
      dismissAlert: vi.fn(),
    } as unknown as AppContext['alertMonitor'],
    questionBridge: {
      setActiveProject: vi.fn(),
      ask: vi.fn(),
      reply: vi.fn(),
      reject: vi.fn(),
      hasPending: vi.fn().mockReturnValue(false),
    } as unknown as AppContext['questionBridge'],
    serviceManager: {
      list: vi.fn().mockResolvedValue([]),
      getDetail: vi.fn().mockResolvedValue(null),
      getLogs: vi.fn().mockResolvedValue(''),
      getStats: vi.fn().mockResolvedValue({ status: 'running' }),
      listDatabases: vi.fn().mockResolvedValue([]),
      createDatabase: vi.fn().mockResolvedValue({}),
      listUsers: vi.fn().mockResolvedValue([]),
      createUser: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppContext['serviceManager'],
    mcpClientManager: {
      disconnectAll: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppContext['mcpClientManager'],
    planEngine: createMockPlanEngine() as unknown as AppContext['planEngine'],
  };
}

/**
 * Mock InfrastructureAnalysisResult with sensible defaults.
 * Used to test plan creation with infrastructure analysis.
 */
export function createMockInfraAnalysis(overrides?: Record<string, unknown>) {
  return {
    needs: [],
    available: [],
    missing: [],
    ...overrides,
  };
}
