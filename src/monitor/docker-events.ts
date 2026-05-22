/**
 * Docker Event Stream Listener.
 *
 * Subscribes to Docker /events for real-time crash detection (<100ms),
 * replacing the 30s polling gap that missed crashes recovered by restart policies.
 *
 * Key behaviors:
 * - Label-filtered to openlander.managed=true (server-side)
 * - exitCode=0 die events ignored (graceful stops)
 * - 'building' status projects skipped (deploy pipeline handles those)
 * - Per-container debounce (TTL-based, survives start events during crash loops)
 * - OOM→die dedup (OOM fires first, subsequent die suppressed)
 * - NDJSON stream parsing (handles partial/multi-event chunks)
 */

import type { Docker } from '../pipeline/docker.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import { DOCKER_LABELS } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('docker-events');

const DEBOUNCE_MS = 30_000;
const INITIAL_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;
/** OOM event always fires before die — suppress die within this window */
const OOM_DIE_DEDUP_MS = 5_000;
const TTL_PRUNE_INTERVAL_MS = 60_000;
const INITIAL_STAGGER_MS = 10_000;

interface DockerEvent {
  Type: string;
  Action: string;
  Actor: {
    ID: string;
    Attributes: Record<string, string>;
  };
  time: number;
  timeNano: number;
}

export class DockerEventListener {
  private readonly docker: Docker;
  private readonly db: Database;
  private readonly events: EventBus;
  private stream: NodeJS.ReadableStream | null = null;
  private running = false;
  private backoffMs = INITIAL_BACKOFF_MS;
  private readonly recentCrashes = new Map<string, number>();
  private readonly recentOoms = new Map<string, number>();
  private lineBuf = '';
  private lastPruneAt = Date.now();
  private initialTimerId?: ReturnType<typeof setTimeout>;

  constructor(docker: Docker, db: Database, events: EventBus) {
    this.docker = docker;
    this.db = db;
    this.events = events;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Stagger first connection to avoid Docker API thundering herd at startup.
    this.initialTimerId = setTimeout(() => {
      this.initialTimerId = undefined;
      if (this.running) void this.watch();
    }, INITIAL_STAGGER_MS);
    log.info('DockerEventListener started');
  }

  stop(): void {
    this.running = false;
    if (this.initialTimerId) {
      clearTimeout(this.initialTimerId);
      this.initialTimerId = undefined;
    }
    this.destroyStream();
    log.info('DockerEventListener stopped');
  }

  private isStopped(): boolean {
    return !this.running;
  }

  private async watch(): Promise<void> {
    while (this.running) {
      try {
        const stream = await this.docker.getEventStream({
          type: ['container'],
          event: ['die', 'oom', 'start'],
          label: [`${DOCKER_LABELS.MANAGED}=true`],
        });

        this.stream = stream;

        if (this.isStopped()) {
          this.destroyStream();
          break;
        }
        this.lineBuf = '';
        this.backoffMs = INITIAL_BACKOFF_MS;
        log.debug('Docker event stream connected');

        this.stream.on('data', (chunk: Buffer) => {
          this.processChunk(chunk);
        });

        this.stream.on('error', (err: Error) => {
          log.warn({ err }, 'Docker event stream error');
        });

        const currentStream = this.stream;
        await new Promise<void>((resolve) => {
          const done = () => {
            resolve();
          };
          currentStream.on('end', done);
          currentStream.on('close', done);
        });

        if (this.isStopped()) break;
        log.info('Docker event stream ended — reconnecting');
      } catch (err) {
        if (this.isStopped()) break;
        log.warn(
          { err, backoffMs: this.backoffMs },
          'Docker event stream connection failed — retrying',
        );
      }

      const jitter = Math.random() * 1000;
      await new Promise<void>((r) => {
        setTimeout(r, this.backoffMs + jitter);
      });
      this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  private destroyStream(): void {
    if (!this.stream) return;
    const s = this.stream as NodeJS.ReadableStream & { destroy?: () => void };
    s.destroy?.();
    this.stream = null;
  }

  /**
   * Docker /events emits newline-delimited JSON. A single chunk can contain
   * a partial line, a full line, or multiple lines. Buffer and split on '\n'.
   */
  private processChunk(chunk: Buffer): void {
    this.lineBuf += chunk.toString();
    const lines = this.lineBuf.split('\n');
    this.lineBuf = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as DockerEvent;
        void this.handleEvent(event);
      } catch (err) {
        log.debug({ err, line: trimmed.slice(0, 200) }, 'Failed to parse Docker event line');
      }
    }

    this.pruneStaleEntries();
  }

  private pruneStaleEntries(): void {
    const now = Date.now();
    if (now - this.lastPruneAt < TTL_PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;

    for (const [id, ts] of this.recentCrashes) {
      if (now - ts > DEBOUNCE_MS) this.recentCrashes.delete(id);
    }
    for (const [id, ts] of this.recentOoms) {
      if (now - ts > OOM_DIE_DEDUP_MS) this.recentOoms.delete(id);
    }
  }

  private async handleEvent(event: DockerEvent): Promise<void> {
    const containerId = event.Actor.ID;
    const attrs = event.Actor.Attributes;
    const containerName = (attrs['name'] ?? '').replace(/^\//, '');

    switch (event.Action) {
      case 'oom':
        await this.handleOom(containerId, containerName, attrs);
        break;
      case 'die':
        await this.handleDie(containerId, containerName, attrs);
        break;
      case 'start':
        this.handleStart(containerId);
        break;
    }
  }

  private async handleOom(
    containerId: string,
    containerName: string,
    attrs: Record<string, string>,
  ): Promise<void> {
    this.recentOoms.set(containerId, Date.now());

    const projectId = await this.resolveProjectId(attrs);
    if (!projectId) return;

    const project = await this.db.getProject(projectId);
    if (!project) return;
    // PR 4.5: canonical-first status read with `??` fallback.
    const oomDeployable = await this.db.getDeployableForProject(projectId);
    const oomStatus = oomDeployable?.status ?? project.status;
    if (oomStatus !== 'running' || project.archived_at) return;

    await this.events.emit('container:oom', {
      projectId,
      containerId,
      containerName,
    });

    log.info({ projectId, containerId, containerName }, 'Container OOM detected');
  }

  private async handleDie(
    containerId: string,
    containerName: string,
    attrs: Record<string, string>,
  ): Promise<void> {
    const exitCode = parseInt(attrs['exitCode'] ?? '0', 10);

    if (exitCode === 0) return;

    const oomTime = this.recentOoms.get(containerId);
    if (oomTime && Date.now() - oomTime < OOM_DIE_DEDUP_MS) {
      this.recentOoms.delete(containerId);
      return;
    }

    const lastCrash = this.recentCrashes.get(containerId);
    if (lastCrash && Date.now() - lastCrash < DEBOUNCE_MS) return;

    const projectId = await this.resolveProjectId(attrs);
    if (!projectId) return;

    const project = await this.db.getProject(projectId);
    if (!project) return;
    // PR 4.5: canonical-first status read with `??` fallback.
    const dieDeployable = await this.db.getDeployableForProject(projectId);
    const activeContainerId = dieDeployable?.container_id ?? project.container_id;
    if (activeContainerId && activeContainerId !== containerId) {
      log.debug(
        { projectId, containerId, activeContainerId },
        'Ignoring die event for non-active project container',
      );
      return;
    }
    const dieStatus = dieDeployable?.status ?? project.status;
    if (dieStatus !== 'running') return;
    if (project.archived_at) return;

    this.recentCrashes.set(containerId, Date.now());

    await this.events.emit('container:die', {
      projectId,
      containerId,
      containerName,
      exitCode,
    });

    log.info(
      { projectId, containerId, containerName, exitCode },
      'Container crash detected via event stream',
    );
  }

  private handleStart(containerId: string): void {
    this.recentOoms.delete(containerId);
  }

  private async resolveProjectId(attrs: Record<string, string>): Promise<string | null> {
    const projectName = attrs[DOCKER_LABELS.PROJECT];
    if (!projectName) return null;

    if (attrs[DOCKER_LABELS.SERVICE]) return null;

    const project = await this.db.getProjectByName(projectName);
    return project?.id ?? null;
  }
}
