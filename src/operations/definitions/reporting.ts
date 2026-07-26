import { z } from 'zod';

import { ApplicationOperationContractError } from '../../errors.js';
import type { ApplicationOperationDefinition } from '../types.js';

function requireOperationId(name: string, operationId: string | null): void {
  if (!operationId) {
    throw new ApplicationOperationContractError(name, { reason: 'missing_command_operation_id' });
  }
}

const compactReport = z.object({
  id: z.string(),
  engagement_id: z.string(),
  period_start: z.string(),
  period_end: z.string(),
  revision: z.number().int().positive(),
  status: z.enum(['draft', 'published']),
  evidence_sha256: z.string(),
  internal_html_blob_id: z.string().nullable(),
  internal_pdf_blob_id: z.string().nullable(),
  customer_html_blob_id: z.string().nullable(),
  customer_pdf_blob_id: z.string().nullable(),
  internal_sha256: z.string().nullable(),
  customer_sha256: z.string().nullable(),
  published_at: z.string().nullable(),
});

function reportView(report: Record<string, unknown>) {
  return {
    id: report['id'],
    engagement_id: report['engagement_id'],
    period_start: report['period_start'],
    period_end: report['period_end'],
    revision: report['revision'],
    status: report['status'],
    evidence_sha256: report['evidence_sha256'],
    internal_html_blob_id: report['internal_html_blob_id'],
    internal_pdf_blob_id: report['internal_pdf_blob_id'],
    customer_html_blob_id: report['customer_html_blob_id'],
    customer_pdf_blob_id: report['customer_pdf_blob_id'],
    internal_sha256: report['internal_sha256'],
    customer_sha256: report['customer_sha256'],
    published_at: report['published_at'],
  };
}

export const generateWeeklyReportOperation: ApplicationOperationDefinition = {
  name: 'generate_weekly_report',
  version: 1,
  description: 'Capture an immutable weekly evidence snapshot for one Engagement.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org'],
  inputSchema: z
    .object({
      engagement_id: z.string().min(1),
      period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
    .strict(),
  outputSchema: z
    .object({
      status: z.literal('draft'),
      report: compactReport,
      suggested_call: z.object({
        operation: z.literal('publish_weekly_report'),
        input: z.object({ report_id: z.string() }),
      }),
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    requireOperationId('generate_weekly_report', context.operationId);
    const report = await context.appCtx.weeklyReportService.generate({
      engagementId: String(input['engagement_id']),
      periodStart: String(input['period_start']),
      periodEnd: String(input['period_end']),
      actor: context.actor.label,
    });
    return {
      status: 'draft',
      report: reportView(report),
      suggested_call: {
        operation: 'publish_weekly_report',
        input: { report_id: report.id },
      },
      _agent_guidance: {
        message: 'The evidence snapshot is frozen; publish both report views from this revision.',
        next_steps: ['Publish the weekly report.', 'Create a new revision if evidence changes.'],
      },
    };
  },
};

export const publishWeeklyReportOperation: ApplicationOperationDefinition = {
  name: 'publish_weekly_report',
  version: 1,
  description: 'Publish internal and customer HTML/PDF views from the same frozen snapshot.',
  kind: 'command',
  execution: 'sync',
  idempotency: 'required',
  allowedScopes: ['instance', 'org'],
  inputSchema: z.object({ report_id: z.string().min(1) }).strict(),
  outputSchema: z
    .object({
      status: z.literal('published'),
      report: compactReport,
      _agent_guidance: z.object({ message: z.string(), next_steps: z.array(z.string()).max(3) }),
    })
    .strict(),
  activity: { recordsActivity: true, recordsEvidence: true },
  execute: async (input, context) => {
    requireOperationId('publish_weekly_report', context.operationId);
    const report = await context.appCtx.weeklyReportService.publish(String(input['report_id']));
    return {
      status: 'published',
      report: reportView(report),
      _agent_guidance: {
        message: 'Both views were rendered from the same immutable evidence snapshot.',
        next_steps: ['Share the customer PDF.', 'Use the internal PDF for the FDE handoff.'],
      },
    };
  },
};

export const getWeeklyReportOperation: ApplicationOperationDefinition = {
  name: 'get_weekly_report',
  version: 1,
  description: 'Read compact weekly report publication and artifact identifiers.',
  kind: 'query',
  execution: 'sync',
  idempotency: 'none',
  allowedScopes: ['instance', 'org'],
  inputSchema: z.object({ report_id: z.string().min(1) }).strict(),
  outputSchema: z.object({ status: z.literal('ok'), report: compactReport }).strict(),
  activity: { recordsActivity: false, recordsEvidence: false },
  execute: async (input, context) => ({
    status: 'ok',
    report: reportView(await context.appCtx.weeklyReportService.get(String(input['report_id']))),
  }),
};

export const reportingOperations = [
  generateWeeklyReportOperation,
  publishWeeklyReportOperation,
  getWeeklyReportOperation,
] as const;
