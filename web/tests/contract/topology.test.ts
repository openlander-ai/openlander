/**
 * Contract test: GET /api/projects/:id/topology
 *
 * Asserts that the backend response for the seeded hotdeal-tracker project
 * parses cleanly against ServiceNodeSchema. Any drift between the backend
 * response shape and the UI TypeScript type → zod parse failure here.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { z } from 'zod';
import { ProjectTopologyResponseSchema, ServiceNodeSchema } from '../../src/lib/api/topology-zod';
import { getBaseUrl, authedFetch } from './helpers';

describe('topology contract', () => {
  let baseUrl: string;

  beforeAll(() => {
    baseUrl = getBaseUrl();
  });

  it('GET /api/projects/hotdeal-tracker/topology returns a parseable topology response', async () => {
    const res = await authedFetch(`${baseUrl}/api/projects/hotdeal-tracker/topology`);
    expect(res.status).toBe(200);

    const body: unknown = await res.json();
    const parsed = ProjectTopologyResponseSchema.parse(body);

    expect(parsed.services.length).toBeGreaterThanOrEqual(1);
  });

  it('each service node has valid health, kind, and dependsOn array', async () => {
    const res = await authedFetch(`${baseUrl}/api/projects/hotdeal-tracker/topology`);
    const body: unknown = await res.json();
    const { services } = ProjectTopologyResponseSchema.parse(body);

    for (const svc of services) {
      // Throws if any field drifts from ServiceNodeSchema
      ServiceNodeSchema.parse(svc);
      expect(['healthy', 'crashed']).toContain(svc.health);
      expect(Array.isArray(svc.dependsOn)).toBe(true);
    }
  });

  it('unknown field on topology response is stripped by zod parse (no extra fields leak)', () => {
    // Strip unknown keys — ensure zod schema is strict enough
    const extraField = {
      services: [
        {
          id: 'x',
          name: 'x',
          kind: 'Application' as const,
          port: null,
          image: 'x',
          health: 'healthy' as const,
          cpu: '0%',
          mem: '0 MB',
          url: null,
          dependsOn: [],
          _unknownField: 'should be stripped',
        },
      ],
    };
    const parsed = ProjectTopologyResponseSchema.parse(extraField);
    expect('_unknownField' in (parsed.services[0] as Record<string, unknown>)).toBe(false);
  });

  it('invalid health value causes parse failure', () => {
    const badNode = {
      id: 'x',
      name: 'x',
      kind: 'Application',
      port: null,
      image: 'x',
      health: 'degraded', // not in v1.0 enum
      cpu: '0%',
      mem: '0 MB',
      url: null,
      dependsOn: [],
    };
    expect(() => ServiceNodeSchema.parse(badNode)).toThrow(z.ZodError);
  });
});
