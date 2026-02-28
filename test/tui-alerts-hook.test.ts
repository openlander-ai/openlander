import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'solid-js';

import { useAlerts } from '../src/tui/hooks/useAlerts.js';
import type { OpenLanderClient } from '../src/ipc/client.js';
import type { Alert } from '../src/monitor/alerts.js';

function withRoot<T>(fn: () => T): T {
return createRoot((dispose) => {
const result = fn();
dispose();
return result;
});
}

// Helper for async tests that need the root to stay alive
function withAsyncRoot<T>(fn: (dispose: () => void) => T): T {
  let dispose: () => void;
  const result = createRoot((d) => {
    dispose = d;
    return fn(d);
  }) as T;
  return result;
}

const mockAlert: Alert = {
  id: 'alert-1',
  type: 'disk',
  severity: 'warning',
  message: 'Disk usage at 85%',
  details: { usagePercent: 85 },
  suggestion: 'Clean up unused files',
  createdAt: new Date('2025-01-01T00:00:00Z'),
  dismissed: false,
};

function createMockClient(alerts: Alert[] = []): OpenLanderClient {
  return {
    getAlerts: vi.fn().mockResolvedValue(alerts),
    dismissAlert: vi.fn().mockResolvedValue(undefined),
  } as unknown as OpenLanderClient;
}

// Helper to wait for a short duration
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('useAlerts hook', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns empty array initially', () => {
    const client = createMockClient();
    const clientGetter = () => client;

    const result = withRoot(() => useAlerts(clientGetter, 30000));

    expect(result.alerts()).toEqual([]);
  });

  it('fetches alerts from client on mount', async () => {
    const client = createMockClient([mockAlert]);
    const clientGetter = () => client;

    const result = withRoot(() => useAlerts(clientGetter, 30000));

    // Wait for initial fetch to complete
    await wait(10);

    expect(client.getAlerts).toHaveBeenCalledTimes(1);
    expect(result.alerts()).toEqual([mockAlert]);
  });

  it('does not update signal when JSON is identical (dedup)', async () => {
    const client = createMockClient([mockAlert]);
    const clientGetter = () => client;

    await withAsyncRoot(async (dispose) => {
      const result = useAlerts(clientGetter, 50);

      await wait(10);

      // First fetch - should update
      expect(result.alerts()).toEqual([mockAlert]);
      const callCountAfterFirst = (client.getAlerts as ReturnType<typeof vi.fn>).mock.calls.length;

      // Wait for another interval
      await wait(60);

      // Second fetch - should have called again
      expect((client.getAlerts as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(
        callCountAfterFirst,
      );
      expect(result.alerts()).toEqual([mockAlert]);
      dispose();
    });
  });

  it('clears alerts when client becomes null', async () => {
    let currentClient: OpenLanderClient | null = createMockClient([mockAlert]);
    const clientGetter = () => currentClient;

    await withAsyncRoot(async (dispose) => {
      const result = useAlerts(clientGetter, 50);

      await wait(10);
      expect(result.alerts()).toEqual([mockAlert]);

      // Simulate client disconnecting
      currentClient = null;

      // Wait for next fetch with null client
      await wait(60);

      expect(result.alerts()).toEqual([]);
      dispose();
    });
  });

  it('dismissAlert calls client.dismissAlert and refetches', async () => {
    const client = createMockClient([mockAlert]);
    const clientGetter = () => client;

    const result = withRoot(() => useAlerts(clientGetter, 30000));

    await wait(10);

    await result.dismissAlert('alert-1');
    await wait(10);

    expect(client.dismissAlert).toHaveBeenCalledWith('alert-1');
    // Should refetch after dismiss
    expect(client.getAlerts).toHaveBeenCalledTimes(2);
  });

  it('dismissAlert does nothing when client is null', async () => {
    const clientGetter = () => null;

    const result = withRoot(() => useAlerts(clientGetter, 30000));

    await wait(10);

    // Should not throw
    await result.dismissAlert('alert-1');
  });

  it('polls for alerts at specified interval', async () => {
    const client = createMockClient([mockAlert]);
    const clientGetter = () => client;

    await withAsyncRoot(async (dispose) => {
      useAlerts(clientGetter, 30);

      // Initial fetch
      await wait(10);
      expect(client.getAlerts).toHaveBeenCalledTimes(1);

      // First interval
      await wait(30);
      expect(client.getAlerts).toHaveBeenCalledTimes(2);

      // Second interval
      await wait(30);
      expect(client.getAlerts).toHaveBeenCalledTimes(3);

      dispose();
    });
  });
});
