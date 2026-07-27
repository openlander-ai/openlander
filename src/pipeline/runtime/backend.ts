import type { ContainerOps } from '../docker/container.js';
import type { ExecOps } from '../docker/exec.js';
import type { ImageOps } from '../docker/image.js';
import type { InfraOps } from '../docker/infra.js';
import type { NetworkOps } from '../docker/network.js';
import type { StreamOps } from '../docker/stream.js';
import type { DockerStatus } from '../docker/types.js';
import type { VolumeOps } from '../docker/volume.js';

export type RuntimeBackendKind = 'docker';

/**
 * First-stage runtime seam.
 *
 * The first implementation is Docker, but callers depend on this contract
 * rather than the Docker facade class. The method names still use current
 * container vocabulary; future backends should narrow this surface in smaller
 * domain-specific interfaces before adding non-Docker implementations.
 */
export interface RuntimeBackend {
  readonly kind: RuntimeBackendKind;
  readonly backendName: string;

  runContainer(
    options: Parameters<ContainerOps['runContainer']>[0],
    serverId?: string,
  ): ReturnType<ContainerOps['runContainer']>;
  runComposeService(
    ...args: Parameters<ContainerOps['runComposeService']>
  ): ReturnType<ContainerOps['runComposeService']>;
  runInfraContainer(
    ...args: Parameters<ContainerOps['runInfraContainer']>
  ): ReturnType<ContainerOps['runInfraContainer']>;
  stopContainer(
    ...args: Parameters<ContainerOps['stopContainer']>
  ): ReturnType<ContainerOps['stopContainer']>;
  startContainer(
    ...args: Parameters<ContainerOps['startContainer']>
  ): ReturnType<ContainerOps['startContainer']>;
  removeContainer(
    ...args: Parameters<ContainerOps['removeContainer']>
  ): ReturnType<ContainerOps['removeContainer']>;
  safeRemoveContainer(
    containerId: Parameters<ContainerOps['safeRemoveContainer']>[0],
    serverId?: string,
  ): ReturnType<ContainerOps['safeRemoveContainer']>;
  inspectContainer(
    containerId: Parameters<ContainerOps['inspectContainer']>[0],
    serverId?: string,
  ): ReturnType<ContainerOps['inspectContainer']>;
  restartContainer(
    ...args: Parameters<ContainerOps['restartContainer']>
  ): ReturnType<ContainerOps['restartContainer']>;
  getContainerStats(
    ...args: Parameters<ContainerOps['getContainerStats']>
  ): ReturnType<ContainerOps['getContainerStats']>;
  renameContainer(
    ...args: Parameters<ContainerOps['renameContainer']>
  ): ReturnType<ContainerOps['renameContainer']>;
  waitForContainer(
    ...args: Parameters<ContainerOps['waitForContainer']>
  ): ReturnType<ContainerOps['waitForContainer']>;
  runServiceContainer(
    ...args: Parameters<ContainerOps['runServiceContainer']>
  ): ReturnType<ContainerOps['runServiceContainer']>;
  waitForHealthy(
    ...args: Parameters<ContainerOps['waitForHealthy']>
  ): ReturnType<ContainerOps['waitForHealthy']>;
  listManagedContainers(serverId?: string): ReturnType<ContainerOps['listManagedContainers']>;
  listAllContainers(serverId?: string): ReturnType<ContainerOps['listAllContainers']>;

  buildImage(
    contextPath: Parameters<ImageOps['buildImage']>[0],
    tag: Parameters<ImageOps['buildImage']>[1],
    options?: Parameters<ImageOps['buildImage']>[2],
    serverId?: string,
  ): ReturnType<ImageOps['buildImage']>;
  cancelBuild(...args: Parameters<ImageOps['cancelBuild']>): ReturnType<ImageOps['cancelBuild']>;
  buildComposeService(
    ...args: Parameters<ImageOps['buildComposeService']>
  ): ReturnType<ImageOps['buildComposeService']>;
  pullImage(...args: Parameters<ImageOps['pullImage']>): ReturnType<ImageOps['pullImage']>;
  inspectImage(...args: Parameters<ImageOps['inspectImage']>): ReturnType<ImageOps['inspectImage']>;
  removeImage(...args: Parameters<ImageOps['removeImage']>): ReturnType<ImageOps['removeImage']>;
  tagImage(...args: Parameters<ImageOps['tagImage']>): ReturnType<ImageOps['tagImage']>;
  getImageExposedPort(
    ...args: Parameters<ImageOps['getImageExposedPort']>
  ): ReturnType<ImageOps['getImageExposedPort']>;
  listDanglingImages(
    ...args: Parameters<ImageOps['listDanglingImages']>
  ): ReturnType<ImageOps['listDanglingImages']>;

  ensureSharedNetworkAttachment(
    ...args: Parameters<NetworkOps['ensureSharedNetworkAttachment']>
  ): ReturnType<NetworkOps['ensureSharedNetworkAttachment']>;
  connectContainerToNetwork(
    ...args: Parameters<NetworkOps['connectContainerToNetwork']>
  ): ReturnType<NetworkOps['connectContainerToNetwork']>;
  disconnectContainerFromNetwork(
    ...args: Parameters<NetworkOps['disconnectContainerFromNetwork']>
  ): ReturnType<NetworkOps['disconnectContainerFromNetwork']>;
  getNetworkInfo(
    ...args: Parameters<NetworkOps['getNetworkInfo']>
  ): ReturnType<NetworkOps['getNetworkInfo']>;
  listNetworks(
    ...args: Parameters<NetworkOps['listNetworks']>
  ): ReturnType<NetworkOps['listNetworks']>;
  removeUnusedNetwork(
    ...args: Parameters<NetworkOps['removeUnusedNetwork']>
  ): ReturnType<NetworkOps['removeUnusedNetwork']>;
  ensureProjectNetwork(
    ...args: Parameters<NetworkOps['ensureProjectNetwork']>
  ): ReturnType<NetworkOps['ensureProjectNetwork']>;
  removeProjectNetwork(
    ...args: Parameters<NetworkOps['removeProjectNetwork']>
  ): ReturnType<NetworkOps['removeProjectNetwork']>;
  ensureNetwork(
    ...args: Parameters<NetworkOps['ensureNetwork']>
  ): ReturnType<NetworkOps['ensureNetwork']>;

  inspectVolume(
    ...args: Parameters<VolumeOps['inspectVolume']>
  ): ReturnType<VolumeOps['inspectVolume']>;
  listVolumes(...args: Parameters<VolumeOps['listVolumes']>): ReturnType<VolumeOps['listVolumes']>;
  createVolume(
    ...args: Parameters<VolumeOps['createVolume']>
  ): ReturnType<VolumeOps['createVolume']>;
  removeVolume(
    ...args: Parameters<VolumeOps['removeVolume']>
  ): ReturnType<VolumeOps['removeVolume']>;
  seedVolumeFromDirectory(
    ...args: Parameters<VolumeOps['seedVolumeFromDirectory']>
  ): ReturnType<VolumeOps['seedVolumeFromDirectory']>;

  execSimple(
    containerId: Parameters<ExecOps['execSimple']>[0],
    cmd: Parameters<ExecOps['execSimple']>[1],
    opts?: Parameters<ExecOps['execSimple']>[2],
    serverId?: string,
  ): ReturnType<ExecOps['execSimple']>;
  execStream(...args: Parameters<ExecOps['execStream']>): ReturnType<ExecOps['execStream']>;
  execTerminal(...args: Parameters<ExecOps['execTerminal']>): ReturnType<ExecOps['execTerminal']>;

  getLogs(...args: Parameters<StreamOps['getLogs']>): ReturnType<StreamOps['getLogs']>;
  getLogStream(
    ...args: Parameters<StreamOps['getLogStream']>
  ): ReturnType<StreamOps['getLogStream']>;
  getEventStream(
    ...args: Parameters<StreamOps['getEventStream']>
  ): ReturnType<StreamOps['getEventStream']>;

  ping(...args: Parameters<InfraOps['ping']>): ReturnType<InfraOps['ping']>;
  ensureRunning(
    ...args: Parameters<InfraOps['ensureRunning']>
  ): ReturnType<InfraOps['ensureRunning']>;
  getDiskUsage(...args: Parameters<InfraOps['getDiskUsage']>): ReturnType<InfraOps['getDiskUsage']>;
  status(): Promise<DockerStatus>;

  cleanupSecretFiles(name: string): void;
  getNetworkName(): string;
  getInstanceId?(): string | undefined;
}
