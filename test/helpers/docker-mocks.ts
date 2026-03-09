import { vi } from 'vitest';
import type { Docker } from '../../src/pipeline/docker.js';

// ---------------------------------------------------------------------------
// Shared Docker mock factories (used by traefik.test.ts, preflight.test.ts)
// ---------------------------------------------------------------------------

export type MockContainer = {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  ports: Array<{ PublicPort?: number }>;
  labels: Record<string, string>;
  managedByOpenLander: boolean;
  composeProject: string | null;
  created: number;
};

export function createMockContainer(
  name: string,
  options: {
    image?: string;
    state?: string;
    ports?: Array<{ PublicPort?: number }>;
    labels?: Record<string, string>;
  } = {},
): MockContainer {
  return {
    id: `container-${name}`,
    name,
    image: options.image ?? 'test-image:latest',
    state: options.state ?? 'running',
    status: 'Up 2 hours',
    ports: options.ports ?? [],
    labels: options.labels ?? {},
    managedByOpenLander: options.labels?.['openlander.managed'] === 'true',
    composeProject: null,
    created: Date.now(),
  };
}

export function createMockDocker(containers: MockContainer[] = []): Docker {
  return {
    listAllContainers: vi.fn().mockResolvedValue(containers),
    removeContainer: vi.fn().mockResolvedValue(undefined),
    getClient: vi.fn().mockReturnValue({
      listContainers: vi.fn().mockResolvedValue([]),
      getNetwork: vi.fn().mockReturnValue({
        connect: vi.fn().mockResolvedValue(undefined),
      }),
    }),
  } as unknown as Docker;
}

export function createMockDockerWithError(): Docker {
  return {
    listAllContainers: vi.fn().mockRejectedValue(new Error('Docker daemon not running')),
  } as unknown as Docker;
}
