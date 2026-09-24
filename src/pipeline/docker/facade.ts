import { createDockerContext, type DockerContext } from './context.js';
import { ContainerOps } from './container.js';
import { ExecOps } from './exec.js';
import { cleanupSecretFiles, dockerStatus } from './helpers.js';
import { ImageOps } from './image.js';
import { InfraOps } from './infra.js';
import { NetworkOps } from './network.js';
import { StreamOps } from './stream.js';
import type { DockerStatus } from './types.js';
import { VolumeOps } from './volume.js';
import { clearPortScanCache } from '../port.js';
import type { RuntimeBackend } from '../runtime/backend.js';

export class Docker implements RuntimeBackend {
  readonly kind = 'docker';
  readonly backendName = 'docker';

  private readonly ctx: DockerContext;
  private readonly containerOps: ContainerOps;
  private readonly imageOps: ImageOps;
  private readonly networkOps: NetworkOps;
  private readonly volumeOps: VolumeOps;
  private readonly execOps: ExecOps;
  private readonly streamOps: StreamOps;
  private readonly infraOps: InfraOps;

  constructor(
    socketPath?: string,
    networkName?: string,
    instanceId?: string,
    projectNetworkPoolCidr?: string,
  ) {
    this.ctx = createDockerContext(socketPath, networkName, instanceId, projectNetworkPoolCidr);
    this.networkOps = new NetworkOps(this.ctx);
    this.containerOps = new ContainerOps(this.ctx, {
      ensureSharedNetworkAttachment: (containerId, alias) =>
        this.networkOps.ensureSharedNetworkAttachment(containerId, alias),
      connectToNetworkStrict: (containerId, strictNetworkName) =>
        this.networkOps.connectToNetworkStrict(containerId, strictNetworkName),
    });
    this.imageOps = new ImageOps(this.ctx);
    this.volumeOps = new VolumeOps(this.ctx);
    this.execOps = new ExecOps(this.ctx);
    this.streamOps = new StreamOps(this.ctx);
    this.infraOps = new InfraOps(this.ctx);
  }

  private async runContainerStart<T>(operation: () => Promise<T>): Promise<T> {
    const result = await operation();
    clearPortScanCache();
    return result;
  }

  runContainer(options: Parameters<ContainerOps['runContainer']>[0], _serverId?: string) {
    return this.runContainerStart(() => this.containerOps.runContainer(options));
  }

  runEphemeralContainer(...args: Parameters<ContainerOps['runEphemeralContainer']>) {
    return this.containerOps.runEphemeralContainer(...args);
  }

  runUtilityContainer(...args: Parameters<ContainerOps['runUtilityContainer']>) {
    return this.containerOps.runUtilityContainer(...args);
  }

  runComposeService(...args: Parameters<ContainerOps['runComposeService']>) {
    return this.runContainerStart(() => this.containerOps.runComposeService(...args));
  }

  runInfraContainer(...args: Parameters<ContainerOps['runInfraContainer']>) {
    return this.runContainerStart(() => this.containerOps.runInfraContainer(...args));
  }

  stopContainer(...args: Parameters<ContainerOps['stopContainer']>) {
    return this.containerOps.stopContainer(...args);
  }

  startContainer(...args: Parameters<ContainerOps['startContainer']>) {
    return this.runContainerStart(() => this.containerOps.startContainer(...args));
  }

  removeContainer(...args: Parameters<ContainerOps['removeContainer']>) {
    return this.containerOps.removeContainer(...args);
  }

  safeRemoveContainer(
    containerId: Parameters<ContainerOps['safeRemoveContainer']>[0],
    _serverId?: string,
  ) {
    return this.containerOps.safeRemoveContainer(containerId);
  }

  inspectContainer(
    containerId: Parameters<ContainerOps['inspectContainer']>[0],
    _serverId?: string,
  ) {
    return this.containerOps.inspectContainer(containerId);
  }

  updateContainerMemory(...args: Parameters<ContainerOps['updateContainerMemory']>) {
    return this.containerOps.updateContainerMemory(...args);
  }

  restartContainer(...args: Parameters<ContainerOps['restartContainer']>) {
    return this.runContainerStart(() => this.containerOps.restartContainer(...args));
  }

  getContainerStats(...args: Parameters<ContainerOps['getContainerStats']>) {
    return this.containerOps.getContainerStats(...args);
  }

  renameContainer(...args: Parameters<ContainerOps['renameContainer']>) {
    return this.containerOps.renameContainer(...args);
  }

  waitForContainer(...args: Parameters<ContainerOps['waitForContainer']>) {
    return this.containerOps.waitForContainer(...args);
  }

  runServiceContainer(...args: Parameters<ContainerOps['runServiceContainer']>) {
    return this.runContainerStart(() => this.containerOps.runServiceContainer(...args));
  }

  waitForHealthy(...args: Parameters<ContainerOps['waitForHealthy']>) {
    return this.containerOps.waitForHealthy(...args);
  }

  listManagedContainers(_serverId?: string) {
    return this.containerOps.listManagedContainers();
  }

  listAllContainers(
    _serverId?: string,
    options?: Parameters<ContainerOps['listAllContainers']>[0],
  ) {
    return this.containerOps.listAllContainers(options);
  }

  buildImage(
    contextPath: Parameters<ImageOps['buildImage']>[0],
    tag: Parameters<ImageOps['buildImage']>[1],
    options?: Parameters<ImageOps['buildImage']>[2],
    _serverId?: string,
  ) {
    return this.imageOps.buildImage(contextPath, tag, options);
  }

  cancelBuild(...args: Parameters<ImageOps['cancelBuild']>) {
    return this.imageOps.cancelBuild(...args);
  }

  buildComposeService(...args: Parameters<ImageOps['buildComposeService']>) {
    return this.imageOps.buildComposeService(...args);
  }

  pullImage(...args: Parameters<ImageOps['pullImage']>) {
    return this.imageOps.pullImage(...args);
  }

  inspectImage(...args: Parameters<ImageOps['inspectImage']>) {
    return this.imageOps.inspectImage(...args);
  }

  removeImage(...args: Parameters<ImageOps['removeImage']>) {
    return this.imageOps.removeImage(...args);
  }

  tagImage(...args: Parameters<ImageOps['tagImage']>) {
    return this.imageOps.tagImage(...args);
  }

  getImageExposedPort(...args: Parameters<ImageOps['getImageExposedPort']>) {
    return this.imageOps.getImageExposedPort(...args);
  }

  listDanglingImages(...args: Parameters<ImageOps['listDanglingImages']>) {
    return this.imageOps.listDanglingImages(...args);
  }

  ensureSharedNetworkAttachment(...args: Parameters<NetworkOps['ensureSharedNetworkAttachment']>) {
    return this.networkOps.ensureSharedNetworkAttachment(...args);
  }

  connectContainerToNetwork(...args: Parameters<NetworkOps['connectContainerToNetwork']>) {
    return this.networkOps.connectContainerToNetwork(...args);
  }

  disconnectContainerFromNetwork(
    ...args: Parameters<NetworkOps['disconnectContainerFromNetwork']>
  ) {
    return this.networkOps.disconnectContainerFromNetwork(...args);
  }

  getNetworkInfo(...args: Parameters<NetworkOps['getNetworkInfo']>) {
    return this.networkOps.getNetworkInfo(...args);
  }

  listNetworks(...args: Parameters<NetworkOps['listNetworks']>) {
    return this.networkOps.listNetworks(...args);
  }

  removeUnusedNetwork(...args: Parameters<NetworkOps['removeUnusedNetwork']>) {
    return this.networkOps.removeUnusedNetwork(...args);
  }

  preflightProjectNetwork(...args: Parameters<NetworkOps['preflightProjectNetwork']>) {
    return this.networkOps.preflightProjectNetwork(...args);
  }

  getProjectNetworkPoolStatus(...args: Parameters<NetworkOps['getProjectNetworkPoolStatus']>) {
    return this.networkOps.getProjectNetworkPoolStatus(...args);
  }

  ensureProjectNetwork(...args: Parameters<NetworkOps['ensureProjectNetwork']>) {
    return this.networkOps.ensureProjectNetwork(...args);
  }

  removeProjectNetwork(...args: Parameters<NetworkOps['removeProjectNetwork']>) {
    return this.networkOps.removeProjectNetwork(...args);
  }

  ensureNetwork(...args: Parameters<NetworkOps['ensureNetwork']>) {
    return this.networkOps.ensureNetwork(...args);
  }

  inspectVolume(...args: Parameters<VolumeOps['inspectVolume']>) {
    return this.volumeOps.inspectVolume(...args);
  }

  listVolumes(...args: Parameters<VolumeOps['listVolumes']>) {
    return this.volumeOps.listVolumes(...args);
  }

  createVolume(...args: Parameters<VolumeOps['createVolume']>) {
    return this.volumeOps.createVolume(...args);
  }

  removeVolume(...args: Parameters<VolumeOps['removeVolume']>) {
    return this.volumeOps.removeVolume(...args);
  }

  seedVolumeFromDirectory(...args: Parameters<VolumeOps['seedVolumeFromDirectory']>) {
    return this.volumeOps.seedVolumeFromDirectory(...args);
  }

  execSimple(
    containerId: Parameters<ExecOps['execSimple']>[0],
    cmd: Parameters<ExecOps['execSimple']>[1],
    opts?: Parameters<ExecOps['execSimple']>[2],
    _serverId?: string,
  ) {
    return opts
      ? this.execOps.execSimple(containerId, cmd, opts)
      : this.execOps.execSimple(containerId, cmd);
  }

  execStream(...args: Parameters<ExecOps['execStream']>) {
    return this.execOps.execStream(...args);
  }

  execToFile(...args: Parameters<ExecOps['execToFile']>) {
    return this.execOps.execToFile(...args);
  }

  execFromFile(...args: Parameters<ExecOps['execFromFile']>) {
    return this.execOps.execFromFile(...args);
  }

  execTerminal(...args: Parameters<ExecOps['execTerminal']>) {
    return this.execOps.execTerminal(...args);
  }

  getLogs(...args: Parameters<StreamOps['getLogs']>) {
    return this.streamOps.getLogs(...args);
  }

  getLogStream(...args: Parameters<StreamOps['getLogStream']>) {
    return this.streamOps.getLogStream(...args);
  }

  getEventStream(...args: Parameters<StreamOps['getEventStream']>) {
    return this.streamOps.getEventStream(...args);
  }

  ping(...args: Parameters<InfraOps['ping']>) {
    return this.infraOps.ping(...args);
  }

  ensureRunning(...args: Parameters<InfraOps['ensureRunning']>) {
    return this.infraOps.ensureRunning(...args);
  }

  getDiskUsage(...args: Parameters<InfraOps['getDiskUsage']>) {
    return this.infraOps.getDiskUsage(...args);
  }

  async status(): Promise<DockerStatus> {
    return dockerStatus(this.ctx.client);
  }

  cleanupSecretFiles(name: string): void {
    cleanupSecretFiles(name);
  }

  getNetworkName(): string {
    return this.ctx.networkName;
  }

  getInstanceId(): string | undefined {
    return this.ctx.instanceId;
  }
}
