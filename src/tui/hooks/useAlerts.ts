import { createSignal, onCleanup } from 'solid-js';
import type { OpenLanderClient } from '../../ipc/client.js';
import type { Alert } from '../../monitor/alerts.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('tui');

export interface UseAlertsResult {
  alerts: () => Alert[];
  dismissAlert: (alertId: string) => Promise<void>;
}

export function useAlerts(
  client: () => OpenLanderClient | null,
  intervalMs = 30000,
): UseAlertsResult {
  const [alerts, setAlerts] = createSignal<Alert[]>([]);
  let lastJson = '';

  const fetchAlerts = async () => {
    const c = client();
    if (!c) {
      if (lastJson !== '') {
        setAlerts([]);
        lastJson = '';
      }
      return;
    }

    try {
      const response = await c.getAlerts();
      const json = JSON.stringify(response);
      if (json !== lastJson) {
        lastJson = json;
        setAlerts(response);
      }
    } catch (err) {
      log.debug({ err }, 'Failed to get alerts from daemon');
    }
  };

  const dismiss = async (alertId: string) => {
    const c = client();
    if (!c) return;
    try {
      await c.dismissAlert(alertId);
      void fetchAlerts();
    } catch (err) {
      log.debug({ err }, 'Failed to dismiss alert');
    }
  };

  void fetchAlerts();
  const timer = setInterval(() => {
    void fetchAlerts();
  }, intervalMs);

  onCleanup(() => {
    clearInterval(timer);
  });

  return { alerts, dismissAlert: dismiss };
}
