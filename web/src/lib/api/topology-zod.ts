/**
 * Zod schemas for topology API shapes — contract test use only.
 *
 * Parallel file to topology.ts + projectTopology.ts; keeps zod out of
 * the production bundle. Phase G bundle audit: grep zod in dist/ = 0.
 */
import { z } from 'zod';
import type { ServiceNode } from '../projectTopology';

export const ServiceNodeSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(['Application', 'Compose', 'Database', 'Cache', 'Storage']),
  port: z.number().nullable(),
  image: z.string(),
  health: z.enum(['healthy', 'crashed', 'deploying']),
  cpu: z.string(),
  mem: z.string(),
  url: z.string().nullable(),
  dependsOn: z.array(z.string()),
  source: z.string().nullable().optional(),
  repoUrl: z.string().nullable().optional(),
  branch: z.string().nullable().optional(),
  deployedBranch: z.string().nullable().optional(),
  dockerfilePath: z.string().nullable().optional(),
  dockerTarget: z.string().nullable().optional(),
  buildContext: z.string().nullable().optional(),
  buildMethod: z.string().nullable().optional(),
  runtimeRole: z.enum(['application', 'job', 'resource']).optional(),
  lifecycle: z.enum(['long_running', 'one_shot']).optional(),
  healthStrategy: z.enum(['http', 'tcp', 'docker_health', 'exit_code', 'none']).optional(),
  isTrafficTarget: z.boolean().optional(),
  aggregateStatus: z.enum(['running', 'degraded', 'error']).optional(),
  lastDeploy: z
    .object({
      status: z.enum(['success', 'failed', 'cancelled']),
      createdAt: z.string(),
    })
    .optional(),
  isComposeChild: z.boolean().optional(),
});

export const ProjectTopologyResponseSchema = z.object({
  services: z.array(ServiceNodeSchema),
  aggregate_status: z.enum(['running', 'degraded', 'error']).optional(),
});

// Compile-time parity assertion
type _ServiceNodeParity =
  z.infer<typeof ServiceNodeSchema> extends ServiceNode
    ? ServiceNode extends z.infer<typeof ServiceNodeSchema>
      ? true
      : never
    : never;
const _serviceNodeCheck: _ServiceNodeParity = true;
void _serviceNodeCheck;
