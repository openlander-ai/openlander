export function formatUptime(startTime: string): string {
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return '—';

  const diffMs = Math.max(Date.now() - start.getTime(), 0);
  const totalMins = Math.floor(diffMs / 60000);
  const days = Math.floor(totalMins / (24 * 60));
  const hours = Math.floor((totalMins % (24 * 60)) / 60);
  const mins = totalMins % 60;

  if (days > 0) {
    return `${String(days)}d ${String(hours)}h`;
  }

  return `${String(hours)}h ${String(mins)}m`;
}

export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '—';

  const diffMs = Math.max(Date.now() - date.getTime(), 0);
  const totalMins = Math.floor(diffMs / 60000);

  if (totalMins < 60) {
    return `${String(totalMins)}m ago`;
  }

  const totalHours = Math.floor(totalMins / 60);
  if (totalHours < 24) {
    return `${String(totalHours)}h ago`;
  }

  const totalDays = Math.floor(totalHours / 24);
  return `${String(totalDays)}d ago`;
}

export function formatImageId(containerId?: string): string {
  if (!containerId) return '—';
  return containerId.length > 12 ? `${containerId.slice(0, 12)}...` : containerId;
}
