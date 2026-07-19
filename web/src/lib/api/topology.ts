/**
 * Topology endpoint client — Round 4 PR6.
 *
 * Backend contract:
 *   GET /api/projects/:id/topology
 *   → { services: ServiceNode[] }
 *
 * The ServiceNode shape on the wire matches `web/src/lib/projectTopology.ts`
 * field-for-field (id/name/kind/image/health/port/url/cpu/mem/dependsOn).
 * That's intentional — the backend parser populates the same shape the
 * prototype mock used.
 *
 * 1.0-rc.2 P1 additive-schema note: post-fullsplit the topology endpoint
 * still returns the same wire shape — group fields drop out of service
 * nodes and service fields drop out of the (implicit) group root, so the
 * response is purely a `services[]` array. The existing parser tolerates
 * the new shape natively because it only reads the per-service fields.
 *
 * 404 → throws so the hook can fall back to mock data; transient errors
 * also throw and the hook keeps last-good data on subsequent polls.
 */
import type { ServiceNode } from '../projectTopology';
import { apiGet } from './client';

export interface ProjectTopologyResponse {
  services: ServiceNode[];
  aggregate_status?: 'running' | 'degraded' | 'error';
}

export async function fetchProjectTopology(id: string): Promise<ServiceNode[]> {
  const data = await apiGet<ProjectTopologyResponse>(`/api/projects/${id}/topology`);
  return data.services;
}
