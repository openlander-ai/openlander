import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import type { DeliveryService } from '../../src/delivery/delivery-service.js';
import { ProjectManifestService } from '../../src/project/project-manifest-service.js';

function createService() {
  const state = {
    project_id: 'project-1',
    manifest_path: '.openlander/project.yml',
    manifest_sha256: 'a'.repeat(64),
    definition_json: {
      services: [{ service_id: 'service-api', key: 'api', runtime_role: 'application' }],
      environments: [
        {
          key: 'qa',
          display_name: 'QA',
          tier: 'validation',
          promotion_order: 0,
          health_timeout_seconds: 30,
          smoke_path: '/health',
          soak_seconds: 10,
        },
        {
          key: 'production',
          display_name: 'Production',
          tier: 'production',
          promotion_order: 1,
          health_timeout_seconds: 60,
          smoke_path: '/health',
          soak_seconds: 30,
        },
      ],
      weekly_report: {
        day_of_week: 'friday',
        time: '17:00',
        timezone: 'Asia/Seoul',
        audiences: ['internal', 'customer'],
      },
    },
    applied_by: 'agent-a',
    applied_at: '2026-07-26T00:00:00.000Z',
  };
  const environments = [
    {
      id: 'environment-production',
      project_id: 'project-1',
      key: 'production',
      display_name: 'Production',
      tier: 'production',
      promotion_order: 1,
      health_timeout_seconds: 45,
      smoke_path: '/health',
      soak_seconds: 30,
      manifest_sha256: 'a'.repeat(64),
    },
    {
      id: 'environment-legacy',
      project_id: 'project-1',
      key: 'legacy',
      display_name: 'Legacy validation',
      tier: 'validation',
      promotion_order: 2,
      health_timeout_seconds: 30,
      smoke_path: null,
      soak_seconds: 0,
      manifest_sha256: '0'.repeat(64),
    },
  ];
  const services = [
    { id: 'service-api', name: 'api', runtime_role: 'job' },
    { id: 'service-worker', name: 'worker', runtime_role: 'application' },
  ];
  const db = {
    getProjectManifestState: vi.fn(async () => state),
    listProjectEnvironments: vi.fn(async () => environments),
    getDeployablesByGroup: vi.fn(async () => services),
    syncProjectEnvironments: vi.fn(async () => environments),
    insertActivityLog: vi.fn(async () => undefined),
  };
  const deliveryService = { assertProjectCanMutate: vi.fn(async () => undefined) };
  return {
    service: new ProjectManifestService(
      db as unknown as Database,
      deliveryService as unknown as DeliveryService,
    ),
    db,
    deliveryService,
  };
}

describe('ProjectManifestService', () => {
  it('reports missing, retained, and changed Project configuration', async () => {
    const { service } = createService();

    await expect(service.getComparison('project-1')).resolves.toMatchObject({
      status: 'drifted',
      drift: expect.arrayContaining([
        { scope: 'environment', kind: 'missing', key: 'qa', fields: [] },
        {
          scope: 'environment',
          kind: 'changed',
          key: 'production',
          fields: ['health_timeout_seconds'],
        },
        { scope: 'environment', kind: 'retained', key: 'legacy', fields: [] },
        {
          scope: 'service',
          kind: 'changed',
          key: 'api',
          fields: ['runtime_role'],
        },
        { scope: 'service', kind: 'retained', key: 'worker', fields: [] },
      ]),
    });
  });

  it('persists service composition, Environment policy, and weekly report schedule', async () => {
    const { service, db } = createService();
    db.getDeployablesByGroup.mockResolvedValue([
      { id: 'service-api', name: 'api', runtime_role: 'application' },
    ]);

    await service.apply({
      projectId: 'project-1',
      manifestPath: '.openlander/project.yml',
      manifestSha256: 'b'.repeat(64),
      services: [{ serviceId: 'service-api', key: 'api', runtimeRole: 'application' }],
      environments: [
        {
          key: 'production',
          displayName: 'Production',
          tier: 'production',
          promotionOrder: 0,
          healthTimeoutSeconds: 60,
          smokePath: '/health',
          soakSeconds: 30,
        },
      ],
      weeklyReport: {
        dayOfWeek: 'friday',
        time: '17:00',
        timezone: 'Asia/Seoul',
        audiences: ['internal', 'customer'],
      },
      actor: 'agent-a',
    });

    expect(db.syncProjectEnvironments).toHaveBeenCalledWith(
      'project-1',
      'b'.repeat(64),
      expect.any(Array),
      expect.objectContaining({
        manifestPath: '.openlander/project.yml',
        appliedBy: 'agent-a',
        definition: expect.objectContaining({
          services: [{ service_id: 'service-api', key: 'api', runtime_role: 'application' }],
          weekly_report: expect.objectContaining({
            day_of_week: 'friday',
            time: '17:00',
            timezone: 'Asia/Seoul',
          }),
        }),
      }),
    );
  });
});
