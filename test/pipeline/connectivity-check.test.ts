import { describe, expect, it, vi } from 'vitest';

import { checkDeployConnectivity } from '../../src/pipeline/deploy/connectivity-check.js';
import type { Docker } from '../../src/pipeline/docker.js';

function createDockerMock(
  execSimple: (containerId: string, command: string[]) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>,
): Docker {
  return { execSimple: vi.fn(execSimple) } as unknown as Docker;
}

describe('checkDeployConnectivity', () => {
  it('skips connectivity checks when the container has no probe tools', async () => {
    const docker = createDockerMock(async () => {
      throw new Error('OCI runtime exec failed: exec: "sh": executable file not found');
    });

    const result = await checkDeployConnectivity({
      docker,
      containerId: 'c1',
      envVars: { DATABASE_URL: 'postgres://db:5432/app' },
    });

    expect(result).toEqual([]);
  });

  it('uses shell-based fallback commands instead of requiring nc directly', async () => {
    const docker = createDockerMock(async () => ({ stdout: '', stderr: '', exitCode: 0 }));

    const result = await checkDeployConnectivity({
      docker,
      containerId: 'c1',
      envVars: { DATABASE_URL: 'postgres://db:5432/app' },
    });

    expect(result).toEqual([
      { hostname: 'db', port: 5432, dnsResolved: true, tcpReachable: true, error: undefined },
    ]);
    const calls = vi.mocked(docker.execSimple).mock.calls;
    expect(calls.every(([, command]) => command[0] === 'sh')).toBe(true);
    expect(calls.every(([, command]) => !command.join(' ').includes('command -v nc'))).toBe(true);
    expect(calls.some(([, command]) => command.join(' ').includes('/dev/tcp'))).toBe(true);
    expect(calls.some(([, command]) => command.join(' ').includes('net.createConnection'))).toBe(
      true,
    );
  });

  it('skips TCP connectivity when bash and node are unavailable', async () => {
    const docker = createDockerMock(async (_containerId, command) => {
      const script = command.join(' ');
      if (script.includes('openlander-dns-probe')) {
        return { stdout: '', stderr: '', exitCode: 0 };
      }
      return {
        stdout: '',
        stderr: 'probe tool unavailable: bash or node required',
        exitCode: 126,
      };
    });

    const result = await checkDeployConnectivity({
      docker,
      containerId: 'c1',
      envVars: { DATABASE_URL: 'postgres://db:5432/app' },
    });

    expect(result).toEqual([]);
    expect(vi.mocked(docker.execSimple).mock.calls.every(([, command]) => {
      return !command.join(' ').includes(' nc ');
    })).toBe(true);
  });
});
