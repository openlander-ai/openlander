import { randomUUID } from 'node:crypto';

import type { OpenLanderConfig } from '../config/index.js';
import type {
  Database,
  DeliveryRow,
  ProjectEnvironmentRow,
  ReleasePromotionRow,
  ReleaseRow,
} from '../db/index.js';
import {
  ProjectEnvironmentNotFoundError,
  ReleaseArtifactDigestMismatchError,
  ReleaseArtifactUnavailableError,
  ReleasePromotionOrderError,
  ReleaseStateError,
} from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';
import type { Docker } from '../pipeline/docker.js';
import { containerName } from '../pipeline/helpers.js';
import { allocatePort, releasePortReservation } from '../pipeline/port.js';
import { resolveContainerUrl } from '../pipeline/url-resolver.js';
import {
  appRouteProviderForTraefikMode,
  buildTraefikLabels,
  getDeployableServiceRouteName,
} from '../pipeline/traefik.js';

const log = createModuleLogger('release-promotion');

function imageCommand(value: string | null): string[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed) && parsed.every((entry) => typeof entry === 'string')) return parsed;
  } catch (error) {
    log.warn({ err: error }, 'Stored image command is not valid JSON argv');
  }
  return undefined;
}

export interface PromotionSmokeResult {
  passed: boolean;
  statusCode?: number;
  error?: string;
}

export type PromotionSmokeProbe = (
  port: number,
  path: string,
  timeoutMs: number,
) => Promise<PromotionSmokeResult>;

interface PreparedPromotion {
  release: ReleaseRow;
  delivery: DeliveryRow;
  projectEnvironment: ProjectEnvironmentRow;
  promotion: ReleasePromotionRow;
}

async function defaultSmokeProbe(
  port: number,
  path: string,
  timeoutMs: number,
): Promise<PromotionSmokeResult> {
  const target = `${resolveContainerUrl(port)}${path}`;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastResult: PromotionSmokeResult = { passed: false, error: 'Smoke Test did not run.' };

  while (Date.now() < deadline) {
    attempt += 1;
    const remainingMs = Math.max(1, deadline - Date.now());
    try {
      const response = await fetch(target, {
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.min(remainingMs, 3_000)),
      });
      lastResult = {
        passed: response.status >= 200 && response.status < 400,
        statusCode: response.status,
      };
      if (lastResult.passed) return lastResult;
      const retryableStatus = response.status >= 500 || [408, 425, 429].includes(response.status);
      if (!retryableStatus) return lastResult;
    } catch (error) {
      const cause = error instanceof Error ? error.cause : undefined;
      const causeMessage =
        cause && typeof cause === 'object'
          ? 'message' in cause && typeof cause.message === 'string'
            ? cause.message
            : 'code' in cause && typeof cause.code === 'string'
              ? cause.code
              : undefined
          : undefined;
      const message = error instanceof Error ? error.message : String(error);
      lastResult = {
        passed: false,
        error: causeMessage ? `${message}: ${causeMessage}` : message,
      };
    }

    const retryDelayMs = Math.min(250 * 2 ** Math.min(attempt - 1, 3), 2_000);
    const delayMs = Math.min(retryDelayMs, Math.max(0, deadline - Date.now()));
    if (delayMs <= 0) break;
    await wait(delayMs);
  }

  return lastResult;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class ReleasePromotionService {
  private readonly activePromotions = new Map<string, Promise<Record<string, unknown>>>();

  constructor(
    private readonly db: Database,
    private readonly docker: Docker,
    private readonly config: OpenLanderConfig,
    private readonly allocateRuntimePort: typeof allocatePort = allocatePort,
    private readonly releaseRuntimePort: typeof releasePortReservation = releasePortReservation,
    private readonly smokeProbe: PromotionSmokeProbe = defaultSmokeProbe,
    private readonly waitForSoak: (milliseconds: number) => Promise<void> = wait,
  ) {}

  async start(input: {
    id: string;
    releaseId: string;
    projectEnvironmentId: string;
    idempotencyKey: string;
    actor: string;
  }): Promise<void> {
    if (this.activePromotions.has(input.projectEnvironmentId)) {
      throw new ReleaseStateError(
        input.releaseId,
        'This Environment already has a Promotion running.',
      );
    }
    const prepared = this.prepare(input);
    const task = prepared
      .then(async (promotion) => await this.executePrepared(promotion))
      .finally(() => {
        this.activePromotions.delete(input.projectEnvironmentId);
      });
    this.activePromotions.set(input.projectEnvironmentId, task);
    void task.catch((error: unknown) => {
      log.error(
        { err: error, releaseId: input.releaseId, environmentId: input.projectEnvironmentId },
        'Release Promotion failed',
      );
    });
    await prepared;
  }

  async execute(input: {
    id: string;
    releaseId: string;
    projectEnvironmentId: string;
    idempotencyKey: string;
    actor: string;
    bypassOrder?: boolean;
  }): Promise<Record<string, unknown>> {
    return await this.executePrepared(await this.prepare(input));
  }

  private async prepare(input: {
    id: string;
    releaseId: string;
    projectEnvironmentId: string;
    idempotencyKey: string;
    actor: string;
    bypassOrder?: boolean;
  }): Promise<PreparedPromotion> {
    const release = await this.db.requireRelease(input.releaseId);
    if (release.status !== 'ready') {
      throw new ReleaseStateError(
        release.id,
        'Only a ready Release can be promoted.',
        release.status,
      );
    }
    const delivery = await this.db.requireDelivery(release.delivery_id);
    const projectEnvironment = await this.db.getProjectEnvironment(input.projectEnvironmentId);
    if (!projectEnvironment || projectEnvironment.project_id !== delivery.project_id) {
      throw new ProjectEnvironmentNotFoundError(input.projectEnvironmentId);
    }
    const orderedEnvironments = await this.db.listProjectEnvironments(delivery.project_id);
    const prior = [...orderedEnvironments]
      .filter((environment) => environment.promotion_order < projectEnvironment.promotion_order)
      .sort((left, right) => right.promotion_order - left.promotion_order)[0];
    if (prior && !input.bypassOrder) {
      const promotions = await this.db.listReleasePromotions(release.id);
      if (
        !promotions.some(
          (promotion) =>
            promotion.project_environment_id === prior.id && promotion.status === 'succeeded',
        )
      ) {
        throw new ReleasePromotionOrderError(release.id, projectEnvironment.id, prior.id);
      }
    }

    const currentPromotion = await this.db.getLatestSuccessfulPromotion(projectEnvironment.id);
    const promotion = await this.db.createReleasePromotion({
      id: input.id,
      releaseId: release.id,
      projectEnvironmentId: projectEnvironment.id,
      previousReleaseId: currentPromotion?.release_id ?? null,
      idempotencyKey: input.idempotencyKey,
      initiatedBy: input.actor,
    });
    return { release, delivery, projectEnvironment, promotion };
  }

  private async executePrepared(prepared: PreparedPromotion): Promise<Record<string, unknown>> {
    const { release, delivery, projectEnvironment, promotion } = prepared;
    const healthTimeoutSeconds = projectEnvironment.health_timeout_seconds;
    const smokePath = projectEnvironment.smoke_path ?? null;
    const soakSeconds = projectEnvironment.soak_seconds;
    if (promotion.status === 'succeeded') return promotion;
    await this.db.updateReleasePromotion(promotion.id, {
      status: 'deploying',
      startedAt: new Date().toISOString(),
      errorCode: null,
      errorMessage: null,
    });
    let promotionCommitted = false;

    try {
      const artifacts = await this.db.listReleaseArtifacts(release.id);
      if (artifacts.length === 0) {
        throw new ReleaseArtifactUnavailableError(release.id);
      }
      const project = await this.db.getProject(delivery.project_id);
      if (!project) throw new ReleaseArtifactUnavailableError(release.id);
      const services = await this.db.getServices({
        ids: artifacts.map((artifact) => artifact.service_id),
        project_id: project.id,
      });
      const servicesById = new Map(services.map((service) => [service.id, service]));
      for (const artifact of artifacts) {
        const service = servicesById.get(artifact.service_id);
        if (!service?.container_port) {
          throw new ReleaseArtifactUnavailableError(release.id, artifact.service_id);
        }
        let inspected: Awaited<ReturnType<Docker['inspectImage']>>;
        try {
          inspected = await this.docker.inspectImage(artifact.image_reference);
        } catch {
          throw new ReleaseArtifactUnavailableError(release.id, artifact.service_id);
        }
        if (inspected.Id !== artifact.image_digest) {
          throw new ReleaseArtifactDigestMismatchError(
            release.id,
            artifact.image_digest,
            inspected.Id,
          );
        }
      }
      const projectNetwork = await this.docker.ensureProjectNetwork(project.name);
      const candidates: Array<{
        artifact: (typeof artifacts)[number];
        service: (typeof services)[number];
        runtimeEnvironment: Awaited<ReturnType<Database['createProjectEnvironmentRuntime']>>;
        port: number;
        containerPort: number;
        containerId: string;
        deployId: string;
      }> = [];
      const reservedCandidatePorts: number[] = [];
      try {
        for (const artifact of artifacts) {
          const service = servicesById.get(artifact.service_id);
          if (!service?.container_port) {
            throw new ReleaseArtifactUnavailableError(release.id, artifact.service_id);
          }
          const runtimeEnvironment = await this.db.createProjectEnvironmentRuntime({
            id: `env_${projectEnvironment.id}_${service.id}`,
            serviceId: service.id,
            projectEnvironmentId: projectEnvironment.id,
            type: projectEnvironment.tier === 'production' ? 'production' : 'development',
            branch: null,
          });
          const port = await this.allocateRuntimePort(this.db, this.docker);
          reservedCandidatePorts.push(port);
          const serviceRoute = getDeployableServiceRouteName(service);
          const routeName =
            projectEnvironment.tier === 'production'
              ? serviceRoute
              : `${serviceRoute}-${projectEnvironment.key}`;
          const candidateName = containerName(
            `${routeName}-${service.id.slice(-8)}-${promotion.id.slice(-8)}`,
          );
          const envVars = await this.db.getEnvVarsForService(
            project.id,
            service.id,
            runtimeEnvironment.id,
          );
          const containerId = await this.docker.runContainer({
            imageTag: artifact.image_reference,
            name: candidateName,
            port,
            containerPort: service.container_port,
            envVars,
            cmd: imageCommand(service.image_cmd),
            traefikLabels: buildTraefikLabels(
              routeName,
              service.container_port,
              undefined,
              projectEnvironment.tier === 'production' ? 'production' : 'development',
              projectNetwork,
              appRouteProviderForTraefikMode(this.config.traefik.mode),
            ),
            network: projectNetwork,
            aliases: [routeName],
            volumeProjectName: project.name,
          });
          const healthTimeoutMs = healthTimeoutSeconds * 1_000;
          const health = await this.docker.waitForHealthy(containerId, healthTimeoutMs);
          if (!health.healthy) {
            await this.docker.safeRemoveContainer(containerId);
            throw new ReleaseStateError(
              release.id,
              health.error ?? 'Promoted container did not become healthy.',
            );
          }
          if (smokePath) {
            const smoke = await this.smokeProbe(port, smokePath, healthTimeoutMs);
            if (!smoke.passed) {
              await this.docker.safeRemoveContainer(containerId);
              throw new ReleaseStateError(
                release.id,
                smoke.error ?? `Smoke Test returned HTTP ${String(smoke.statusCode ?? 'unknown')}.`,
              );
            }
          }
          candidates.push({
            artifact,
            service,
            runtimeEnvironment,
            port,
            containerPort: service.container_port,
            containerId,
            deployId: `deploy_${promotion.id}_${service.id}`,
          });
        }

        if (soakSeconds > 0) {
          await this.waitForSoak(soakSeconds * 1_000);
          for (const candidate of candidates) {
            const health = await this.docker.waitForHealthy(
              candidate.containerId,
              healthTimeoutSeconds * 1_000,
            );
            if (!health.healthy) {
              throw new ReleaseStateError(
                release.id,
                health.error ?? 'Promoted container failed during the soak window.',
              );
            }
            if (smokePath) {
              const smoke = await this.smokeProbe(
                candidate.port,
                smokePath,
                healthTimeoutSeconds * 1_000,
              );
              if (!smoke.passed) {
                throw new ReleaseStateError(
                  release.id,
                  smoke.error ??
                    `Post-soak Smoke Test returned HTTP ${String(smoke.statusCode ?? 'unknown')}.`,
                );
              }
            }
          }
        }

        const succeeded = await this.db.finalizeReleasePromotion({
          promotionId: promotion.id,
          projectId: project.id,
          deliveryId: delivery.id,
          releaseId: release.id,
          releaseVersion: release.version,
          projectEnvironmentId: projectEnvironment.id,
          projectEnvironmentName: projectEnvironment.display_name,
          relation: projectEnvironment.tier === 'production' ? 'released' : 'candidate',
          commitSha: release.commit_sha,
          soakStatus: soakSeconds > 0 ? 'passed' : 'skipped',
          imageDigests: Object.fromEntries(
            candidates.map((candidate) => [candidate.service.id, candidate.artifact.image_digest]),
          ),
          candidates: candidates.map((candidate) => ({
            environmentId: candidate.runtimeEnvironment.id,
            serviceId: candidate.service.id,
            deployId: candidate.deployId,
            assignedPort: candidate.port,
            containerId: candidate.containerId,
            imageReference: candidate.artifact.image_reference,
            imageDigest: candidate.artifact.image_digest,
            previousImageTag: candidate.runtimeEnvironment.image_tag,
            containerPort: candidate.containerPort,
          })),
        });
        promotionCommitted = true;
        for (const candidate of candidates) {
          if (candidate.runtimeEnvironment.container_id) {
            await this.docker.safeRemoveContainer(candidate.runtimeEnvironment.container_id);
          }
        }
        return succeeded;
      } catch (error) {
        if (!promotionCommitted) {
          await Promise.all(
            candidates.map((candidate) => this.docker.safeRemoveContainer(candidate.containerId)),
          );
        }
        throw error;
      } finally {
        for (const port of reservedCandidatePorts) this.releaseRuntimePort(port);
      }
    } catch (error) {
      const currentPromotionState = await this.db.getReleasePromotion(promotion.id);
      if (currentPromotionState?.status === 'succeeded') throw error;
      const code =
        error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
          ? error.code
          : 'PROMOTION_FAILED';
      await this.db.updateReleasePromotion(promotion.id, {
        status: 'failed',
        healthStatus: 'unhealthy',
        soakStatus: 'failed',
        errorCode: code,
        errorMessage: error instanceof Error ? error.message : String(error),
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  }

  async evaluate(promotionId: string) {
    const promotion = await this.db.getReleasePromotion(promotionId);
    if (!promotion) throw new ReleaseStateError(promotionId, 'Promotion was not found.');
    return promotion;
  }

  async rollback(input: {
    projectEnvironmentId: string;
    actor: string;
  }): Promise<Record<string, unknown>> {
    const current = await this.db.getLatestSuccessfulPromotion(input.projectEnvironmentId);
    if (!current?.previous_release_id) {
      throw new ReleaseStateError('rollback', 'No previous successful Release is available.');
    }
    const rollback = await this.execute({
      id: `prom_${randomUUID()}`,
      releaseId: current.previous_release_id,
      projectEnvironmentId: input.projectEnvironmentId,
      idempotencyKey: `rollback:${current.id}`,
      actor: input.actor,
      bypassOrder: true,
    });
    await this.db.updateReleasePromotion(current.id, {
      status: 'rolled_back',
      completedAt: new Date().toISOString(),
    });
    return rollback;
  }
}
