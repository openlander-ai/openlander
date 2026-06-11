import { describe, expect, it } from 'vitest';

import {
  buildDeterministicAiOpsBriefing,
  normalizeAiOpsEvidencePack,
} from '../../src/monitor/ai-ops-briefing.js';

describe('AI Ops deterministic briefing core', () => {
  it('classifies failed representative public traffic before generic route evidence', () => {
    const briefing = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-api',
      representativeTraffic: {
        status: 'failed',
        severity: 'fail',
        path: '/',
        status_code: 500,
        attempts: 3,
      },
      routeHealth: {
        status: 'unhealthy',
        statusCode: 502,
      },
    });

    expect(briefing.classification).toBe('traffic_health_mismatch');
    expect(briefing.severity).toBe('high');
    expect(briefing.suggestedCall).toEqual({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { service_id: 'svc-api' },
    });
    expect(briefing.dedupeKey).toBe('proj-1:service:svc-api:traffic:/:500');
  });

  it('uses get_build_log for failed deploy evidence when deploy_id exists', () => {
    const briefing = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-api',
      deployLog: {
        id: 'deploy-1',
        status: 'failed',
        buildLogTail: 'error: missing package',
      },
    });

    expect(briefing.classification).toBe('deploy_failed');
    expect(briefing.suggestedCall).toEqual({
      tool: 'openlander_deploy',
      action: 'get_build_log',
      params: { deploy_id: 'deploy-1' },
    });
  });

  it('detects restart-loop evidence without proposing automatic remediation', () => {
    const briefing = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-worker',
      container: {
        running: true,
        restartCount: 4,
      },
    });

    expect(briefing.classification).toBe('restart_loop');
    expect(briefing.suggestedCall?.action).toBe('diagnose_service');
    expect(JSON.stringify(briefing.suggestedCall)).not.toMatch(/restart|redeploy|rollback|env/i);
  });

  it('maps dependency runtime incidents to diagnosis instead of inventing a fix', () => {
    const briefing = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-api',
      runtimeIncident: {
        id: 'inc-1',
        category: 'runtime',
        errorSnippet: 'could not connect to redis at redis:6379',
      },
    });

    expect(briefing.classification).toBe('dependency_failure');
    expect(briefing.deterministicSummary).toContain('redis');
    expect(briefing.suggestedCall).toEqual({
      tool: 'openlander_monitor',
      action: 'diagnose_service',
      params: { service_id: 'svc-api' },
    });
  });

  it('normalizes large log tails before persistence', () => {
    const log = Array.from({ length: 60 }, (_, index) => `line-${String(index + 1)}`).join('\n');
    const evidence = normalizeAiOpsEvidencePack({
      projectId: 'proj-1',
      serviceId: 'svc-api',
      recentLogTail: log,
      deployLog: {
        status: 'failed',
        buildLogTail: log,
      },
    });

    expect(evidence.recentLogTail?.split('\n')).toHaveLength(40);
    expect(evidence.recentLogTail?.startsWith('line-21')).toBe(true);
    expect(evidence.deployLog?.buildLogTail?.split('\n')).toHaveLength(40);
  });
});
