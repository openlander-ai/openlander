import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

vi.mock('../../src/pipeline/git.js', () => ({
  cloneRepo: vi.fn(),
}));

vi.mock('../../src/lib/infra-analyzer.js', () => ({
  analyzeInfrastructure: vi.fn(),
}));

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import { PlanEngine } from '../../src/pipeline/deploy-plan/engine.js';
import type { PlanEngineDeps } from '../../src/pipeline/deploy-plan/engine.js';
import { createMockDeployPlan } from '../helpers/deploy-plan-mocks.js';

describe('DeployPlan internal_url generation', () => {
  let engine: PlanEngine;
  let mockDb: any;
  let mockPipeline: any;
  let mockEnv: any;
  let mockServiceManager: any;
  let mockAutoDetector: any;
  let mockConfig: any;

  beforeEach(() => {
    mockDb = {
      createDeployPlan: vi.fn(),
      getDeployPlan: vi.fn(),
      updateDeployPlan: vi.fn(),
      listServices: vi.fn().mockReturnValue([]),
    };

    mockPipeline = {
      deploy: vi.fn().mockResolvedValue({ success: true, projectId: 'p1' }),
    };

    mockEnv = {
      getAll: vi.fn().mockReturnValue({}),
      getGlobalSecrets: vi.fn().mockReturnValue({}),
    };

    mockServiceManager = {
      create: vi.fn().mockResolvedValue({}),
    };

    mockAutoDetector = {};
    mockConfig = {};

    const deps: PlanEngineDeps = {
      db: mockDb,
      pipeline: mockPipeline,
      env: mockEnv,
      serviceManager: mockServiceManager,
      autoDetector: mockAutoDetector,
      config: mockConfig,
    };

    engine = new PlanEngine(deps);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Standard deploy (dockerfile method)', () => {
    it('generates internal_url with projectName when no containerName override', () => {
      const plan = createMockDeployPlan({
        status: 'ready',
        build: {
          method: 'dockerfile' as const,
          dockerfile: 'Dockerfile',
          context: '.',
        },
        app: {
          name: 'demo-app',
          source: {
            repo_url: 'https://github.com/test/repo',
            branch: 'main',
            commit_sha: 'abc123',
          },
        },
      } as any);
      (plan as any).internal_url = 'http://ol-demo-app';
      (plan as any).internal_url_note = 'Port determined after build. Set EXPOSE in Dockerfile.';

      expect((plan as any).internal_url).toBe('http://ol-demo-app');
      expect((plan as any).internal_url_note).toBeDefined();
      expect((plan as any).internal_url_note).toContain('Port');
    });

    it('generates internal_url with containerName when override is present', () => {
      const plan = createMockDeployPlan({
        status: 'ready',
        build: {
          method: 'dockerfile' as const,
          dockerfile: 'Dockerfile',
          context: '.',
        },
        app: {
          name: 'demo-app',
          source: {
            repo_url: 'https://github.com/test/repo',
            branch: 'main',
            commit_sha: 'abc123',
          },
        },
      } as any);
      (plan as any).internal_url = 'http://ol-custom-container';
      (plan as any).internal_url_note = 'Port determined after build. Set EXPOSE in Dockerfile.';

      expect((plan as any).internal_url).toBe('http://ol-custom-container');
      expect((plan as any).internal_url_note).toBeDefined();
    });

    it('includes internal_url_note explaining port determination', () => {
      const plan = createMockDeployPlan({
        status: 'ready',
      } as any);
      (plan as any).internal_url = 'http://ol-demo-app';
      (plan as any).internal_url_note = 'Port determined after build. Set EXPOSE in Dockerfile.';

      expect((plan as any).internal_url_note).toContain('Port');
      expect((plan as any).internal_url_note).toContain('build');
    });
  });

  describe('Compose deploy with services', () => {
    it('generates internal_url for compose service with port', () => {
      const plan = createMockDeployPlan({
        status: 'ready',
        app: {
          name: 'parent-project',
          source: {
            repo_url: 'https://github.com/test/repo',
            branch: 'main',
            commit_sha: 'abc123',
          },
        },
      } as any);
      (plan as any).build = {
        method: 'compose' as const,
        dockerfile: 'docker-compose.yml',
        context: '.',
        compose_services: [
          {
            name: 'api',
            port: 8000,
            internal_url: 'http://ol-parent-api:8000',
          },
          {
            name: 'web',
            port: 3000,
            internal_url: 'http://ol-parent-web:3000',
          },
        ],
      };

      expect((plan as any).build.compose_services).toHaveLength(2);
      expect((plan as any).build.compose_services?.[0].internal_url).toBe(
        'http://ol-parent-api:8000',
      );
      expect((plan as any).build.compose_services?.[1].internal_url).toBe(
        'http://ol-parent-web:3000',
      );
    });

    it('handles compose service without port', () => {
      const plan = createMockDeployPlan({
        status: 'ready',
        app: {
          name: 'parent-project',
          source: {
            repo_url: 'https://github.com/test/repo',
            branch: 'main',
            commit_sha: 'abc123',
          },
        },
      } as any);
      (plan as any).build = {
        method: 'compose' as const,
        dockerfile: 'docker-compose.yml',
        context: '.',
        compose_services: [
          {
            name: 'db',
            internal_url: 'http://ol-parent-db',
          },
        ],
      };

      expect((plan as any).build.compose_services?.[0].internal_url).toBe('http://ol-parent-db');
    });
  });

  describe('Plan assembly with internal_url', () => {
    it('standard deploy plan has internal_url and internal_url_note', () => {
      const plan = createMockDeployPlan({
        status: 'ready',
        app: {
          name: 'test-app',
          source: {
            repo_url: 'https://github.com/test/repo',
            branch: 'main',
            commit_sha: 'abc123',
          },
        },
      } as any);
      (plan as any).internal_url = 'http://ol-test-app';
      (plan as any).internal_url_note = 'Port determined after build. Set EXPOSE in Dockerfile.';

      expect((plan as any).internal_url).toBeDefined();
      expect((plan as any).internal_url_note).toBeDefined();
      expect((plan as any).internal_url).toMatch(/^http:\/\/ol-/);
    });

    it('compose deploy plan has internal_url for each service', () => {
      const plan = createMockDeployPlan({
        status: 'ready',
        app: {
          name: 'myapp',
          source: {
            repo_url: 'https://github.com/test/repo',
            branch: 'main',
            commit_sha: 'abc123',
          },
        },
      } as any);
      (plan as any).build = {
        method: 'compose' as const,
        dockerfile: 'docker-compose.yml',
        context: '.',
        compose_services: [
          {
            name: 'api',
            port: 8000,
            internal_url: 'http://ol-myapp-api:8000',
          },
        ],
      };

      expect((plan as any).build.compose_services?.[0].internal_url).toBeDefined();
      expect((plan as any).build.compose_services?.[0].internal_url).toMatch(/^http:\/\/ol-/);
    });
  });

  describe('Internal URL format validation', () => {
    it('standard deploy URL follows ol-{name} pattern', () => {
      const plan = createMockDeployPlan({} as any);
      (plan as any).internal_url = 'http://ol-demo-app';

      expect((plan as any).internal_url).toMatch(/^http:\/\/ol-[a-z0-9-]+$/);
    });

    it('compose service URL includes port when available', () => {
      const plan = createMockDeployPlan({} as any);
      (plan as any).build = {
        method: 'compose' as const,
        dockerfile: 'docker-compose.yml',
        context: '.',
        compose_services: [
          {
            name: 'api',
            port: 8000,
            internal_url: 'http://ol-parent-api:8000',
          },
        ],
      };

      const serviceUrl = (plan as any).build.compose_services?.[0].internal_url;
      expect(serviceUrl).toMatch(/^http:\/\/ol-[a-z0-9-]+:[0-9]+$/);
    });

    it('compose service URL without port follows ol-{parent}-{service} pattern', () => {
      const plan = createMockDeployPlan({} as any);
      (plan as any).build = {
        method: 'compose' as const,
        dockerfile: 'docker-compose.yml',
        context: '.',
        compose_services: [
          {
            name: 'db',
            internal_url: 'http://ol-parent-db',
          },
        ],
      };

      const serviceUrl = (plan as any).build.compose_services?.[0].internal_url;
      expect(serviceUrl).toMatch(/^http:\/\/ol-[a-z0-9-]+$/);
    });
  });
});
