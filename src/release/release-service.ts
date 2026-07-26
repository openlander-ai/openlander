import { createHash } from 'node:crypto';
import { rm } from 'node:fs/promises';

import type { Database } from '../db/index.js';
import {
  DeliveryAgentRunStateError,
  DeliveryManifestError,
  ReleaseArtifactUnavailableError,
  ReleaseStateError,
} from '../errors.js';
import type { Docker } from '../pipeline/docker.js';
import { cloneRepo } from '../pipeline/git.js';
import { resolveManifestReportPath } from '../delivery/manifest.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('release');

function builtImageDigest(info: { Id: string }): string {
  if (/^sha256:[a-f0-9]{64}$/i.test(info.Id)) return info.Id;
  throw new DeliveryManifestError('Built image did not return an immutable sha256 identifier.', {
    imageId: info.Id,
  });
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export class ReleaseService {
  private readonly activeBuilds = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: Database,
    private readonly docker: Docker,
    private readonly cloneRepository: typeof cloneRepo = cloneRepo,
  ) {}

  async start(input: { id: string; runId: string; version: string; actor: string }): Promise<void> {
    if (this.activeBuilds.has(input.runId)) {
      throw new ReleaseStateError(input.id, 'This Agent Run already has a Release build running.');
    }
    const run = await this.db.requireDeliveryAgentRun(input.runId);
    await this.db.createRelease({
      id: input.id,
      deliveryId: run.delivery_id,
      agentRunId: run.id,
      version: input.version,
      commitSha: run.commit_sha,
      createdBy: input.actor,
    });
    const task = this.create(input)
      .catch(async (error: unknown) => {
        const current = await this.db.requireRelease(input.id);
        if (current.status === 'building') {
          await this.db.setReleaseStatus(current.id, 'failed');
        }
        throw error;
      })
      .finally(() => {
        this.activeBuilds.delete(input.runId);
      });
    this.activeBuilds.set(input.runId, task);
    void task.catch((error: unknown) => {
      log.error({ err: error, releaseId: input.id, runId: input.runId }, 'Release build failed');
    });
  }

  async create(input: { id: string; runId: string; version: string; actor: string }) {
    const run = await this.db.requireDeliveryAgentRun(input.runId);
    const delivery = await this.db.requireDelivery(run.delivery_id);
    if (run.status !== 'running' || run.current_phase !== 'quality_gates_passed') {
      throw new DeliveryAgentRunStateError(
        run.id,
        'Release creation requires a running Agent Run with passed quality gates.',
        run.status,
      );
    }
    const gates = await this.db.listDeliveryGates(delivery.id);
    const manifestGates = gates.filter((gate) => gate.source === 'manifest' && gate.required);
    if (manifestGates.some((gate) => gate.status !== 'passed' && gate.status !== 'waived')) {
      throw new ReleaseStateError(
        input.id,
        'All required manifest Gates must pass before Release creation.',
      );
    }
    const release = await this.db.createRelease({
      id: input.id,
      deliveryId: delivery.id,
      agentRunId: run.id,
      version: input.version,
      commitSha: run.commit_sha,
      createdBy: input.actor,
    });
    if (release.status === 'ready') {
      return { release, artifacts: await this.db.listReleaseArtifacts(release.id) };
    }
    if (release.status === 'recalled') {
      throw new ReleaseStateError(
        release.id,
        'A recalled Release cannot be rebuilt.',
        release.status,
      );
    }

    const deployables = await this.db.getDeployablesByGroup(delivery.project_id);
    const sources = deployables.filter(
      (service) => service.kind === 'git' && service.source === 'git' && Boolean(service.repo_url),
    );
    if (sources.length === 0 || !sources[0]?.repo_url) {
      await this.db.setReleaseStatus(release.id, 'failed');
      throw new ReleaseArtifactUnavailableError(release.id, sources[0]?.id);
    }
    const repositoryUrls = new Set(sources.map((service) => service.repo_url));
    if (repositoryUrls.size !== 1) {
      await this.db.setReleaseStatus(release.id, 'failed');
      throw new ReleaseStateError(
        release.id,
        'One Agent Run can build multiple services only when they share the same repository and commit.',
      );
    }
    const primarySource = sources[0];
    const repoUrl = primarySource.repo_url;
    if (!repoUrl) throw new ReleaseArtifactUnavailableError(release.id, primarySource.id);
    const clone = await this.cloneRepository({
      repoUrl,
      branch: primarySource.branch ?? undefined,
      gitCredentialId: primarySource.git_credential_id ?? undefined,
      serviceId: primarySource.id,
    });
    try {
      if (clone.commitSha.toLowerCase() !== run.commit_sha.toLowerCase()) {
        await this.db.setReleaseStatus(release.id, 'failed');
        throw new ReleaseStateError(
          release.id,
          'Cloned repository commit does not match the successful Agent Run.',
        );
      }
      const safeVersion = input.version.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-');
      const releaseSuffix = release.id
        .toLowerCase()
        .replace(/[^a-z0-9_.-]+/g, '-')
        .slice(-12);
      const artifacts = [];
      for (const source of sources) {
        const contextPath = resolveManifestReportPath(clone.path, source.build_context || '.');
        const dockerfilePath = source.dockerfile_path || 'Dockerfile';
        if (dockerfilePath.startsWith('/') || dockerfilePath.split('/').includes('..')) {
          throw new DeliveryManifestError('Dockerfile path must stay inside the build context.');
        }
        const serviceSuffix = source.id
          .toLowerCase()
          .replace(/[^a-z0-9_.-]+/g, '-')
          .slice(-24);
        const tag = `openlander/release-${releaseSuffix}-${serviceSuffix}:${safeVersion}`;
        await this.docker.buildImage(contextPath, tag, {
          dockerfile: dockerfilePath,
          target: source.docker_target ?? undefined,
          projectId: delivery.project_id,
        });
        const inspected = await this.docker.inspectImage(tag);
        const digest = builtImageDigest(inspected);
        artifacts.push(
          await this.db.addReleaseArtifact({
            releaseId: release.id,
            serviceId: source.id,
            imageReference: digest,
            imageDigest: digest,
            buildProvenance: {
              commit_sha: run.commit_sha,
              manifest_sha256: run.manifest_sha256,
              build_tag: tag,
              dockerfile_path: dockerfilePath,
              build_context: source.build_context || '.',
            },
          }),
        );
      }
      const ready = await this.db.setReleaseStatus(release.id, 'ready');
      await this.db.insertActivityLog({
        event_type: 'release.created',
        activity_type: 'delivery',
        severity: 'info',
        project_id: delivery.project_id,
        correlation_id: delivery.id,
        title: 'Release created',
        description: `${ready.version} built once for ${String(artifacts.length)} service artifact(s).`,
        status: 'completed',
        metadata: JSON.stringify({
          delivery_id: delivery.id,
          run_id: run.id,
          release_id: ready.id,
          image_digests: Object.fromEntries(
            artifacts.map((artifact) => [artifact.service_id, artifact.image_digest]),
          ),
        }),
      });
      return { release: ready, artifacts };
    } catch (error) {
      const current = await this.db.requireRelease(release.id);
      if (current.status === 'building') await this.db.setReleaseStatus(release.id, 'failed');
      throw error;
    } finally {
      await rm(clone.path, { recursive: true, force: true });
    }
  }

  /**
   * Preserve the legacy deploy_app path in the Release ledger without rebuilding.
   * The image that just ran is inspected and recorded by immutable Docker digest;
   * later Promotions therefore reuse the exact artifact instead of the mutable tag.
   */
  async adoptSuccessfulDeploy(input: {
    projectId: string;
    serviceId?: string;
    deployId?: string;
    actor: string;
  }) {
    const project = await this.db.getProject(input.projectId);
    if (!project) throw new ReleaseArtifactUnavailableError(input.projectId, input.serviceId);

    const selectedService = input.serviceId ? await this.db.getService(input.serviceId) : undefined;
    if (selectedService && selectedService.project_id !== project.id) {
      throw new ReleaseStateError(
        input.projectId,
        'The deployed service does not belong to the target Project.',
      );
    }
    const deployables = selectedService
      ? [selectedService]
      : await this.db.getDeployablesByGroup(project.id);
    const artifactServices = (
      await Promise.all(
        deployables.map(async (service) =>
          service.kind === 'compose' ? await this.db.getComposeChildren(service.id) : [service],
        ),
      )
    )
      .flat()
      .filter((service) => Boolean(service.image_tag));
    if (artifactServices.length === 0) {
      throw new ReleaseArtifactUnavailableError(input.projectId, input.serviceId);
    }

    const inspectedArtifacts = await Promise.all(
      artifactServices.map(async (service) => {
        const imageReference = service.image_tag;
        if (!imageReference) {
          throw new ReleaseArtifactUnavailableError(input.projectId, service.id);
        }
        const inspected = await this.docker.inspectImage(imageReference);
        return {
          service,
          deployedImageReference: imageReference,
          imageDigest: builtImageDigest(inspected),
        };
      }),
    );
    const deployLogs = (
      await Promise.all(
        artifactServices.map(async (service) =>
          input.deployId
            ? await this.db.getDeployLog(input.deployId)
            : await this.db.getLastDeployLogForService(service.id),
        ),
      )
    ).filter((deployLog): deployLog is NonNullable<typeof deployLog> => Boolean(deployLog));
    const successfulDeploys = deployLogs.filter((deployLog) => deployLog.status === 'success');
    const primaryDeploy = successfulDeploys[0];
    if (!primaryDeploy) {
      throw new ReleaseStateError(
        input.deployId ?? input.projectId,
        'Only a successful deployment can be adopted as an implicit Release.',
      );
    }

    const identity = sha256(
      [
        project.id,
        ...successfulDeploys.map((deployLog) => deployLog.id).sort(),
        ...inspectedArtifacts.map((artifact) => artifact.imageDigest).sort(),
      ].join(':'),
    );
    const commitSha =
      primaryDeploy.commit_sha && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(primaryDeploy.commit_sha)
        ? primaryDeploy.commit_sha
        : sha256(`implicit-deploy:${primaryDeploy.id}:${identity}`);
    const manifestSnapshot = JSON.stringify({
      source: 'deploy_app_compatibility',
      project_id: project.id,
      deploy_ids: successfulDeploys.map((deployLog) => deployLog.id).sort(),
      image_digests: Object.fromEntries(
        inspectedArtifacts.map((artifact) => [artifact.service.id, artifact.imageDigest]),
      ),
    });
    const manifestSha256 = sha256(manifestSnapshot);
    const suffix = identity.slice(0, 26);
    const deliveryId = `delivery_implicit_${suffix}`;
    const runId = `run_implicit_${suffix}`;
    const releaseId = `rel_implicit_${suffix}`;
    const delivery = await this.db.createDelivery({
      id: deliveryId,
      projectId: project.id,
      title: `Deployment ${primaryDeploy.id}`,
      summary: 'Compatibility record created automatically from deploy_app.',
      objective: 'Preserve the deployed artifact as an immutable Release without rebuilding it.',
      definitionOfDone: ['Deployment succeeded', 'Immutable image digest recorded'],
      manifestPath: '.openlander/delivery.yml',
      autoFinalize: false,
      deliveryType: 'software_release',
      maturity: 'production',
      createdBy: input.actor,
      gates: [],
    });
    const run = await this.db.startDeliveryAgentRun({
      id: runId,
      deliveryId: delivery.id,
      commitSha,
      manifestPath: '.openlander/delivery.yml',
      manifestSha256,
      runnerImage: 'openlander/deploy-app-compatibility',
      phase: 'release_created',
      actor: input.actor,
    });
    const release = await this.db.createRelease({
      id: releaseId,
      deliveryId: delivery.id,
      agentRunId: run.id,
      version: `deploy-${primaryDeploy.id.slice(-16)}`,
      commitSha,
      createdBy: input.actor,
    });
    const artifacts = [];
    for (const artifact of inspectedArtifacts) {
      artifacts.push(
        await this.db.addReleaseArtifact({
          releaseId: release.id,
          serviceId: artifact.service.id,
          imageReference: artifact.imageDigest,
          imageDigest: artifact.imageDigest,
          buildProvenance: {
            source: 'deploy_app_compatibility',
            commit_sha: commitSha,
            commit_source: primaryDeploy.commit_sha ? 'deploy_log' : 'synthetic_deploy_identity',
            manifest_sha256: manifestSha256,
            deploy_id: primaryDeploy.id,
            deployed_image_reference: artifact.deployedImageReference,
            rebuilt: false,
          },
        }),
      );
    }
    const ready =
      release.status === 'ready' ? release : await this.db.setReleaseStatus(release.id, 'ready');
    for (const deployLog of successfulDeploys) {
      await this.db.linkDeliveryDeploy({
        deliveryId: delivery.id,
        deployId: deployLog.id,
        relation: 'released',
      });
    }
    if (run.status === 'running') {
      await this.db.completeDeliveryAgentRun({
        runId: run.id,
        summary: 'Legacy deploy_app deployment adopted into the immutable Release ledger.',
        actor: input.actor,
      });
    }
    await this.db.insertActivityLog({
      event_type: 'release.adopted',
      activity_type: 'delivery',
      severity: 'info',
      project_id: project.id,
      correlation_id: delivery.id,
      title: 'Deployment adopted as Release',
      description: `${ready.version} recorded ${String(artifacts.length)} immutable artifact(s) without rebuilding.`,
      status: 'completed',
      metadata: JSON.stringify({
        delivery_id: delivery.id,
        run_id: run.id,
        release_id: ready.id,
        deploy_ids: successfulDeploys.map((deployLog) => deployLog.id),
        image_digests: Object.fromEntries(
          artifacts.map((artifact) => [artifact.service_id, artifact.image_digest]),
        ),
      }),
    });
    return { delivery, run, release: ready, artifacts, deploys: successfulDeploys };
  }

  async get(releaseId: string) {
    const release = await this.db.requireRelease(releaseId);
    const [artifacts, promotions] = await Promise.all([
      this.db.listReleaseArtifacts(releaseId),
      this.db.listReleasePromotions(releaseId),
    ]);
    return { release, artifacts, promotions };
  }

  async recall(releaseId: string, actor: string) {
    const release = await this.db.requireRelease(releaseId);
    if (release.status !== 'ready') {
      throw new ReleaseStateError(
        release.id,
        'Only a ready Release can be recalled.',
        release.status,
      );
    }
    const recalled = await this.db.setReleaseStatus(release.id, 'recalled');
    const delivery = await this.db.requireDelivery(release.delivery_id);
    await this.db.insertActivityLog({
      event_type: 'release.recalled',
      activity_type: 'delivery',
      severity: 'warning',
      project_id: delivery.project_id,
      correlation_id: delivery.id,
      title: 'Release recalled',
      description: `${release.version} cannot be promoted further.`,
      status: 'completed',
      metadata: JSON.stringify({ release_id: release.id, actor }),
    });
    return recalled;
  }
}
