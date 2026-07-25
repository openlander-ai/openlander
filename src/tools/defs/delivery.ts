import { z } from 'zod';
import type { ToolDef } from './types.js';

const projectSelector = {
  project_id: z.string().min(1).describe('Project id'),
} as const;

const deliverySelector = {
  delivery_id: z.string().min(1).describe('Delivery id'),
} as const;

const deliveryType = z.enum(['software_release', 'artifact_delivery']);
const maturity = z.enum([
  'concept',
  'functional_preview',
  'customer_review',
  'release_candidate',
  'production',
]);

export const deliveryToolDefs: ToolDef[] = [
  {
    name: 'create_delivery',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'Create a project Delivery workspace with default Review/QA/Data Gates. This creates evidence workflow metadata only and does not deploy.',
    inputSchema: z.object({
      ...projectSelector,
      title: z.string().min(1).max(300),
      summary: z.string().max(20_000).optional(),
      delivery_type: deliveryType.optional(),
      maturity: maturity.optional(),
      limitations: z.string().max(20_000).nullable().optional(),
      predecessor_delivery_id: z.string().nullable().optional(),
    }),
    execute: async (args, context) => {
      const delivery = await context.appCtx.deliveryService.createDelivery({
        projectId: String(args['project_id']),
        title: String(args['title']),
        summary: typeof args['summary'] === 'string' ? args['summary'] : undefined,
        deliveryType:
          args['delivery_type'] === 'artifact_delivery'
            ? 'artifact_delivery'
            : args['delivery_type'] === 'software_release'
              ? 'software_release'
              : undefined,
        maturity:
          typeof args['maturity'] === 'string'
            ? (args['maturity'] as
                | 'concept'
                | 'functional_preview'
                | 'customer_review'
                | 'release_candidate'
                | 'production')
            : undefined,
        limitations:
          typeof args['limitations'] === 'string' || args['limitations'] === null
            ? args['limitations']
            : undefined,
        predecessorDeliveryId:
          typeof args['predecessor_delivery_id'] === 'string'
            ? args['predecessor_delivery_id']
            : null,
        actor: 'external-mcp-agent',
      });
      return {
        status: 'created',
        project_id: delivery.project_id,
        delivery_id: delivery.id,
        delivery_status: delivery.status,
        suggested_call: {
          tool: 'openlander_project',
          arguments: { action: 'get_delivery', params: { delivery_id: delivery.id } },
        },
        _agent_guidance: {
          message:
            'Delivery created. Upload binaries through the authenticated web/API multipart endpoint, then attach URLs or record feedback here.',
        },
      };
    },
  },
  {
    name: 'list_deliveries',
    riskLevel: 'low',
    targets: ['mcp'],
    description: 'List Deliveries in one Project.',
    inputSchema: z.object(projectSelector),
    execute: async (args, context) => {
      const projectId = String(args['project_id']);
      const deliveries = await context.appCtx.deliveryService.listDeliveries(projectId);
      return {
        status: 'ok',
        project_id: projectId,
        count: deliveries.length,
        deliveries,
      };
    },
  },
  {
    name: 'get_delivery',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'Read a Delivery with artifacts, original feedback, proposed/confirmed work items, Gates, deployments, approvals, and Receipt metadata.',
    inputSchema: z.object(deliverySelector),
    execute: async (args, context) => {
      const detail = await context.appCtx.deliveryService.getDeliveryDetail(
        String(args['delivery_id']),
      );
      return {
        status: 'ok',
        project_id: detail.delivery.project_id,
        delivery_id: detail.delivery.id,
        detail,
      };
    },
  },
  {
    name: 'update_delivery_draft',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'Update editable Delivery metadata. Delivery type can only change while draft; delivered Deliveries are immutable.',
    inputSchema: z.object({
      ...deliverySelector,
      title: z.string().min(1).max(300).optional(),
      summary: z.string().max(20_000).optional(),
      delivery_type: deliveryType.optional(),
      maturity: maturity.optional(),
      limitations: z.string().max(20_000).nullable().optional(),
    }),
    execute: async (args, context) => {
      const delivery = await context.appCtx.deliveryService.updateDraft(
        String(args['delivery_id']),
        {
          title: typeof args['title'] === 'string' ? args['title'] : undefined,
          summary: typeof args['summary'] === 'string' ? args['summary'] : undefined,
          deliveryType:
            args['delivery_type'] === 'software_release' ||
            args['delivery_type'] === 'artifact_delivery'
              ? args['delivery_type']
              : undefined,
          maturity:
            typeof args['maturity'] === 'string'
              ? (args['maturity'] as
                  | 'concept'
                  | 'functional_preview'
                  | 'customer_review'
                  | 'release_candidate'
                  | 'production')
              : undefined,
          limitations:
            typeof args['limitations'] === 'string' || args['limitations'] === null
              ? args['limitations']
              : undefined,
        },
      );
      return {
        status: 'updated',
        project_id: delivery.project_id,
        delivery_id: delivery.id,
        delivery_status: delivery.status,
      };
    },
  },
  {
    name: 'attach_delivery_url',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'Attach a Slack, Teams, email, Drive, GitHub, or other evidence URL as optional metadata. OpenLander never depends on this URL to build a Receipt.',
    inputSchema: z.object({
      ...deliverySelector,
      provider: z.enum(['slack', 'teams', 'email', 'drive', 'github', 'other']),
      label: z.string().min(1).max(300),
      url: z.string().url(),
    }),
    execute: async (args, context) => {
      const ref = await context.appCtx.deliveryService.attachExternalUrl({
        deliveryId: String(args['delivery_id']),
        provider: args['provider'] as 'slack' | 'teams' | 'email' | 'drive' | 'github' | 'other',
        label: String(args['label']),
        url: String(args['url']),
      });
      const delivery = await context.appCtx.db.requireDelivery(ref.delivery_id);
      return {
        status: 'attached',
        project_id: delivery.project_id,
        delivery_id: ref.delivery_id,
        external_ref_id: ref.id,
      };
    },
  },
  {
    name: 'record_delivery_feedback',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'Preserve pasted customer feedback as canonical raw evidence. Source URLs are optional.',
    inputSchema: z.object({
      ...deliverySelector,
      source_type: z.enum(['slack', 'teams', 'email', 'meeting', 'other']),
      source_url: z.string().url().nullable().optional(),
      author_display_name: z.string().max(200).nullable().optional(),
      raw_text: z.string().min(1).max(200_000),
      occurred_at: z.string().datetime().nullable().optional(),
    }),
    execute: async (args, context) => {
      const source = await context.appCtx.deliveryService.recordFeedback({
        deliveryId: String(args['delivery_id']),
        sourceType: args['source_type'] as 'slack' | 'teams' | 'email' | 'meeting' | 'other',
        sourceUrl: typeof args['source_url'] === 'string' ? args['source_url'] : null,
        authorDisplayName:
          typeof args['author_display_name'] === 'string' ? args['author_display_name'] : null,
        rawText: String(args['raw_text']),
        occurredAt: typeof args['occurred_at'] === 'string' ? args['occurred_at'] : null,
      });
      const delivery = await context.appCtx.db.requireDelivery(source.delivery_id);
      return {
        status: 'recorded',
        project_id: delivery.project_id,
        delivery_id: source.delivery_id,
        feedback_source_id: source.id,
      };
    },
  },
  {
    name: 'submit_delivery_work_item_drafts',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'Submit decision, change_request, question, or note drafts for FDE review. MCP drafts are always proposed and never become official automatically.',
    inputSchema: z.object({
      ...deliverySelector,
      items: z
        .array(
          z.object({
            feedback_source_id: z.string().nullable().optional(),
            kind: z.enum(['decision', 'change_request', 'question', 'note']),
            title: z.string().min(1).max(500),
            detail: z.string().max(20_000).optional(),
          }),
        )
        .min(1)
        .max(100),
    }),
    execute: async (args, context) => {
      const deliveryId = String(args['delivery_id']);
      const parsed = args['items'] as Array<{
        feedback_source_id?: string | null;
        kind: 'decision' | 'change_request' | 'question' | 'note';
        title: string;
        detail?: string;
      }>;
      const items = await context.appCtx.deliveryService.submitWorkItemDrafts(
        deliveryId,
        parsed.map((item) => ({
          feedbackSourceId: item.feedback_source_id,
          kind: item.kind,
          title: item.title,
          detail: item.detail,
        })),
      );
      const delivery = await context.appCtx.db.requireDelivery(deliveryId);
      return {
        status: 'proposed',
        project_id: delivery.project_id,
        delivery_id: deliveryId,
        work_item_ids: items.map((item) => item.id),
        _agent_guidance: {
          message:
            'Drafts were saved as proposed. An FDE must confirm or reject them in the web UI before they affect official decisions or Readiness.',
        },
      };
    },
  },
  {
    name: 'record_delivery_gate_result',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'Record an external Review/QA/Data/Custom Gate result and optionally link a previously uploaded report artifact.',
    inputSchema: z.object({
      ...deliverySelector,
      gate_key: z.string().min(1).max(100),
      status: z.enum(['pending', 'passed', 'warning', 'failed', 'waived']),
      summary: z.string().max(20_000).nullable().optional(),
      waiver_reason: z.string().max(20_000).nullable().optional(),
      report_artifact_id: z.string().nullable().optional(),
      idempotency_key: z.string().max(200).nullable().optional(),
    }),
    execute: async (args, context) => {
      const deliveryId = String(args['delivery_id']);
      const gate = await context.appCtx.deliveryService.recordGateResult({
        deliveryId,
        gateKey: String(args['gate_key']),
        status: args['status'] as 'pending' | 'passed' | 'warning' | 'failed' | 'waived',
        summary: typeof args['summary'] === 'string' ? args['summary'] : null,
        waiverReason: typeof args['waiver_reason'] === 'string' ? args['waiver_reason'] : null,
        reportArtifactId:
          typeof args['report_artifact_id'] === 'string' ? args['report_artifact_id'] : null,
        idempotencyKey:
          typeof args['idempotency_key'] === 'string' ? args['idempotency_key'] : null,
        actor: 'external-mcp-agent',
      });
      const delivery = await context.appCtx.db.requireDelivery(deliveryId);
      return {
        status: 'recorded',
        project_id: delivery.project_id,
        delivery_id: deliveryId,
        gate_key: gate.gate_key,
        gate_status: gate.status,
      };
    },
  },
  {
    name: 'link_delivery_deploy',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'Link a successful same-project Production deployment as candidate, released, or rollback evidence.',
    inputSchema: z.object({
      ...deliverySelector,
      deploy_id: z.string().min(1),
      relation: z.enum(['candidate', 'released', 'rollback']).optional(),
    }),
    execute: async (args, context) => {
      const deliveryId = String(args['delivery_id']);
      const link = await context.appCtx.deliveryService.linkDeploy({
        deliveryId,
        deployId: String(args['deploy_id']),
        relation:
          args['relation'] === 'candidate' ||
          args['relation'] === 'released' ||
          args['relation'] === 'rollback'
            ? args['relation']
            : undefined,
      });
      const delivery = await context.appCtx.db.requireDelivery(deliveryId);
      return {
        status: 'linked',
        project_id: delivery.project_id,
        delivery_id: deliveryId,
        deploy_id: link.deploy_id,
        relation: link.relation,
      };
    },
  },
  {
    name: 'get_delivery_readiness',
    riskLevel: 'low',
    targets: ['mcp'],
    description: 'Evaluate deterministic Delivery Receipt Readiness checks.',
    inputSchema: z.object(deliverySelector),
    execute: async (args, context) => {
      const deliveryId = String(args['delivery_id']);
      const [delivery, readiness] = await Promise.all([
        context.appCtx.db.requireDelivery(deliveryId),
        context.appCtx.deliveryService.getReadiness(deliveryId),
      ]);
      return {
        status: readiness.ready ? 'ready' : 'blocked',
        project_id: delivery.project_id,
        delivery_id: deliveryId,
        ...readiness,
      };
    },
  },
  {
    name: 'generate_delivery_receipt_preview',
    riskLevel: 'low',
    targets: ['mcp'],
    description:
      'Validate and generate a Receipt preview in memory. MCP returns metadata only; download and final confirmation remain in the authenticated web UI.',
    inputSchema: z.object(deliverySelector),
    execute: async (args, context) => {
      const deliveryId = String(args['delivery_id']);
      const delivery = await context.appCtx.db.requireDelivery(deliveryId);
      const preview = await context.appCtx.deliveryService.generateReceiptPreview(deliveryId);
      return {
        status: 'preview_generated',
        project_id: delivery.project_id,
        delivery_id: deliveryId,
        page_count: preview.pageCount,
        web_ui_required: true,
        _agent_guidance: {
          message:
            'Receipt preview succeeded. Ask the FDE to review and finalize it in OpenLander; MCP cannot finalize or download local binary files.',
        },
      };
    },
  },
];
