function parseTimestamp(timestamp: string): Date | null {
  const trimmed = timestamp.trim();
  if (!trimmed) return null;

  const sqliteLike = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
  const normalized = sqliteLike.test(trimmed) ? trimmed.replace(' ', 'T') + 'Z' : trimmed;
  const date = new Date(normalized);

  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelativeTime(dateStr: string, t?: (key: string) => string): string {
  const date = parseTimestamp(dateStr);
  if (!date) return '';

  const diffInSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffInSeconds < 60) {
    return t ? 'just now' : 'just now';
  }
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) {
    return t ? `${diffInMinutes}${'m ago'}` : `${diffInMinutes}m ago`;
  }
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return t ? `${diffInHours}${'h ago'}` : `${diffInHours}h ago`;
  }
  const diffInDays = Math.floor(diffInHours / 24);
  return t ? `${diffInDays}${'d ago'}` : `${diffInDays}d ago`;
}

export function formatTime(timestamp: string): string {
  const date = parseTimestamp(timestamp);
  if (!date) {
    return '';
  }

  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatDateTime(timestamp: string): string {
  const date = parseTimestamp(timestamp);
  if (!date) {
    return '';
  }

  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}
