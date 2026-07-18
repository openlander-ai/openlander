import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { listGroupServices } from '../../web/src/lib/api/services.js';

describe('Compose service observability UI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests child rows and normalizes aggregate/runtime metadata', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            aggregate_status: 'running',
            services: [
              { id: 'incar__svc', name: 'incar', kind: 'compose', status: 'running' },
              {
                id: 'incar__web__svc',
                name: 'incar/web',
                kind: 'compose-child',
                status: 'running',
                runtime_role: 'application',
                lifecycle: 'long_running',
                health_strategy: 'http',
                is_traffic_target: true,
                last_deploy: {
                  status: 'success',
                  created_at: '2026-07-18T00:00:00.000Z',
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const services = await listGroupServices('incar', { includeComposeChildren: true });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/projects/incar/services?include_compose_children=true',
      undefined,
    );
    expect(services).toHaveLength(2);
    expect(services[1]).toMatchObject({
      runtimeRole: 'application',
      lifecycle: 'long_running',
      healthStrategy: 'http',
      isTrafficTarget: true,
      aggregateStatus: 'running',
      lastDeploy: {
        status: 'success',
        createdAt: '2026-07-18T00:00:00.000Z',
      },
    });
  });

  it('keeps Compose child pages observation-only and role-aware', () => {
    const projectView = readFileSync('web/src/pages/ProjectView.tsx', 'utf8');
    const detail = readFileSync('web/src/pages/ServiceDetailV2.tsx', 'utf8');

    expect(projectView).toContain(
      "resourceServiceNodes.filter((service) => service.kind !== 'Compose')",
    );
    expect(projectView).toContain('composeAggregateStatus={composeAggregateStatus}');
    expect(projectView).toContain('`/projects/${projectId}/services/${service.id}`');
    expect(detail).toContain('!resolvedService.isComposeChild &&');
    expect(detail).toContain("!resolvedService?.isComposeChild || tab.id !== 'environment'");
    expect(detail).toContain(
      "tab.id !== 'domains' || (supportsHttpRuntime && !resolvedService?.isComposeChild)",
    );
    expect(detail).toContain('useServiceHealth(supportsHttpRuntime ? (id ?? null) : null)');
    expect(detail).toContain('showTraffic={supportsHttpRuntime}');
    expect(detail).toContain('readOnly={resolvedService.isComposeChild === true}');
  });

  it('keeps English and Korean Compose labels in sync', () => {
    const en = readFileSync('web/src/i18n/en.ts', 'utf8');
    const ko = readFileSync('web/src/i18n/ko.ts', 'utf8');

    for (const key of ['composeService', 'trafficTarget', 'lastDeploy', 'aggregateHint']) {
      expect(en).toContain(key);
      expect(ko).toContain(key);
    }
  });
});
