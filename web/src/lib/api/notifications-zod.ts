/**
 * Zod schemas for notification webhook API shapes — contract test use only.
 *
 * Parallel file to notifications.ts. Keeps zod out of production bundle.
 */
import { z } from 'zod';
import type { NotificationWebhookConfig } from './notifications';

export const NotificationWebhookConfigSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()),
});

// Compile-time parity assertion
type _NotifParity =
  z.infer<typeof NotificationWebhookConfigSchema> extends NotificationWebhookConfig
    ? NotificationWebhookConfig extends z.infer<typeof NotificationWebhookConfigSchema>
      ? true
      : never
    : never;
const _notifCheck: _NotifParity = true;
void _notifCheck;
