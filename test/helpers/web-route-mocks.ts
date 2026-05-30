import { vi } from 'vitest';
import type { AppContext } from '../../src/app.js';
import type { Database } from '../../src/db/index.js';
import { LlmCircuitBreaker } from '../../src/llm/llm-circuit-breaker.js';
import { ModelRegistry } from '../../src/llm/model-registry.js';
import { DeployQueue } from '../../src/pipeline/deploy-queue.js';
import type { EventBus } from '../../src/events/index.js';

// ---------------------------------------------------------------------------
// Shared mock factories for web-routes.test.ts
// ---------------------------------------------------------------------------

export function createMockDocker() {
  return {
    listAllContainers: vi.fn().mockResolvedValue([]),
    inspectContainer: vi.fn(),
    getContainerStats: vi.fn().mockResolvedValue({
      cpu_stats: {
        cpu_usage: { total_usage: 100, percpu_usage: [100] },
        system_cpu_usage: 1000,
      },
      precpu_stats: { cpu_usage: { total_usage: 0 } },
      memory_stats: { usage: 1024 * 1024 * 100, limit: 1024 * 1024 * 1024 },
    }),
    startContainer: vi.fn(),
    getLogs: vi.fn().mockResolvedValue(''),
  } as unknown as AppContext;
}

export function createMockPipeline() {
  const tunnel = {
    enableSharedMode: vi.fn(),
    disableSharedMode: vi.fn(),
  };

  return {
    deploy: vi
      .fn()
      .mockResolvedValue({ success: true, projectId: 'p1', url: 'http://localhost:10001' }),
    deployEnvironment: vi.fn().mockResolvedValue({ success: true, url: 'http://localhost:10002' }),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    redeploy: vi.fn().mockResolvedValue({ success: true }),
    remove: vi.fn().mockResolvedValue(undefined),
    archive: vi.fn().mockResolvedValue(undefined),
    archiveGroup: vi.fn().mockResolvedValue(undefined),
    unarchive: vi.fn().mockResolvedValue(undefined),
    unarchiveGroup: vi.fn().mockResolvedValue(undefined),
    getLogs: vi.fn().mockResolvedValue('log output'),
    exposeTunnel: vi.fn().mockResolvedValue('https://abc.trycloudflare.com'),
    closeTunnel: vi.fn(),
    rollback: vi.fn().mockResolvedValue({ success: true }),
    getTunnel: vi.fn().mockReturnValue(tunnel),
    deployPreview: vi
      .fn()
      .mockResolvedValue({ success: true, url: 'http://preview-app.localhost' }),
  };
}

export function createMockEnvManager() {
  return {
    getAll: vi.fn().mockReturnValue({ API_KEY: 'sk-1234567890abcdef' }),
    setBulk: vi.fn().mockReturnValue(true),
    getGlobalSecrets: vi.fn().mockReturnValue({}),
  };
}

export function createMockQuestionBridge() {
  return {
    setActiveProject: vi.fn(),
    ask: vi.fn(),
    reply: vi.fn(),
    reject: vi.fn(),
    hasPending: vi.fn().mockReturnValue(false),
  };
}

export function createMockJobManager() {
  return {
    trackJob: vi.fn(),
    getStatus: vi.fn().mockReturnValue(null),
    updatePhase: vi.fn(),
  };
}

export function createMockChannelManager() {
  return {
    register: vi.fn(),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    getChannel: vi.fn(),
    listConnected: vi.fn().mockReturnValue([]),
    handleIncomingMessage: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockServiceManager() {
  const baseService = {
    id: 'svc-1',
    name: 'shared-pg',
    type: 'postgresql',
    image: 'postgres:16-alpine',
    status: 'running',
    container_id: 'container-1',
    container_name: 'ol-svc-shared-pg',
    port: 5432,
    env_vars: null,
    credentials: '{}',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  return {
    list: vi.fn().mockResolvedValue([]),
    listWithCardSummary: vi.fn().mockResolvedValue([]),
    getDetail: vi.fn().mockResolvedValue(baseService),
    getLogs: vi.fn().mockResolvedValue('service logs'),
    getStats: vi.fn().mockResolvedValue({ status: 'running', diskUsageBytes: 128 }),
    listDatabases: vi.fn().mockResolvedValue([
      { name: 'openlander', sizeBytes: 1024 },
      { name: 'postgres', sizeBytes: 2048 },
    ]),
    createDatabase: vi.fn().mockResolvedValue({
      database: 'appdb',
      user: 'openlander',
      password: 'pw',
      connectionString: 'postgresql://openlander:pw@ol-svc-shared-pg:5432/appdb',
    }),
    listUsers: vi.fn().mockResolvedValue([{ name: 'openlander' }]),
    createUser: vi.fn().mockResolvedValue({
      database: 'openlander',
      user: 'app_user',
      password: 'pw',
      connectionString: 'postgresql://app_user:pw@ol-svc-shared-pg:5432/openlander',
    }),
    create: vi.fn().mockResolvedValue(baseService),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockAgent() {
  return {
    chat: vi.fn().mockResolvedValue({ message: 'AI response', toolResults: undefined }),
    chatStream: vi
      .fn()
      .mockImplementation(
        async (_msg: string, callback: (e: { type: string; content?: string }) => void) => {
          callback({ type: 'session' });
          callback({ type: 'message', content: 'AI response' });
          callback({ type: 'done' });
        },
      ),
    setTools: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    clearHistory: vi.fn(),
  };
}

export function createMockContext(db: Database): AppContext {
  const llmCircuitBreaker = new LlmCircuitBreaker();

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
    db,
    docker: createMockDocker() as unknown as AppContext['docker'],
    pipeline: createMockPipeline() as unknown as AppContext['pipeline'],
    composePipeline: {} as unknown as AppContext['composePipeline'],
    traefik: {} as unknown as AppContext['traefik'],
    env: createMockEnvManager() as unknown as AppContext['env'],
    channelManager: createMockChannelManager() as unknown as AppContext['channelManager'],
    agentPool: null,
    agent: createMockAgent() as unknown as AppContext['agent'],
    modelRegistry: new ModelRegistry(
      { providers: {}, defaultRoute: { providerId: 'none' } },
      {
        emit: vi.fn().mockResolvedValue(undefined),
      } as unknown as EventBus,
      llmCircuitBreaker,
    ),
    llmCircuitBreaker,
    model: null,
    deployQueue: new DeployQueue(),
    serviceManager: createMockServiceManager() as unknown as AppContext['serviceManager'],
    buildDebugger: null,
    previewDeployer: {
      deploy: vi.fn().mockResolvedValue({ success: true, url: 'http://preview' }),
      list: vi.fn().mockReturnValue([]),
      cleanup: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppContext['previewDeployer'],
    jobManager: createMockJobManager() as unknown as AppContext['jobManager'],
    autoDetector: {} as unknown as AppContext['autoDetector'],
    alertMonitor: {
      getActiveAlerts: vi.fn().mockReturnValue([]),
      dismissAlert: vi.fn(),
    } as unknown as AppContext['alertMonitor'],
    questionBridge: createMockQuestionBridge() as unknown as AppContext['questionBridge'],
    cloudflare: {} as unknown as AppContext['cloudflare'],
    mcpClientManager: {
      disconnectAll: vi.fn().mockResolvedValue(undefined),
    } as unknown as AppContext['mcpClientManager'],
    planEngine: {
      createPlan: vi.fn().mockResolvedValue({ plan_id: 'plan-test', status: 'ready' }),
      updatePlan: vi.fn(),
      executePlan: vi
        .fn()
        .mockResolvedValue({ status: 'building', plan_id: 'plan-test', project_id: 'p1' }),
    } as unknown as AppContext['planEngine'],
    coordinator: {
      suppressProject: vi.fn(),
      stop: vi.fn(),
      setOpsAgent: vi.fn(),
      setConfigGetter: vi.fn(),
      setDeploymentRecovery: vi.fn(),
    } as unknown as AppContext['coordinator'],
    approvalGate: {
      dispose: vi.fn(),
    } as unknown as AppContext['approvalGate'],
    providerHealth: {
      start: vi.fn(),
      stop: vi.fn(),
      checkAll: vi.fn(),
      getHealth: vi.fn().mockReturnValue(null),
      getAllHealth: vi.fn().mockReturnValue(new Map()),
    } as unknown as AppContext['providerHealth'],
    llmVerified: false,
  } as unknown as AppContext;
}
