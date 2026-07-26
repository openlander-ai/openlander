import { createRequire } from 'node:module';
import type Dockerode from 'dockerode';
import { getPolicy } from '../../config/index.js';
import { resolveDockerSocket } from './helpers.js';

export interface DockerContext {
  readonly client: Dockerode;
  readonly networkName: string;
  readonly instanceId?: string;
}

export function createDockerContext(
  socketPath?: string,
  networkName?: string,
  instanceId?: string,
): DockerContext {
  const require = createRequire(import.meta.url);

  const dockerSshModulePath = require.resolve('docker-modem/lib/ssh.js');
  if (!require.cache[dockerSshModulePath]) {
    const dockerSshStub = {
      id: dockerSshModulePath,
      filename: dockerSshModulePath,
      loaded: true,
      exports: () => {
        throw new Error('Docker SSH transport is unavailable in this runtime');
      },
    } as unknown as NodeJS.Module;
    require.cache[dockerSshModulePath] = dockerSshStub;
  }

  const dockerodeModule = require('dockerode') as
    { default?: new (options?: unknown) => Dockerode } | (new (options?: unknown) => Dockerode);
  const DockerodeClass =
    typeof dockerodeModule === 'function' ? dockerodeModule : dockerodeModule.default;
  if (!DockerodeClass) {
    throw new Error('Failed to load dockerode constructor');
  }

  const resolvedNetworkName = networkName ?? getPolicy('production').networkName;
  const client = socketPath
    ? new DockerodeClass({ socketPath })
    : (() => {
        const resolved = resolveDockerSocket();
        return resolved ? new DockerodeClass({ socketPath: resolved }) : new DockerodeClass();
      })();

  return {
    client,
    networkName: resolvedNetworkName,
    instanceId,
  };
}
