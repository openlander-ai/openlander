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
 * 404 → throws so the hook can fall back to mock data; transient errors
 * also throw and the hook keeps last-good data on subsequent polls.
 */
import type { ServiceNode } from '../projectTopology';
import { apiGet } from './client';

export interface ProjectTopologyResponse {
  services: ServiceNode[];
}

export async function fetchProjectTopology(id: string): Promise<ServiceNode[]> {
  const data = await apiGet<ProjectTopologyResponse>(`/api/projects/${id}/topology`);
  return data.services;
}
