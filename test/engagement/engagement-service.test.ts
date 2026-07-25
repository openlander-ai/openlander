import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../../src/db/index.js';
import { EngagementService } from '../../src/engagement/engagement-service.js';

const NOW = '2026-07-25T00:00:00.000Z';

function engagement(id: string, customer: string) {
  return {
    id,
    customer_name: customer,
    title: `${customer} rollout`,
    summary: 'Synthetic FDE engagement',
    status: 'active' as const,
    created_by: 'admin',
    created_at: NOW,
    updated_at: NOW,
  };
}

function membership(engagementId: string, projectId: string) {
  return {
    engagement_id: engagementId,
    project_id: projectId,
    linked_by: 'admin',
    linked_at: NOW,
    project_name: projectId,
    project_display_name: projectId.toUpperCase(),
    project_archived_at: null,
    project_updated_at: NOW,
  };
}

describe('EngagementService portfolio rollups', () => {
  it('isolates two synthetic customers and computes deterministic blockers in bounded reads', async () => {
    const rows = [
      engagement('engagement-atlas', 'Atlas Synthetic'),
      engagement('engagement-northwind', 'Northwind Synthetic'),
    ];
    const listEngagements = vi.fn(async () => rows);
    const getEngagementPortfolioRows = vi.fn(async () => ({
      memberships: [
        membership('engagement-atlas', 'atlas-web'),
        membership('engagement-atlas', 'atlas-worker'),
        membership('engagement-northwind', 'northwind-web'),
        membership('engagement-northwind', 'northwind-api'),
      ],
      serviceRows: [
        {
          project_id: 'atlas-web',
          kind: 'git',
          status: 'error' as const,
          runtime_role: 'application' as const,
          archived_at: null,
        },
        {
          project_id: 'atlas-worker',
          kind: 'git',
          status: 'running' as const,
          runtime_role: 'application' as const,
          archived_at: null,
        },
        {
          project_id: 'northwind-web',
          kind: 'git',
          status: 'running' as const,
          runtime_role: 'application' as const,
          archived_at: null,
        },
        {
          project_id: 'northwind-api',
          kind: 'git',
          status: 'stopped' as const,
          runtime_role: 'application' as const,
          archived_at: null,
        },
      ],
      deliveryRows: [
        {
          id: 'atlas-review',
          project_id: 'atlas-web',
          title: 'Atlas review',
          delivery_type: 'artifact_delivery' as const,
          maturity: 'customer_review' as const,
          status: 'revision_requested' as const,
          updated_at: NOW,
        },
        {
          id: 'atlas-release',
          project_id: 'atlas-worker',
          title: 'Atlas release',
          delivery_type: 'software_release' as const,
          maturity: 'release_candidate' as const,
          status: 'ready' as const,
          updated_at: NOW,
        },
        {
          id: 'northwind-release',
          project_id: 'northwind-web',
          title: 'Northwind release',
          delivery_type: 'software_release' as const,
          maturity: 'production' as const,
          status: 'delivered' as const,
          updated_at: NOW,
        },
      ],
      gateRows: [
        {
          id: 'gate-required',
          delivery_id: 'atlas-release',
          label: 'QA',
          required: true,
          status: 'failed' as const,
          summary: 'Synthetic test failed',
          warning_accepted: false,
        },
        {
          id: 'gate-warning',
          delivery_id: 'atlas-review',
          label: 'Data',
          required: false,
          status: 'warning' as const,
          summary: 'Coverage warning',
          warning_accepted: false,
        },
        {
          id: 'gate-accepted',
          delivery_id: 'northwind-release',
          label: 'Data',
          required: false,
          status: 'warning' as const,
          summary: 'Accepted warning',
          warning_accepted: true,
        },
      ],
      workItemRows: [
        {
          id: 'work-confirmed',
          delivery_id: 'atlas-review',
          kind: 'question' as const,
          title: 'Confirm mapping',
          detail: 'Synthetic question',
          status: 'confirmed' as const,
        },
        {
          id: 'work-proposed',
          delivery_id: 'northwind-release',
          kind: 'change_request' as const,
          title: 'Draft only',
          detail: 'Not confirmed',
          status: 'proposed' as const,
        },
      ],
      activityRows: [],
    }));
    const service = new EngagementService({
      listEngagements,
      getEngagementPortfolioRows,
    } as unknown as Database);

    const summaries = await service.list();
    const atlas = summaries.find((entry) => entry.id === 'engagement-atlas');
    const northwind = summaries.find((entry) => entry.id === 'engagement-northwind');

    expect(atlas).toMatchObject({
      runtime_health: 'degraded',
      project_count: 2,
      blocker_count: 5,
      delivery_summary: {
        total: 2,
        blocker_count: 2,
        by_status: { revision_requested: 1, ready: 1, delivered: 0 },
      },
    });
    expect(northwind).toMatchObject({
      runtime_health: 'healthy',
      project_count: 2,
      blocker_count: 0,
      delivery_summary: {
        total: 1,
        blocker_count: 0,
        by_status: { delivered: 1, ready: 0 },
      },
    });
    expect(listEngagements).toHaveBeenCalledTimes(1);
    expect(getEngagementPortfolioRows).toHaveBeenCalledTimes(1);
    expect(getEngagementPortfolioRows).toHaveBeenCalledWith([
      'engagement-atlas',
      'engagement-northwind',
    ]);
  });

  it('returns unknown runtime health only when there is no linked active Project', async () => {
    const archivedMembership = {
      ...membership('engagement-archived-projects', 'archived-project'),
      project_archived_at: NOW,
    };
    const service = new EngagementService({
      listEngagements: vi.fn(async () => [
        engagement('engagement-archived-projects', 'Archived Synthetic'),
      ]),
      getEngagementPortfolioRows: vi.fn(async () => ({
        memberships: [archivedMembership],
        serviceRows: [],
        deliveryRows: [],
        gateRows: [],
        workItemRows: [],
        activityRows: [],
      })),
    } as unknown as Database);

    await expect(service.list()).resolves.toMatchObject([
      {
        runtime_health: 'unknown',
        project_count: 1,
        active_project_count: 0,
      },
    ]);
  });
});
