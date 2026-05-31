import { describe, expect, it } from 'vitest';

import { buildActivityEvent } from '../../src/monitor/activity-event-mapper.js';

const mockDb = {
  getActionRunsByApprovalStatus: () => [],
  getProject: (id: string) => (id === 'proj-1' ? { name: 'alpha-service' } : undefined),
};

describe('approval resolved activity audit trail', () => {
  it('describes the approved action and resolver surface', async () => {
    const event = await buildActivityEvent(mockDb, 'recovery:approval-resolved', {
      projectId: 'proj-1',
      actionRunId: 'run-1',
      approved: true,
      toolName: 'archive_project',
      approvalTool: 'destructive_mcp',
      resolvedBy: 'web-session',
    });

    expect(event).not.toBeNull();
    expect(event!.type).toBe('approval');
    expect(event!.status).toBe('resolved');
    expect(event!.projectName).toBe('alpha-service');
    expect(event!.title).toBe('Approval approved: destructive_mcp action: archive_project');
    expect(event!.description).toBe('Resolved by web-session · action run run-1');
    expect(event!.actionRunId).toBe('run-1');
  });

  it('describes rejected approvals with the same audit detail', async () => {
    const event = await buildActivityEvent(mockDb, 'recovery:approval-resolved', {
      projectId: 'proj-1',
      actionRunId: 'run-2',
      approved: false,
      toolName: 'unarchive_service',
      approvalTool: 'destructive_mcp',
      resolvedBy: 'web-session',
    });

    expect(event).not.toBeNull();
    expect(event!.status).toBe('failed');
    expect(event!.title).toBe('Approval rejected: destructive_mcp action: unarchive_service');
    expect(event!.description).toBe('Resolved by web-session · action run run-2');
  });
});
