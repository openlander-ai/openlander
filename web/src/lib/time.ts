export function formatRelativeTime(dateStr: string, t?: (key: string) => string): string {
  const diffInSeconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
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
  try {
    return new Date(timestamp).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return '';
  }
}
