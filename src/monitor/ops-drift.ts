import type { AppContext } from '../app.js';
import type { ServiceRow } from '../db/index.js';
import type { OpsAlerting } from './ops-alerting.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('ops-drift');

export type DriftType = 'container_stopped' | 'image_mismatch';

export interface DriftResult {
  serviceId: string;
  serviceName: string;
  driftType: DriftType;
  description: string;
}

/**
 * Detects infrastructure service drift: containers that have stopped
 * unexpectedly or are running a different image than expected.
 *
 * Only checks managed services (infrastructure), not user-deployed projects.
 */
export class DriftDetector {
  private readonly ctx: AppContext;
  private readonly alerting: OpsAlerting;

  constructor(ctx: AppContext, alerting: OpsAlerting) {
    this.ctx = ctx;
    this.alerting = alerting;
  }

  /**
   * Check all managed services for drift.
   * Returns detected drift results.
   */
  async checkDrift(): Promise<DriftResult[]> {
    const results: DriftResult[] = [];

    try {
      const services = this.ctx.db.listServices();

      for (const service of services) {
        try {
          const drift = await this.checkServiceDrift(service);
          if (drift) {
            results.push(drift);
            await this.handleDrift(drift);
          }
        } catch (err) {
          log.warn({ err, serviceId: service.id }, 'Failed to check drift for service');
        }
      }
    } catch (err) {
      log.error({ err }, 'Drift check failed');
    }

    return results;
  }

  private async checkServiceDrift(service: ServiceRow): Promise<DriftResult | null> {
    const containerRef = service.container_id ?? service.container_name;
    if (!containerRef) return null;

    try {
      const info = await this.ctx.docker.inspectContainer(containerRef);

      if (!info.State.Running) {
        return {
          serviceId: service.id,
          serviceName: service.name,
          driftType: 'container_stopped',
          description: `Service "${service.name}" container is ${info.State.Status} (expected: running)`,
        };
      }

      if (service.image) {
        const currentImage = (info.Config.Image as string | undefined) ?? '';
        if (
          currentImage &&
          service.image !== currentImage &&
          !currentImage.includes(service.image) &&
          !service.image.includes(currentImage)
        ) {
          return {
            serviceId: service.id,
            serviceName: service.name,
            driftType: 'image_mismatch',
            description: `Service "${service.name}" running image "${currentImage}" differs from expected "${service.image}"`,
          };
        }
      }
    } catch (err) {
      // Container not found = likely stopped externally
      log.debug({ err, serviceId: service.id }, 'Container inspect failed — possibly stopped');
      return {
        serviceId: service.id,
        serviceName: service.name,
        driftType: 'container_stopped',
        description: `Service "${service.name}" container not found — may have been stopped externally`,
      };
    }

    return null;
  }

  private async handleDrift(drift: DriftResult): Promise<void> {
    log.warn({ serviceId: drift.serviceId, driftType: drift.driftType }, 'Service drift detected');

    const alert = this.alerting.buildContextualAlert({
      severity: 'warning',
      projectId: drift.serviceId,
      projectName: drift.serviceName,
      eventType: `drift_${drift.driftType}`,
      title: `Service Drift: ${drift.serviceName}`,
      description: drift.description,
      suggestion:
        drift.driftType === 'container_stopped'
          ? `Restart the ${drift.serviceName} service to restore normal operation`
          : `Review the running image for ${drift.serviceName} — it may need updating`,
    });

    await this.alerting.sendAlert(alert);

    if (drift.driftType === 'container_stopped') {
      log.info(
        { serviceId: drift.serviceId },
        'Service drift — alert sent, restart deferred to recovery pipeline',
      );
    }
  }
}
