import { createModuleLogger } from '../../lib/logger.js';
import type { Database } from '../../db/index.js';
import { eventBus, type EventBus } from '../../events/index.js';
import { CloudflareTunnel } from '../tunnel.js';

const log = createModuleLogger('deploy:tunnel');

export class TunnelManager {
  private readonly tunnels = new Map<string, CloudflareTunnel>();

  constructor(
    private readonly db: Database,
    private readonly events: EventBus = eventBus,
  ) {}

  async expose(projectId: string, _port: number): Promise<string> {
    const project = this.db.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    const tunnel = new CloudflareTunnel();
    const url = await tunnel.start(project.name);
    this.tunnels.set(projectId, tunnel);

    this.db.updateProject(projectId, {
      visibility: 'quick-share',
      publicUrl: url,
    });

    await this.events.emit('tunnel:url', { projectId, url });
    return url;
  }

  close(projectId: string): void {
    const tunnel = this.tunnels.get(projectId);
    if (!tunnel) {
      return;
    }

    tunnel.stop();
    this.tunnels.delete(projectId);
    this.db.updateProject(projectId, {
      visibility: 'internal',
      publicUrl: null,
    });
  }

  get(projectId: string): CloudflareTunnel | undefined {
    return this.tunnels.get(projectId);
  }

  cleanupStale(): void {
    const projects = this.db.listProjects();
    for (const project of projects) {
      if (project.visibility === 'quick-share' || project.visibility === 'shared') {
        log.info({ projectId: project.id, name: project.name }, 'Clearing stale tunnel state');
        this.db.updateProject(project.id, {
          visibility: 'internal',
          publicUrl: null,
        });
      }
    }
  }
}
