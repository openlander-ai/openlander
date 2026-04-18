import { createModuleLogger } from '../lib/logger.js';
const log = createModuleLogger('preview');

import { nanoid } from 'nanoid';

import type { Docker } from './docker.js';
import type { Database } from '../db/index.js';
import { eventBus } from '../events/index.js';
import { allocatePort } from './port.js';
import { buildTraefikLabels, getProjectUrl } from './traefik.js';
import { cloneRepo } from './git.js';
import { ensureDockerfile } from './dockerfile-gen.js';
import { getPolicy } from '../config/index.js';
import { buildResourceLimitConfig } from './docker/types.js';

const DEFAULT_PREVIEW_TTL_MS = 86_400_000;

/**
 * Deployment options for creating a preview environment.
 */
export interface PreviewOptions {
  repoUrl: string;
  branch: string;
  /** Link to parent project if it exists. */
  projectId?: string;
  sshKeyPath?: string;
  /** Auto-cleanup time-to-live in milliseconds (default: 24h). */
  ttlMs?: number;
}

/**
 * Result payload returned after attempting a preview deployment.
 */
export interface PreviewResult {
  success: boolean;
  previewId: string;
  url?: string;
  port?: number;
  containerId?: string;
  error?: string;
  buildLog?: string;
}

/**
 * Runtime information for an active preview deployment.
 */
export interface PreviewDeploy {
  previewId: string;
  projectId: string;
  branch: string;
  containerId: string;
  port: number;
  url: string;
  imageTag: string;
  createdAt: Date;
  /** Auto-cleanup after this duration (ms). Default: 24 hours */
  ttlMs: number;
}

/**
 * Handles ephemeral branch/PR preview deployments.
 */
export class PreviewDeployer {
  private readonly previews = new Map<string, PreviewDeploy>();
  private readonly previewIds = new Map<string, string>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
  ) {}

  /**
   * Deploy an ephemeral preview container for a branch.
   */
  async deploy(options: PreviewOptions): Promise<PreviewResult> {
    const startTime = Date.now();
    const safeBranch = sanitizeBranch(options.branch);
    const previewId = `preview-${options.branch}-${nanoid(6)}`;
    const projectId = options.projectId ?? `preview-project-${nanoid(10)}`;
    const previewName = `preview-${options.branch}`;
    const mapKey = this.getMapKey(projectId, options.branch);

    const existingPreviewId = this.previewIds.get(mapKey);
    if (existingPreviewId) {
      await this.cleanup(existingPreviewId);
    }

    let buildOutput = '';

    try {
      const cloneResult = await cloneRepo({
        repoUrl: options.repoUrl,
        branch: options.branch,
        sshKeyPath: options.sshKeyPath,
      });

      ensureDockerfile(cloneResult.path);

      const imageTag = `openlander/preview-${options.branch}:latest`;
      await this.docker.buildImage(cloneResult.path, imageTag, {
        onProgress: (event) => {
          const line = event.stream?.trimEnd() ?? event.error ?? '';
          if (line) buildOutput += line + '\n';
        },
      });
      if (buildOutput) {
        log.debug({ branch: options.branch }, 'Preview build output:\n%s', buildOutput);
      }

      const port = await this.allocatePreviewPort();
      const containerPort = (await this.docker.getImageExposedPort(imageTag)) ?? port;
      const traefikLabels = buildTraefikLabels(previewName, containerPort);
      const previewLimits = buildResourceLimitConfig('small', null);

      const containerId = await this.docker.runContainer({
        imageTag,
        name: `ol-preview-${safeBranch}`,
        port,
        containerPort,
        envVars: {},
        traefikLabels,
        network: getPolicy('production').networkName,
        resourceLimits: previewLimits ?? undefined,
      });

      const url = getProjectUrl(previewName);
      const ttlMs = options.ttlMs ?? DEFAULT_PREVIEW_TTL_MS;

      const preview: PreviewDeploy = {
        previewId,
        projectId,
        branch: options.branch,
        containerId,
        port,
        url,
        imageTag,
        createdAt: new Date(),
        ttlMs,
      };

      this.previews.set(mapKey, preview);
      this.previewIds.set(mapKey, previewId);
      this.scheduleCleanup(previewId, ttlMs);

      await eventBus.emit('deploy:success', {
        projectId,
        url,
        totalDurationMs: Date.now() - startTime,
      });

      return {
        success: true,
        previewId,
        url,
        port,
        containerId,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      const buildLogWithOutput = buildOutput
        ? `${buildOutput}[error] ${errorMessage}\n`
        : undefined;

      return {
        success: false,
        previewId,
        error: errorMessage,
        buildLog: buildLogWithOutput,
      };
    }
  }

  /**
   * Stop and remove a specific preview deployment.
   */
  async cleanup(previewId: string): Promise<void> {
    const key = this.findKeyByPreviewId(previewId);
    if (!key) {
      return;
    }

    const preview = this.previews.get(key);
    if (!preview) {
      this.clearTimer(previewId);
      this.previewIds.delete(key);
      return;
    }

    this.clearTimer(previewId);

    try {
      await this.docker.stopContainer(preview.containerId);
    } catch (err) {
      log.debug({ err }, 'Best-effort stop during preview cleanup');
    }

    try {
      await this.docker.safeRemoveContainer(preview.containerId);
    } finally {
      this.previews.delete(key);
      this.previewIds.delete(key);
    }
  }

  /**
   * Stop and remove all active previews.
   */
  async cleanupAll(): Promise<void> {
    const ids = Array.from(this.previewIds.values());
    await Promise.all(ids.map(async (previewId) => this.cleanup(previewId)));
  }

  /**
   * List all active previews.
   */
  list(): PreviewDeploy[] {
    return Array.from(this.previews.values());
  }

  /**
   * Get a specific preview by preview ID.
   */
  getPreview(previewId: string): PreviewDeploy | undefined {
    const key = this.findKeyByPreviewId(previewId);
    if (!key) {
      return undefined;
    }

    return this.previews.get(key);
  }

  private scheduleCleanup(previewId: string, ttlMs: number): void {
    const timer = setTimeout(() => {
      void this.cleanup(previewId);
    }, ttlMs);

    this.cleanupTimers.set(previewId, timer);
  }

  private clearTimer(previewId: string): void {
    const timer = this.cleanupTimers.get(previewId);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(previewId);
    }
  }

  private getMapKey(projectId: string, branch: string): string {
    return `${projectId}-${branch}`;
  }

  private findKeyByPreviewId(previewId: string): string | undefined {
    for (const [key, value] of this.previewIds.entries()) {
      if (value === previewId) {
        return key;
      }
    }

    return undefined;
  }

  private async allocatePreviewPort(): Promise<number> {
    // Given no explicit env context, use production port policy for previews.
    let port = await allocatePort(this.db, this.docker, {}, 'production');
    const dbPorts = new Set(this.db.getUsedPorts());
    const previewPorts = new Set(this.list().map((preview) => preview.port));
    const { portRangeStart, portRangeEnd } = getPolicy('production');

    while (dbPorts.has(port) || previewPorts.has(port)) {
      port += 1;
      if (port > portRangeEnd) {
        throw new Error(
          `No available preview ports in range ${String(portRangeStart)}-${String(portRangeEnd)}`,
        );
      }
    }

    return port;
  }
}

function sanitizeBranch(branch: string): string {
  const normalized = branch.trim().toLowerCase();
  const replaced = normalized.replace(/[^a-z0-9._-]+/g, '-').replace(/-+/g, '-');
  const trimmed = replaced.replace(/^-+|-+$/g, '');
  return trimmed || 'preview';
}
