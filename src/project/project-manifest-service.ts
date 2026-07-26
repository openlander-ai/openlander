import type { Database, ProjectEnvironmentRow } from '../db/index.js';
import { DeliveryManifestError } from '../errors.js';
import type { DeliveryService } from '../delivery/delivery-service.js';

export interface ProjectManifestEnvironmentInput {
  key: string;
  displayName: string;
  tier: 'development' | 'validation' | 'production';
  promotionOrder: number;
  healthTimeoutSeconds?: number;
  smokePath?: string | null;
  soakSeconds?: number;
}

export interface ProjectManifestServiceInput {
  serviceId: string;
  key: string;
  runtimeRole: 'application' | 'job' | 'resource';
}

export interface ProjectManifestWeeklyReportInput {
  dayOfWeek: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday';
  time: string;
  timezone: string;
  audiences: Array<'internal' | 'customer'>;
}

export interface ProjectManifestDriftItem {
  scope: 'environment' | 'service';
  kind: 'missing' | 'retained' | 'changed';
  key: string;
  fields: string[];
}

interface StoredProjectManifestDefinition extends Record<string, unknown> {
  services: Array<{
    service_id: string;
    key: string;
    runtime_role: 'application' | 'job' | 'resource';
  }> | null;
  environments: Array<{
    key: string;
    display_name: string;
    tier: 'development' | 'validation' | 'production';
    promotion_order: number;
    health_timeout_seconds: number;
    smoke_path: string | null;
    soak_seconds: number;
  }>;
  weekly_report: {
    day_of_week: ProjectManifestWeeklyReportInput['dayOfWeek'];
    time: string;
    timezone: string;
    audiences: ProjectManifestWeeklyReportInput['audiences'];
  } | null;
}

function environmentDefinition(input: ProjectManifestEnvironmentInput) {
  return {
    key: input.key,
    display_name: input.displayName,
    tier: input.tier,
    promotion_order: input.promotionOrder,
    health_timeout_seconds: input.healthTimeoutSeconds ?? 30,
    smoke_path: input.smokePath ?? null,
    soak_seconds: input.soakSeconds ?? 0,
  };
}

function changedEnvironmentFields(
  desired: StoredProjectManifestDefinition['environments'][number],
  actual: ProjectEnvironmentRow,
): string[] {
  const fields: string[] = [];
  if (desired.display_name !== actual.display_name) fields.push('display_name');
  if (desired.tier !== actual.tier) fields.push('tier');
  if (desired.promotion_order !== actual.promotion_order) fields.push('promotion_order');
  if (desired.health_timeout_seconds !== actual.health_timeout_seconds) {
    fields.push('health_timeout_seconds');
  }
  if (desired.smoke_path !== actual.smoke_path) fields.push('smoke_path');
  if (desired.soak_seconds !== actual.soak_seconds) fields.push('soak_seconds');
  return fields;
}

function readDefinition(value: Record<string, unknown>): StoredProjectManifestDefinition {
  return value as unknown as StoredProjectManifestDefinition;
}

export class ProjectManifestService {
  constructor(
    private readonly db: Database,
    private readonly deliveryService: DeliveryService,
  ) {}

  async apply(input: {
    projectId: string;
    manifestPath: string;
    manifestSha256: string;
    services?: ProjectManifestServiceInput[];
    environments: ProjectManifestEnvironmentInput[];
    weeklyReport?: ProjectManifestWeeklyReportInput | null;
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

    const configuredServices = input.services ?? null;
    if (configuredServices) {
      const serviceIds = configuredServices.map((service) => service.serviceId);
      const serviceKeys = configuredServices.map((service) => service.key);
      if (
        new Set(serviceIds).size !== serviceIds.length ||
        new Set(serviceKeys).size !== serviceKeys.length
      ) {
        throw new DeliveryManifestError('Project manifest Service IDs and keys must be unique.');
      }
      const actualServices = await this.db.getDeployablesByGroup(input.projectId);
      const actualServiceIds = new Set(actualServices.map((service) => service.id));
      const foreignIds = serviceIds.filter((serviceId) => !actualServiceIds.has(serviceId));
      if (foreignIds.length > 0) {
        throw new DeliveryManifestError(
          'Every Project manifest Service must already belong to the target Project.',
          { serviceIds: foreignIds },
        );
      }
    }

    const definition: StoredProjectManifestDefinition = {
      services:
        configuredServices?.map((service) => ({
          service_id: service.serviceId,
          key: service.key,
          runtime_role: service.runtimeRole,
        })) ?? null,
      environments: input.environments.map(environmentDefinition),
      weekly_report: input.weeklyReport
        ? {
            day_of_week: input.weeklyReport.dayOfWeek,
            time: input.weeklyReport.time,
            timezone: input.weeklyReport.timezone,
            audiences: input.weeklyReport.audiences,
          }
        : null,
    };
    const environments = await this.db.syncProjectEnvironments(
      input.projectId,
      input.manifestSha256,
      input.environments,
      {
        manifestPath: input.manifestPath,
        definition,
        appliedBy: input.actor,
      },
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
        configured_service_count: configuredServices?.length ?? null,
        weekly_report_configured: Boolean(input.weeklyReport),
        actor: input.actor,
      }),
    });
    return { environments, comparison: await this.getComparison(input.projectId) };
  }

  async getComparison(projectId: string) {
    const [state, environments, services] = await Promise.all([
      this.db.getProjectManifestState(projectId),
      this.db.listProjectEnvironments(projectId),
      this.db.getDeployablesByGroup(projectId),
    ]);
    if (!state) {
      return {
        status: 'not_applied' as const,
        state: null,
        drift: [] as ProjectManifestDriftItem[],
      };
    }
    const definition = readDefinition(state.definition_json);
    const drift: ProjectManifestDriftItem[] = [];
    const environmentsByKey = new Map(
      environments.map((environment) => [environment.key, environment]),
    );
    const desiredEnvironmentKeys = new Set(
      definition.environments.map((environment) => environment.key),
    );
    for (const desired of definition.environments) {
      const actual = environmentsByKey.get(desired.key);
      if (!actual) {
        drift.push({ scope: 'environment', kind: 'missing', key: desired.key, fields: [] });
        continue;
      }
      const fields = changedEnvironmentFields(desired, actual);
      if (actual.manifest_sha256 !== state.manifest_sha256) fields.push('manifest_sha256');
      if (fields.length > 0) {
        drift.push({ scope: 'environment', kind: 'changed', key: desired.key, fields });
      }
    }
    for (const actual of environments) {
      if (!desiredEnvironmentKeys.has(actual.key)) {
        drift.push({ scope: 'environment', kind: 'retained', key: actual.key, fields: [] });
      }
    }

    if (definition.services) {
      const servicesById = new Map(services.map((service) => [service.id, service]));
      const desiredServiceIds = new Set(definition.services.map((service) => service.service_id));
      for (const desired of definition.services) {
        const actual = servicesById.get(desired.service_id);
        if (!actual) {
          drift.push({ scope: 'service', kind: 'missing', key: desired.key, fields: [] });
        } else if (actual.runtime_role !== desired.runtime_role) {
          drift.push({
            scope: 'service',
            kind: 'changed',
            key: desired.key,
            fields: ['runtime_role'],
          });
        }
      }
      for (const actual of services) {
        if (!desiredServiceIds.has(actual.id)) {
          drift.push({ scope: 'service', kind: 'retained', key: actual.name, fields: [] });
        }
      }
    }

    return {
      status: drift.length === 0 ? ('in_sync' as const) : ('drifted' as const),
      state,
      drift,
    };
  }
}
