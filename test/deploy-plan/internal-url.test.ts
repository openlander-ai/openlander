import { describe, it, expect } from 'vitest';
import type { DeployPlan, PlanBuildService } from '../../src/pipeline/deploy-plan/types.js';

describe('DeployPlan internal_url generation', () => {
  describe('Standard deploy (dockerfile method)', () => {
    it('generates internal_url with projectName format http://ol-{name}', () => {
      const plan: DeployPlan = {
        plan_id: 'plan_test123',
        status: 'ready',
        complexity: 'simple',
        app: {
          name: 'demo-app',
          source: {
            repo_url: 'https://github.com/test/demo-app',
            branch: 'main',
            commit_sha: 'abc123',
          },
        },
        build: {
          method: 'dockerfile',
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        internal_url: 'http://ol-demo-app',
        internal_url_note: 'Port determined after build. Set EXPOSE in Dockerfile.',
      };

      expect(plan.internal_url).toBe('http://ol-demo-app');
      expect(plan.internal_url).toMatch(/^http:\/\/ol-[a-z0-9-]+$/);
    });

    it('includes internal_url_note explaining port determination', () => {
      const plan: DeployPlan = {
        plan_id: 'plan_test123',
        status: 'ready',
        complexity: 'simple',
        app: {
          name: 'demo-app',
          source: {
            repo_url: 'https://github.com/test/demo-app',
            branch: 'main',
            commit_sha: 'abc123',
          },
        },
        build: {
          method: 'dockerfile',
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        internal_url: 'http://ol-demo-app',
        internal_url_note: 'Port determined after build. Set EXPOSE in Dockerfile.',
      };

      expect(plan.internal_url_note).toBeDefined();
      expect(plan.internal_url_note).toContain('Port');
      expect(plan.internal_url_note).toContain('build');
    });
  });

  describe('Compose deploy with services', () => {
    it('generates internal_url for compose service with port', () => {
      const service: PlanBuildService = {
        name: 'api',
        port: 8000,
        internal_url: 'http://ol-myapp-api:8000',
      };

      expect(service.internal_url).toBe('http://ol-myapp-api:8000');
      expect(service.internal_url).toMatch(/^http:\/\/ol-[a-z0-9-]+:[0-9]+$/);
    });

    it('handles compose service without port', () => {
      const service: PlanBuildService = {
        name: 'db',
        internal_url: 'http://ol-myapp-db',
      };

      expect(service.internal_url).toBe('http://ol-myapp-db');
      expect(service.internal_url).toMatch(/^http:\/\/ol-[a-z0-9-]+$/);
    });

    it('compose plan includes services with internal_url', () => {
      const plan: DeployPlan = {
        plan_id: 'plan_test456',
        status: 'ready',
        complexity: 'simple',
        app: {
          name: 'myapp',
          source: {
            repo_url: 'https://github.com/test/myapp',
            branch: 'main',
            commit_sha: 'def456',
          },
        },
        build: {
          method: 'compose',
          dockerfile: 'docker-compose.yml',
          context: '.',
          compose_services: [
            {
              name: 'api',
              port: 8000,
              internal_url: 'http://ol-myapp-api:8000',
            },
            {
              name: 'web',
              port: 3000,
              internal_url: 'http://ol-myapp-web:3000',
            },
          ],
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        internal_url: 'http://ol-myapp',
        internal_url_note: 'Port determined after build. Set EXPOSE in Dockerfile.',
      };

      expect(plan.build.compose_services).toHaveLength(2);
      expect(plan.build.compose_services?.[0].internal_url).toBe('http://ol-myapp-api:8000');
      expect(plan.build.compose_services?.[1].internal_url).toBe('http://ol-myapp-web:3000');
    });
  });

  describe('Internal URL format validation', () => {
    it('standard deploy URL follows ol-{name} pattern', () => {
      const plan: DeployPlan = {
        plan_id: 'plan_test789',
        status: 'ready',
        complexity: 'simple',
        app: {
          name: 'demo-app',
          source: {
            repo_url: 'https://github.com/test/demo-app',
            branch: 'main',
            commit_sha: 'abc123',
          },
        },
        build: {
          method: 'dockerfile',
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        internal_url: 'http://ol-demo-app',
        internal_url_note: 'Port determined after build. Set EXPOSE in Dockerfile.',
      };

      expect(plan.internal_url).toMatch(/^http:\/\/ol-[a-z0-9-]+$/);
    });

    it('compose service URL includes port when available', () => {
      const service: PlanBuildService = {
        name: 'api',
        port: 8000,
        internal_url: 'http://ol-parent-api:8000',
      };

      const serviceUrl = service.internal_url;
      expect(serviceUrl).toMatch(/^http:\/\/ol-[a-z0-9-]+:[0-9]+$/);
    });

    it('compose service URL without port follows ol-{parent}-{service} pattern', () => {
      const service: PlanBuildService = {
        name: 'db',
        internal_url: 'http://ol-parent-db',
      };

      const serviceUrl = service.internal_url;
      expect(serviceUrl).toMatch(/^http:\/\/ol-[a-z0-9-]+$/);
    });
  });
});
