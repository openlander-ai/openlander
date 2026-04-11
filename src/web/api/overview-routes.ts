import { Hono } from 'hono';

import type { AppContext } from '../../app.js';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('overview-routes');

/** Platform KPI stats for the Overview page. Each field defaults to 0 on error. */
export function createOverviewRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/overview/stats', (c) => {
    let activeDeploys = 0;
    let activeRecoveries = 0;
    let pendingApprovals = 0;
    let openIncidents = 0;
    let unhealthyServices = 0;
    let aiSpendToday = 0;

    try {
      activeDeploys = ctx.jobManager.getActiveJobs().length;
    } catch (err) {
      log.warn({ err }, 'Failed to get active deploys count');
    }

    try {
      const activeIncidents = ctx.db.listAllActiveOpsIncidents();
      for (const incident of activeIncidents) {
        if (incident.status === 'active') {
          activeRecoveries++;
        } else if (incident.status === 'open') {
          openIncidents++;
        }
      }
    } catch (err) {
      log.warn({ err }, 'Failed to get ops incidents count');
    }

    try {
      pendingApprovals = ctx.db.getActionRunsByApprovalStatus('pending').length;
    } catch (err) {
      log.warn({ err }, 'Failed to get pending approvals count');
    }

    try {
      const allServices = ctx.db.listServices();
      unhealthyServices = allServices.filter((s) => s.status !== 'running').length;
    } catch (err) {
      log.warn({ err }, 'Failed to get unhealthy services count');
    }

    try {
      const now = new Date();
      const startOfToday = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
      );
      const summary = ctx.db.getAiTokenSummaryFiltered({ from: startOfToday, to: now });
      aiSpendToday = Math.round((summary.totalCostUsd ?? 0) * 100) / 100;
    } catch (err) {
      log.warn({ err }, 'Failed to get AI spend today');
    }

    return c.json({
      active_deploys: activeDeploys,
      active_recoveries: activeRecoveries,
      pending_approvals: pendingApprovals,
      open_incidents: openIncidents,
      unhealthy_services: unhealthyServices,
      ai_spend_today: aiSpendToday,
    });
  });

  return api;
}
