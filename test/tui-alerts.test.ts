import { describe, it, expect } from 'vitest';
import type { Alert } from '../src/monitor/alerts.js';
import { truncate } from '../src/tui/dashboard-utils.js';

// ---------------------------------------------------------------------------
// AlertsSection Logic Tests
// Tests the sorting, filtering, and display logic used by AlertsSection
// ---------------------------------------------------------------------------

// Pure functions that mirror the AlertsSection component logic
function sortAlerts(alerts: Alert[]): Alert[] {
  const items = [...alerts];
  items.sort((a, b) => {
    const sevOrder: Record<string, number> = { critical: 0, warning: 1 };
    return (sevOrder[a.severity] ?? 2) - (sevOrder[b.severity] ?? 2);
  });
  return items;
}

function getVisibleAlerts(alerts: Alert[]): Alert[] {
  return sortAlerts(alerts).slice(0, 3);
}

function getRemainingCount(alerts: Alert[]): number {
  return Math.max(0, alerts.length - 3);
}

function truncateAlertMessage(message: string, maxLen: number): string {
  return truncate(message, maxLen);
}

// Test helpers
function createAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: `alert-${Math.random().toString(36).slice(2)}`,
    type: 'disk',
    severity: 'warning',
    message: 'Test alert',
    details: {},
    suggestion: 'Test suggestion',
    createdAt: new Date(),
    dismissed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Sorting Tests
// ---------------------------------------------------------------------------

describe('sortAlerts', () => {
  it('sorts critical before warning', () => {
    const warning1 = createAlert({ id: 'w1', severity: 'warning', message: 'Warning 1' });
    const critical1 = createAlert({ id: 'c1', severity: 'critical', message: 'Critical 1' });
    const warning2 = createAlert({ id: 'w2', severity: 'warning', message: 'Warning 2' });

    const result = sortAlerts([warning1, critical1, warning2]);

    expect(result[0].severity).toBe('critical');
    expect(result[1].severity).toBe('warning');
    expect(result[2].severity).toBe('warning');
  });

  it('maintains stable order for same severity', () => {
    const warning1 = createAlert({ id: 'w1', severity: 'warning', message: 'Warning A' });
    const warning2 = createAlert({ id: 'w2', severity: 'warning', message: 'Warning B' });
    const warning3 = createAlert({ id: 'w3', severity: 'warning', message: 'Warning C' });

    const result = sortAlerts([warning3, warning1, warning2]);

    expect(result[0].id).toBe('w3');
    expect(result[1].id).toBe('w1');
    expect(result[2].id).toBe('w2');
  });

  it('handles multiple critical alerts', () => {
    const critical1 = createAlert({ id: 'c1', severity: 'critical', message: 'Critical 1' });
    const critical2 = createAlert({ id: 'c2', severity: 'critical', message: 'Critical 2' });
    const warning1 = createAlert({ id: 'w1', severity: 'warning', message: 'Warning 1' });

    const result = sortAlerts([warning1, critical2, critical1]);

    expect(result[0].severity).toBe('critical');
    expect(result[1].severity).toBe('critical');
    expect(result[2].severity).toBe('warning');
  });

  it('returns empty array unchanged', () => {
    expect(sortAlerts([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Visibility Tests
// ---------------------------------------------------------------------------

describe('getVisibleAlerts', () => {
  it('returns empty array for 0 alerts', () => {
    expect(getVisibleAlerts([])).toEqual([]);
  });

  it('returns 1 alert unchanged', () => {
    const alert = createAlert({ id: 'a1', message: 'Single alert' });
    const result = getVisibleAlerts([alert]);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('returns 2 alerts unchanged', () => {
    const alert1 = createAlert({ id: 'a1', message: 'Alert 1' });
    const alert2 = createAlert({ id: 'a2', message: 'Alert 2' });
    const result = getVisibleAlerts([alert1, alert2]);

    expect(result).toHaveLength(2);
  });

  it('returns 3 alerts unchanged', () => {
    const alerts = [
      createAlert({ id: 'a1' }),
      createAlert({ id: 'a2' }),
      createAlert({ id: 'a3' }),
    ];
    const result = getVisibleAlerts(alerts);

    expect(result).toHaveLength(3);
  });

  it('returns only first 3 alerts when 4 provided', () => {
    const alerts = [
      createAlert({ id: 'a1', severity: 'critical' }),
      createAlert({ id: 'a2', severity: 'critical' }),
      createAlert({ id: 'a3', severity: 'warning' }),
      createAlert({ id: 'a4', severity: 'warning' }),
    ];
    const result = getVisibleAlerts(alerts);

    expect(result).toHaveLength(3);
    expect(result.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('returns only first 3 alerts when more than 4 provided', () => {
    const alerts = [
      createAlert({ id: 'a1', severity: 'critical' }),
      createAlert({ id: 'a2', severity: 'warning' }),
      createAlert({ id: 'a3', severity: 'warning' }),
      createAlert({ id: 'a4', severity: 'warning' }),
      createAlert({ id: 'a5', severity: 'warning' }),
    ];
    const result = getVisibleAlerts(alerts);

    expect(result).toHaveLength(3);
    expect(result.map((a) => a.id)).toEqual(['a1', 'a2', 'a3']);
  });

  it('sorts before slicing', () => {
    // If we have warnings first, they should be sorted with critical first
    const alerts = [
      createAlert({ id: 'w1', severity: 'warning' }),
      createAlert({ id: 'w2', severity: 'warning' }),
      createAlert({ id: 'c1', severity: 'critical' }),
      createAlert({ id: 'w3', severity: 'warning' }),
    ];
    const result = getVisibleAlerts(alerts);

    // Critical should be first after sorting
    expect(result[0].severity).toBe('critical');
    expect(result).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Remaining Count Tests
// ---------------------------------------------------------------------------

describe('getRemainingCount', () => {
  it('returns 0 for 0 alerts', () => {
    expect(getRemainingCount([])).toBe(0);
  });

  it('returns 0 for 1 alert', () => {
    expect(getRemainingCount([createAlert()])).toBe(0);
  });

  it('returns 0 for 2 alerts', () => {
    expect(getRemainingCount([createAlert(), createAlert()])).toBe(0);
  });

  it('returns 0 for exactly 3 alerts', () => {
    expect(getRemainingCount([createAlert(), createAlert(), createAlert()])).toBe(0);
  });

  it('returns 1 for 4 alerts', () => {
    expect(getRemainingCount([createAlert(), createAlert(), createAlert(), createAlert()])).toBe(1);
  });

  it('returns correct count for more alerts', () => {
    const alerts = Array.from({ length: 10 }, () => createAlert());
    expect(getRemainingCount(alerts)).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Truncation Tests (using existing truncate function)
// ---------------------------------------------------------------------------

describe('truncate for alerts', () => {
  it('truncates to 30 characters', () => {
    const longMessage =
      'This is a very long alert message that should be truncated to fit in the UI';
    const result = truncateAlertMessage(longMessage, 30);

    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).toBe('This is a very long alert m...');
  });

  it('keeps short messages unchanged', () => {
    const shortMessage = 'Short alert';
    const result = truncateAlertMessage(shortMessage, 30);

    expect(result).toBe('Short alert');
  });

  it('keeps exactly 30 char message unchanged', () => {
    const exactMessage = 'a'.repeat(30);
    const result = truncateAlertMessage(exactMessage, 30);

    expect(result).toBe(exactMessage);
    expect(result.length).toBe(30);
  });

  it('truncates 31 char message correctly', () => {
    const message = 'a'.repeat(31);
    const result = truncateAlertMessage(message, 30);

    expect(result.length).toBe(30);
    expect(result.endsWith('...')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Integration: Full flow test
// ---------------------------------------------------------------------------

describe('AlertsSection full flow', () => {
  it('handles typical alert scenario', () => {
    const alerts: Alert[] = [
      createAlert({ severity: 'warning', message: 'Disk usage at 85%' }),
      createAlert({ severity: 'critical', message: 'Container restarting loop detected' }),
      createAlert({ severity: 'warning', message: 'Project inactive for 14 days' }),
      createAlert({ severity: 'warning', message: 'Dangling images detected' }),
    ];

    const visible = getVisibleAlerts(alerts);
    const remaining = getRemainingCount(alerts);

    // Should show 3 alerts
    expect(visible).toHaveLength(3);

    // Critical should be first
    expect(visible[0].severity).toBe('critical');

    // Should have 1 remaining
    expect(remaining).toBe(1);

    // Each message should be truncated to 30 chars
    for (const alert of visible) {
      const truncated = truncateAlertMessage(alert.message, 30);
      expect(truncated.length).toBeLessThanOrEqual(30);
    }
  });
});
