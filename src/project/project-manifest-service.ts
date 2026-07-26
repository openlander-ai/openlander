import type { Database } from '../db/index.js';
import { DeliveryManifestError } from '../errors.js';
import type { DeliveryService } from '../delivery/delivery-service.js';

export class ProjectManifestService {
  constructor(
    private readonly db: Database,
    private readonly deliveryService: DeliveryService,
  ) {}

  async apply(input: {
    projectId: string;
    manifestPath: string;
    manifestSha256: string;
    environments: Array<{
      key: string;
      displayName: string;
      tier: 'development' | 'validation' | 'production';
      promotionOrder: number;
      healthTimeoutSeconds?: number;
      smokePath?: string | null;
      soakSeconds?: number;
    }>;
    actor: string;
  }) {
    await this.deliveryService.assertProjectCanMutate(input.projectId);
    const keys = input.environments.map((environment) => environment.key);
    const orders = input.environments.map((environment) => environment.promotionOrder);
    if (new Set(keys).size !== keys.length || new Set(orders).size !== orders.length) {
      throw new DeliveryManifestError(
        'Project Environment keys and promotion order must be unique.',
      );
    }
    if (
      input.environments.filter((environment) => environment.tier === 'production').length !== 1
    ) {
      throw new DeliveryManifestError(
        'Project manifest must define exactly one Production Environment.',
      );
    }
    const environments = await this.db.syncProjectEnvironments(
      input.projectId,
      input.manifestSha256,
      input.environments,
    );
    await this.db.insertActivityLog({
      event_type: 'project.manifest_applied',
      activity_type: 'delivery',
      severity: 'info',
      project_id: input.projectId,
      correlation_id: input.projectId,
      title: 'Project manifest applied',
      description: `${String(input.environments.length)} Environment definitions applied.`,
      status: 'completed',
      metadata: JSON.stringify({
        manifest_path: input.manifestPath,
        manifest_sha256: input.manifestSha256,
        actor: input.actor,
      }),
    });
    return environments;
  }
}
