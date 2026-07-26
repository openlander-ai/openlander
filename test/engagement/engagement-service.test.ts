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
          gate_key: 'qa',
          label: 'QA',
          required: true,
          status: 'failed' as const,
          summary: 'Synthetic test failed',
          warning_accepted: false,
        },
        {
          id: 'gate-warning',
          delivery_id: 'atlas-review',
          gate_key: 'data',
          label: 'Data',
          required: false,
          status: 'warning' as const,
          summary: 'Coverage warning',
          warning_accepted: false,
        },
        {
          id: 'gate-accepted',
          delivery_id: 'northwind-release',
          gate_key: 'data',
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

  it('returns locale-neutral blocker and activity metadata without rewriting source text', async () => {
    const row = engagement('engagement-atlas', 'Atlas Synthetic');
    const project = membership(row.id, 'atlas-web');
    const portfolio = {
      memberships: [project],
      serviceRows: [
        {
          project_id: project.project_id,
          kind: 'git',
          status: 'error' as const,
          runtime_role: 'application' as const,
          archived_at: null,
        },
      ],
      deliveryRows: [
        {
          id: 'delivery-review',
          project_id: project.project_id,
          title: '고객 입력 납품 제목',
          delivery_type: 'artifact_delivery' as const,
          maturity: 'customer_review' as const,
          status: 'revision_requested' as const,
          updated_at: NOW,
        },
      ],
      gateRows: [
        {
          id: 'gate-required',
          delivery_id: 'delivery-review',
          gate_key: 'custom-required',
          label: '고객 입력 품질 기준',
          required: true,
          status: 'failed' as const,
          summary: '고객 입력 실패 상세',
          warning_accepted: false,
        },
        {
          id: 'gate-warning',
          delivery_id: 'delivery-review',
          gate_key: 'custom-warning',
          label: '고객 입력 경고 기준',
          required: false,
          status: 'warning' as const,
          summary: null,
          warning_accepted: false,
        },
      ],
      workItemRows: [
        {
          id: 'work-confirmed',
          delivery_id: 'delivery-review',
          kind: 'question' as const,
          title: '고객 입력 질문',
          detail: '고객 입력 질문 상세',
          status: 'confirmed' as const,
        },
      ],
      activityRows: [],
    };
    const service = new EngagementService({
      requireEngagement: vi.fn(async () => row),
      getEngagementPortfolioRows: vi.fn(async () => portfolio),
      listEngagementRecentActivity: vi.fn(async () => [
        {
          id: 'activity-engagement-created',
          event_type: 'engagement:created',
          activity_type: 'engagement',
          severity: 'info',
          project_id: `engagement:${row.id}`,
          correlation_id: row.id,
          title: 'Legacy English fallback',
          description: 'Legacy English description.',
          status: 'active',
          metadata: JSON.stringify({
            actor: 'admin',
            engagement_title: '고객 입력 과제 제목',
          }),
          created_at: NOW,
        },
        {
          id: 'activity-delivery-updated',
          event_type: 'delivery.updated',
          activity_type: 'delivery',
          severity: 'info',
          project_id: project.project_id,
          correlation_id: 'delivery-review',
          title: 'Delivery updated',
          description: 'Updated Delivery metadata.',
          status: 'completed',
          metadata: JSON.stringify({ delivery_id: 'delivery-review' }),
          created_at: NOW,
        },
      ]),
    } as unknown as Database);

    const detail = await service.get(row.id);

    expect(detail.blockers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'project_error',
          metadata: { runtime_status: 'error', error_service_count: 1 },
        }),
        expect.objectContaining({
          kind: 'revision_requested',
          delivery_title: '고객 입력 납품 제목',
          metadata: { delivery_status: 'revision_requested' },
        }),
        expect.objectContaining({
          kind: 'required_gate_failed',
          title: '고객 입력 품질 기준',
          detail: '고객 입력 실패 상세',
          metadata: expect.objectContaining({
            gate_key: 'custom-required',
            gate_label: '고객 입력 품질 기준',
            gate_summary: '고객 입력 실패 상세',
            gate_required: true,
            gate_status: 'failed',
          }),
        }),
        expect.objectContaining({
          kind: 'warning_unacknowledged',
          metadata: expect.objectContaining({ gate_summary: null, gate_status: 'warning' }),
        }),
        expect.objectContaining({
          kind: 'work_item_unresolved',
          title: '고객 입력 질문',
          detail: '고객 입력 질문 상세',
          metadata: expect.objectContaining({
            work_item_kind: 'question',
            work_item_status: 'confirmed',
            work_item_title: '고객 입력 질문',
            work_item_detail: '고객 입력 질문 상세',
          }),
        }),
      ]),
    );
    expect(detail.recent_activity).toEqual([
      expect.objectContaining({
        event_type: 'engagement:created',
        title: 'Legacy English fallback',
        description: 'Legacy English description.',
        metadata: expect.objectContaining({
          schema_version: 1,
          engagement_id: row.id,
          engagement_title: '고객 입력 과제 제목',
        }),
      }),
      expect.objectContaining({
        event_type: 'delivery.updated',
        metadata: expect.objectContaining({
          schema_version: 1,
          engagement_id: row.id,
          project_id: project.project_id,
          delivery_id: 'delivery-review',
        }),
      }),
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
