import { describe, expect, it } from 'vitest';

import {
  DEPLOY_ACTIONS,
  MANAGED_SERVICE_ACTIONS,
  MONITOR_ACTIONS,
  PROJECT_ACTIONS,
  SERVICE_ACTIONS,
} from '../../src/mcp/composite-tools.js';

const NON_MONITOR_COMPOSITES = {
  openlander_deploy: DEPLOY_ACTIONS,
  openlander_project: PROJECT_ACTIONS,
  openlander_service: SERVICE_ACTIONS,
  openlander_managed_service: MANAGED_SERVICE_ACTIONS,
} as const;

const RESERVED_AI_OPS_BRIEFING_ACTIONS = [
  'list_ai_ops_briefings',
  'get_ai_ops_briefing',
] as const;

describe('AI Ops MCP composite guardrail', () => {
  it('keeps AI Ops briefing actions out of non-monitor composites', () => {
    const offenders: string[] = [];

    for (const [composite, actions] of Object.entries(NON_MONITOR_COMPOSITES)) {
      for (const action of actions) {
        if (/ai_ops|briefing/i.test(action)) {
          offenders.push(`${composite}.${action}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it('reserves v0.2 briefing actions for openlander_monitor only', () => {
    for (const action of RESERVED_AI_OPS_BRIEFING_ACTIONS) {
      const nonMonitorOwners = Object.entries(NON_MONITOR_COMPOSITES)
        .filter(([, actions]) => (actions as readonly string[]).includes(action))
        .map(([composite]) => composite);

      expect(nonMonitorOwners).toEqual([]);
      if ((MONITOR_ACTIONS as readonly string[]).includes(action)) {
        expect(MONITOR_ACTIONS).toContain(action);
      }
    }
  });
});
