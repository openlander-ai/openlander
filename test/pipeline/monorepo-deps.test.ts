import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ServiceNode } from '../../src/pipeline/orchestrator.js';

const { mockWarn } = vi.hoisted(() => ({
  mockWarn: vi.fn(),
}));

vi.mock('../../src/lib/logger.js', () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: mockWarn,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { detectMonorepoDependencies } from '../../src/pipeline/deploy/monorepo-deps.js';

describe('detectMonorepoDependencies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Worker with API dependency deploys after API', () => {
    const services: ServiceNode[] = [
      { name: 'api', dependsOn: [], dockerfile: 'api/Dockerfile' },
      { name: 'worker', dependsOn: [], dockerfile: 'worker/Dockerfile' },
    ];

    detectMonorepoDependencies(services, 'mono', (serviceName): Record<string, string> => {
      if (serviceName === 'worker') {
        return { API_URL: 'http://ol-mono-api:4000' };
      }
      return {};
    });

    expect(services.find((service) => service.name === 'api')?.dependsOn).toEqual([]);
    expect(services.find((service) => service.name === 'worker')?.dependsOn).toEqual(['api']);
    expect(mockWarn).not.toHaveBeenCalled();
  });

  it('Circular dependency falls back to parallel and logs warning', () => {
    const services: ServiceNode[] = [
      { name: 'service-a', dependsOn: [], dockerfile: 'a/Dockerfile' },
      { name: 'service-b', dependsOn: [], dockerfile: 'b/Dockerfile' },
    ];

    detectMonorepoDependencies(services, 'mono', (serviceName): Record<string, string> => {
      if (serviceName === 'service-a') {
        return { URL: 'http://ol-mono-service-b:3000' };
      }
      if (serviceName === 'service-b') {
        return { URL: 'http://ol-mono-service-a:3000' };
      }
      return {};
    });

    for (const service of services) {
      expect(service.dependsOn).toEqual([]);
    }
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it('Services with no cross-references deploy in parallel', () => {
    const services: ServiceNode[] = [
      { name: 'api', dependsOn: [], dockerfile: 'api/Dockerfile' },
      { name: 'frontend', dependsOn: [], dockerfile: 'frontend/Dockerfile' },
    ];

    detectMonorepoDependencies(services, 'app', () => ({}));

    for (const service of services) {
      expect(service.dependsOn).toEqual([]);
    }
    expect(mockWarn).not.toHaveBeenCalled();
  });
});
