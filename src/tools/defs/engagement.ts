import { z } from 'zod';
import type { ToolDef } from './types.js';

const engagementStatus = z.enum(['active', 'on_hold', 'completed', 'archived']);

export const engagementToolDefs: ToolDef[] = [
  {
    name: 'list_engagements',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'List internal FDE Engagement portfolio summaries across Projects. Requires an instance/org-scoped MCP token.',
    inputSchema: z.object({
      include_archived: z.boolean().optional().describe('Include archived Engagements'),
      status: engagementStatus.optional().describe('Optional Engagement status filter'),
    }),
    execute: async (args, context) => {
      const status =
        typeof args['status'] === 'string'
          ? (args['status'] as 'active' | 'on_hold' | 'completed' | 'archived')
          : undefined;
      const engagements = await context.appCtx.engagementService.list({
        includeArchived: args['include_archived'] === true || status === 'archived',
        status,
      });
      return {
        status: 'ok',
        count: engagements.length,
        engagements: engagements.map((engagement) => ({
          engagement_id: engagement.id,
          customer_name: engagement.customer_name,
          title: engagement.title,
          engagement_status: engagement.status,
          runtime_health: engagement.runtime_health,
          project_count: engagement.project_count,
          delivery_count: engagement.delivery_summary.total,
          delivery_status_counts: engagement.delivery_summary.by_status,
          blocker_count: engagement.blocker_count,
          recent_activity_at: engagement.recent_activity_at,
        })),
        _agent_guidance: {
          message:
            'Use get_engagement for one portfolio item. Use existing Delivery actions for evidence and Receipt details.',
        },
      };
    },
  },
  {
    name: 'get_engagement',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'Read one internal FDE Engagement summary with linked Project health, Delivery progress, and blockers. Requires an instance/org-scoped MCP token.',
    inputSchema: z.object({
      engagement_id: z.string().min(1).describe('Engagement id'),
    }),
    execute: async (args, context) => {
      const engagement = await context.appCtx.engagementService.get(String(args['engagement_id']));
      return {
        status: 'ok',
        engagement_id: engagement.id,
        summary: {
          customer_name: engagement.customer_name,
          title: engagement.title,
          engagement_status: engagement.status,
          runtime_health: engagement.runtime_health,
          project_count: engagement.project_count,
          delivery_count: engagement.delivery_summary.total,
          delivery_status_counts: engagement.delivery_summary.by_status,
          blocker_delivery_count: engagement.delivery_summary.blocker_count,
          blocker_count: engagement.blocker_count,
          recent_activity_at: engagement.recent_activity_at,
        },
        projects: engagement.projects.map((project) => ({
          project_id: project.id,
          name: project.name,
          runtime_status: project.runtime_status,
          delivery_count: project.delivery_count,
          blocker_count: project.blocker_count,
        })),
        blockers: engagement.blockers.map((blocker) => ({
          kind: blocker.kind,
          project_id: blocker.project_id,
          delivery_id: blocker.delivery_id,
          resource_id: blocker.resource_id,
          title: blocker.title,
        })),
        _agent_guidance: {
          message:
            'Engagement is a read-only portfolio view. Retrieve artifacts, Gate evidence, and Receipt metadata through existing Delivery actions.',
          next_steps:
            engagement.blocker_count > 0
              ? ['Inspect blockers with get_delivery or diagnose_service using the returned IDs.']
              : [],
        },
      };
    },
  },
];
