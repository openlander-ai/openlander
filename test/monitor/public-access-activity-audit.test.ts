import { describe, expect, it, vi } from 'vitest';

import type { Database } from '../../src/db/index.js';
import { EventBus } from '../../src/events/index.js';
import { buildActivityEvent } from '../../src/monitor/activity-event-mapper.js';
import { ActivityLogger } from '../../src/monitor/activity-logger.js';

const mockDb = {
  getActionRunsByApprovalStatus: () => [],
  getProject: (id: string) => (id === 'project-1' ? { name: 'demo' } : undefined),
};

describe('protected share activity audit trail', () => {
  it('records completed share lifecycle actions as configuration activity', async () => {
    const event = await buildActivityEvent(mockDb, 'public-access:enabled', {
      projectId: 'project-1',
      serviceId: 'service-web',
      serviceName: 'web',
      hostname: 'web.example.com',
    });

    expect(event).toMatchObject({
      type: 'config',
      status: 'resolved',
      severity: 'info',
      title: 'Protected share enabled',
      description: 'web · web.example.com',
    });
  });

  it('records authentication failures without access codes or client addresses', async () => {
    const event = await buildActivityEvent(mockDb, 'public-access:verification-failed', {
      projectId: 'project-1',
      serviceId: 'service-web',
      serviceName: 'web',
      hostname: 'web.example.com',
      reason: 'rate_limited',
    });

    expect(event).toMatchObject({
      type: 'config',
      status: 'failed',
      severity: 'warning',
      title: 'Protected share authentication failed',
      description: 'web · web.example.com · Rate limit reached',
      reason: 'rate_limited',
    });
    expect(JSON.stringify(event)).not.toMatch(/access.?code=|client.?ip/i);
  });

  it('persists the service reference without credentials or visitor addresses', async () => {
    const insertActivityLog = vi.fn();
    const db = {
      ...mockDb,
      insertActivityLog,
    } as unknown as Database;
    const events = new EventBus();
    const logger = new ActivityLogger(events, db);
    logger.start();

    await events.emit('public-access:verification-failed', {
      projectId: 'project-1',
      serviceId: 'service-web',
      serviceName: 'web',
      hostname: 'web.example.com',
      reason: 'invalid_code',
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(insertActivityLog).toHaveBeenCalledOnce();
    const [row] = insertActivityLog.mock.calls[0] as [Record<string, unknown>];
    expect(row).toMatchObject({
      event_type: 'public-access:verification-failed',
      activity_type: 'config',
      severity: 'warning',
      project_id: 'project-1',
    });
    expect(JSON.parse(String(row.metadata))).toEqual({
      reason: 'invalid_code',
      service_id: 'service-web',
    });
    expect(JSON.stringify(row)).not.toMatch(/access.?code=|client.?ip/i);

    logger.stop();
  });
});
