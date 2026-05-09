/**
 * Notifications webhook endpoint client — Round 4 PR6.
 *
 * Backend contract:
 *   GET    /api/settings/notifications/webhook → 200 { url, events[] } | 404
 *   POST   /api/settings/notifications/webhook { url, events[] } → 200
 *   DELETE /api/settings/notifications/webhook → 200
 *
 * 1.0 ships a single generic webhook (not provider-specific). Discord /
 * Slack / Email presets are v1.1+ and reuse the same plumbing.
 */
import { fetchWithAuth } from './auth';
import { apiDelete, apiPostVoid } from './client';

export interface NotificationWebhookConfig {
  url: string;
  events: string[];
}

/**
 * Returns null when no webhook is configured (404). All other failures
 * throw so callers can show an error toast.
 */
export async function fetchNotificationWebhook(): Promise<NotificationWebhookConfig | null> {
  const res = await fetchWithAuth('/api/settings/notifications/webhook');
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to fetch webhook (${res.status})`);
  }
  return res.json();
}

export async function saveNotificationWebhook(config: NotificationWebhookConfig): Promise<void> {
  return apiPostVoid('/api/settings/notifications/webhook', config);
}

export async function deleteNotificationWebhook(): Promise<void> {
  return apiDelete('/api/settings/notifications/webhook');
}
