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
    const first = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-worker',
      container: {
        running: true,
        restartCount: 4,
      },
    });
    const second = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-worker',
      container: {
        running: true,
        restartCount: 9,
      },
    });

    expect(first.classification).toBe('restart_loop');
    expect(first.deterministicSummary).toContain('service svc-worker');
    expect(first.deterministicSummary).toContain('restart count 4');
    expect(first.deterministicSummary).not.toContain('unknown');
    expect(first.fingerprint).toBe('restart-loop');
    expect(second.fingerprint).toBe('restart-loop');
    expect(first.dedupeKey).toBe(second.dedupeKey);
    expect(first.suggestedCall?.action).toBe('diagnose_service');
    expect(JSON.stringify(first.suggestedCall)).not.toMatch(/restart|redeploy|rollback|env/i);
  });

  it('keeps single container exit details without calling it a restart loop', () => {
    const briefing = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-api',
      serviceName: 'api__svc',
      container: {
        name: 'ol-api',
        running: false,
        status: 'exited',
        exitCode: 137,
        restartCount: null,
      },
      runtimeIncident: {
        category: 'container_exit',
        errorSnippet: 'Container ol-api exited with code 137.',
      },
    });

    expect(briefing.classification).toBe('container_exited');
    expect(briefing.deterministicSummary).toContain('service api__svc');
    expect(briefing.deterministicSummary).toContain('container ol-api');
    expect(briefing.deterministicSummary).toContain('exit code 137');
    expect(briefing.deterministicSummary).not.toContain('unknown');
    expect(briefing.evidence.container).toMatchObject({
      name: 'ol-api',
      exitCode: 137,
    });
    expect(briefing.suggestedCall?.action).toBe('diagnose_service');
  });

  it('requires explicit loop evidence before classifying a runtime incident as restart-looping', () => {
    const singleExit = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-api',
      runtimeIncident: {
        category: 'container_restart',
        errorSnippet: 'Container ol-api exited once.',
      },
    });
    const explicitLoop = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-api',
      runtimeIncident: {
        category: 'container_restart_loop',
        restartCount: 4,
        errorSnippet: 'Container ol-api restarted repeatedly.',
      },
    });

    expect(singleExit.classification).toBe('runtime_incident');
    expect(explicitLoop.classification).toBe('restart_loop');
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

  it('redacts log-only evidence without promoting it into a ticket', () => {
    const first = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-api',
      recentLogTail:
        'DATABASE_URL=postgres://app:super-secret@db:5432/app\nAuthorization: Bearer abcdefghijklmnopqrstuvwxyz',
    });
    const second = buildDeterministicAiOpsBriefing({
      projectId: 'proj-1',
      serviceId: 'svc-api',
      recentLogTail: 'OPENAI_API_KEY=sk_live_abcdefghijklmnopqrstuvwxyz',
    });

    expect(first.evidence.recentLogTail).toContain('DATABASE_URL=[REDACTED]');
    expect(first.evidence.recentLogTail).toContain('Bearer [REDACTED]');
    expect(first.evidence.recentLogTail).not.toContain('super-secret');
    expect(second.evidence.recentLogTail).toContain('OPENAI_API_KEY=[REDACTED]');
    expect(first.classification).toBe('no_issue_detected');
    expect(second.classification).toBe('no_issue_detected');
    expect(first.fingerprint).toBe('no-issue');
    expect(second.fingerprint).toBe('no-issue');
    expect(first.dedupeKey).toBe(second.dedupeKey);
    expect(first.suggestedCall?.action).toBe('diagnose_service');
  });
});
