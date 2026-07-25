import Busboy from 'busboy';
import { Readable } from 'node:stream';
import { Hono, type Context } from 'hono';
import { stream } from 'hono/streaming';
import { z } from 'zod';
import type { AppContext } from '../../app.js';
import type { McpTokenIdentity } from '../../auth/auth-service.js';
import type { StoredArtifact } from '../../delivery/artifact-store.js';
import { MAX_ARTIFACT_BYTES } from '../../delivery/types.js';
import {
  ArtifactValidationError,
  DeliveryIdempotencyError,
  DeliveryNotFoundError,
  DeliveryScopeError,
  OpenLanderError,
} from '../../errors.js';

const deliveryTypeSchema = z.enum(['software_release', 'artifact_delivery']);
const maturitySchema = z.enum([
  'concept',
  'functional_preview',
  'customer_review',
  'release_candidate',
  'production',
]);
const statusSchema = z.enum([
  'draft',
  'in_review',
  'revision_requested',
  'approved',
  'ready',
  'delivered',
  'cancelled',
]);
const artifactKindSchema = z.enum([
  'review_html',
  'companion_pdf',
  'markdown',
  'qa_report',
  'data_report',
  'image',
  'other',
]);
const feedbackTypeSchema = z.enum(['slack', 'teams', 'email', 'meeting', 'other']);
const workItemKindSchema = z.enum(['decision', 'change_request', 'question', 'note']);
const workItemStatusSchema = z.enum([
  'proposed',
  'confirmed',
  'rejected',
  'resolved',
  'superseded',
]);
const gateStatusSchema = z.enum(['pending', 'passed', 'warning', 'failed', 'waived']);
const gateTypeSchema = z.enum(['review', 'qa', 'data', 'custom']);

function parseJson<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new ArtifactValidationError('Request body is invalid.', {
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

async function json(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new ArtifactValidationError('A valid JSON request body is required.');
  }
}

function isProjectPat(c: Context): boolean {
  return c.get('authKind') === 'project_pat';
}

function isAdminSession(c: Context): boolean {
  return c.get('authKind') === 'session';
}

function actor(c: Context): string {
  const identity = c.get('deliveryPatIdentity') as McpTokenIdentity | undefined;
  return identity ? `pat:${identity.tokenId ?? identity.name}` : 'admin';
}

function requireIdempotencyKey(c: Context): string | null {
  const key = c.req.header('idempotency-key')?.trim() || null;
  if (isProjectPat(c) && !key) throw new DeliveryIdempotencyError();
  return key;
}

async function assertDeliveryProject(
  ctx: AppContext,
  c: Context,
  projectId: string,
  deliveryId: string,
): Promise<void> {
  const delivery = await ctx.db.getDelivery(deliveryId);
  if (!delivery) {
    if (isProjectPat(c)) throw new DeliveryScopeError();
    throw new DeliveryNotFoundError(deliveryId);
  }
  if (delivery.project_id !== projectId) {
    if (isProjectPat(c)) throw new DeliveryScopeError();
    throw new DeliveryNotFoundError(deliveryId);
  }
}

interface ParsedMultipartUpload {
  fields: Record<string, string>;
  filename: string;
  mimeType: string;
  stored: StoredArtifact;
}

async function parseMultipartUpload(
  ctx: AppContext,
  request: Request,
): Promise<ParsedMultipartUpload> {
  if (!request.body) throw new ArtifactValidationError('Multipart upload body is required.');
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    throw new ArtifactValidationError('Content-Type must be multipart/form-data.');
  }

  return await new Promise<ParsedMultipartUpload>((resolve, reject) => {
    const fields: Record<string, string> = {};
    let filename = '';
    let mimeType = '';
    let storePromise: Promise<StoredArtifact> | null = null;
    let fileCount = 0;
    const parser = Busboy({
      headers: Object.fromEntries(request.headers.entries()),
      // Browsers and Node's FormData send UTF-8 bytes in the legacy filename
      // parameter. Busboy defaults that parameter to latin1, which turns
      // Korean filenames into mojibake before they reach the artifact store.
      defParamCharset: 'utf8',
      limits: {
        files: 1,
        fields: 20,
        fieldSize: 64 * 1024,
        // Let ArtifactStore observe one byte above its own limit so it rejects
        // instead of accidentally accepting Busboy's truncated stream.
        fileSize: MAX_ARTIFACT_BYTES + 1,
      },
    });

    parser.on('field', (name, value) => {
      fields[name] = value;
    });
    parser.on('file', (_name, file, info) => {
      fileCount++;
      if (fileCount > 1) {
        file.resume();
        return;
      }
      filename = info.filename;
      mimeType = info.mimeType;
      file.on('limit', () => {
        reject(
          new ArtifactValidationError('Artifact exceeds the configured size limit.', {
            maxBytes: MAX_ARTIFACT_BYTES,
          }),
        );
      });
      storePromise = ctx.artifactStore.store(file, {
        filename,
        declaredMimeType: mimeType,
      });
      void storePromise.catch(() => file.resume());
    });
    parser.on('error', reject);
    parser.on('filesLimit', () => {
      reject(new ArtifactValidationError('Exactly one file is allowed per artifact upload.'));
    });
    parser.on('finish', () => {
      if (!storePromise || !filename) {
        reject(new ArtifactValidationError('Multipart upload must contain one file.'));
        return;
      }
      void storePromise.then((stored) => {
        resolve({ fields, filename, mimeType, stored });
      }, reject);
    });

    const body = Readable.fromWeb(request.body as ReadableStream<Uint8Array>);
    body.on('error', reject);
    body.pipe(parser);
  });
}

function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function parseBooleanField(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

export function createDeliveryRoutes(ctx: AppContext): Hono {
  const api = new Hono();

  api.get('/projects/:projectId/delivery-settings', async (c) => {
    const projectId = c.req.param('projectId');
    const project = await ctx.db.getProject(projectId);
    if (!project) throw new DeliveryNotFoundError(projectId);
    return c.json(await ctx.db.getProjectDeliverySettings(projectId));
  });

  api.put('/projects/:projectId/delivery-settings', async (c) => {
    const projectId = c.req.param('projectId');
    const body = parseJson(
      z.object({
        organization_name: z.string().trim().max(200).nullable().optional(),
        document_name: z.string().trim().min(1).max(200).optional(),
        primary_color: z.string().optional(),
        logo_blob_id: z.string().nullable().optional(),
        footer_text: z.string().trim().max(500).nullable().optional(),
        locale: z.enum(['ko', 'en']).optional(),
        default_gates_json: z.record(z.string(), z.unknown()).optional(),
      }),
      await json(c),
    );
    return c.json(await ctx.deliveryService.updateProjectSettings(projectId, body));
  });

  api.post('/projects/:projectId/delivery-settings/logo', async (c) => {
    const projectId = c.req.param('projectId');
    await ctx.deliveryService.assertProjectCanMutate(projectId);
    const upload = await parseMultipartUpload(ctx, c.req.raw);
    if (upload.stored.mimeType !== 'image/png' && upload.stored.mimeType !== 'image/jpeg') {
      throw new ArtifactValidationError('Receipt logo must be a PNG or JPEG image.');
    }
    const blob = await ctx.db.upsertArtifactBlob(upload.stored);
    const settings = await ctx.deliveryService.updateProjectSettings(projectId, {
      logo_blob_id: blob.id,
    });
    return c.json({ settings, blob }, 201);
  });

  api.get('/projects/:projectId/deliveries', async (c) => {
    return c.json({
      deliveries: await ctx.deliveryService.listDeliveries(c.req.param('projectId')),
    });
  });

  api.post('/projects/:projectId/deliveries', async (c) => {
    const body = parseJson(
      z.object({
        title: z.string().trim().min(1).max(300),
        summary: z.string().max(20_000).optional(),
        delivery_type: deliveryTypeSchema.optional(),
        maturity: maturitySchema.optional(),
        limitations: z.string().max(20_000).nullable().optional(),
        predecessor_delivery_id: z.string().nullable().optional(),
      }),
      await json(c),
    );
    const delivery = await ctx.deliveryService.createDelivery({
      projectId: c.req.param('projectId'),
      title: body.title,
      summary: body.summary,
      deliveryType: body.delivery_type,
      maturity: body.maturity,
      limitations: body.limitations,
      predecessorDeliveryId: body.predecessor_delivery_id,
      actor: actor(c),
    });
    return c.json(delivery, 201);
  });

  api.get('/projects/:projectId/deliveries/:deliveryId', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    return c.json(await ctx.deliveryService.getDeliveryDetail(deliveryId));
  });

  api.patch('/projects/:projectId/deliveries/:deliveryId', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const body = parseJson(
      z.object({
        title: z.string().trim().min(1).max(300).optional(),
        summary: z.string().max(20_000).optional(),
        delivery_type: deliveryTypeSchema.optional(),
        maturity: maturitySchema.optional(),
        limitations: z.string().max(20_000).nullable().optional(),
      }),
      await json(c),
    );
    return c.json(
      await ctx.deliveryService.updateDraft(deliveryId, {
        title: body.title,
        summary: body.summary,
        deliveryType: body.delivery_type,
        maturity: body.maturity,
        limitations: body.limitations,
      }),
    );
  });

  api.post('/projects/:projectId/deliveries/:deliveryId/transition', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const body = parseJson(z.object({ status: statusSchema }), await json(c));
    return c.json(await ctx.deliveryService.transition(deliveryId, body.status));
  });

  api.post('/projects/:projectId/deliveries/:deliveryId/artifacts', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const idempotencyKey = requireIdempotencyKey(c);
    await ctx.deliveryService.assertDeliveryCanMutate(deliveryId);
    const upload = await parseMultipartUpload(ctx, c.req.raw);
    const fields = parseJson(
      z.object({
        logical_key: z.string().trim().min(1).max(200),
        revision: z.coerce.number().int().positive(),
        kind: artifactKindSchema,
        include_in_receipt: z.string().optional(),
        receipt_order: z.coerce.number().int().min(0).optional(),
        companion_for_artifact_id: z.string().optional(),
      }),
      upload.fields,
    );
    const blob = await ctx.db.upsertArtifactBlob(upload.stored);
    const artifact = await ctx.deliveryService.attachStoredArtifact({
      deliveryId,
      blobId: blob.id,
      logicalKey: fields.logical_key,
      revision: fields.revision,
      kind: fields.kind,
      originalFilename: upload.filename,
      includeInReceipt: parseBooleanField(fields.include_in_receipt, true),
      receiptOrder: fields.receipt_order,
      idempotencyKey,
      actor: actor(c),
    });
    if (fields.companion_for_artifact_id) {
      await ctx.deliveryService.linkCompanionPdf(
        deliveryId,
        fields.companion_for_artifact_id,
        artifact.id,
      );
    }
    return c.json({ artifact, blob }, 201);
  });

  api.patch('/projects/:projectId/deliveries/:deliveryId/artifacts/:artifactId', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const body = parseJson(
      z.object({ status: z.enum(['draft', 'approved', 'superseded']) }),
      await json(c),
    );
    return c.json(
      await ctx.deliveryService.setArtifactStatus(
        deliveryId,
        c.req.param('artifactId'),
        body.status,
      ),
    );
  });

  api.get(
    '/projects/:projectId/deliveries/:deliveryId/artifacts/:artifactId/download',
    async (c) => {
      const projectId = c.req.param('projectId');
      const deliveryId = c.req.param('deliveryId');
      await assertDeliveryProject(ctx, c, projectId, deliveryId);
      const { artifact, blob } = await ctx.deliveryService.getArtifactDownload(
        deliveryId,
        c.req.param('artifactId'),
      );
      const inline =
        blob.mime_type !== 'text/html' &&
        (blob.mime_type === 'application/pdf' || blob.mime_type.startsWith('image/')) &&
        c.req.query('download') !== '1';
      c.header('Content-Type', blob.mime_type);
      c.header('Content-Length', String(blob.size_bytes));
      c.header('Content-Disposition', contentDisposition(artifact.original_filename, inline));
      c.header(
        'Content-Security-Policy',
        "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
      );
      c.header('X-Content-Type-Options', 'nosniff');
      return stream(c, async (body) => {
        const artifactStream = ctx.artifactStore.open(
          blob.storage_key,
        ) as AsyncIterable<Uint8Array>;
        for await (const chunk of artifactStream) {
          await body.write(chunk);
        }
      });
    },
  );

  api.post('/projects/:projectId/deliveries/:deliveryId/external-refs', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const body = parseJson(
      z.object({
        provider: z.enum(['slack', 'teams', 'email', 'drive', 'github', 'other']),
        label: z.string().trim().min(1).max(300),
        url: z.string().url(),
      }),
      await json(c),
    );
    return c.json(await ctx.deliveryService.attachExternalUrl({ deliveryId, ...body }), 201);
  });

  api.post('/projects/:projectId/deliveries/:deliveryId/feedback', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const body = parseJson(
      z.object({
        source_type: feedbackTypeSchema,
        source_url: z.string().url().nullable().optional(),
        author_display_name: z.string().trim().max(200).nullable().optional(),
        raw_text: z.string().trim().min(1).max(200_000),
        occurred_at: z.string().datetime().nullable().optional(),
      }),
      await json(c),
    );
    return c.json(
      await ctx.deliveryService.recordFeedback({
        deliveryId,
        sourceType: body.source_type,
        sourceUrl: body.source_url,
        authorDisplayName: body.author_display_name,
        rawText: body.raw_text,
        occurredAt: body.occurred_at,
      }),
      201,
    );
  });

  api.post('/projects/:projectId/deliveries/:deliveryId/work-items/drafts', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const body = parseJson(
      z.object({
        items: z
          .array(
            z.object({
              feedback_source_id: z.string().nullable().optional(),
              kind: workItemKindSchema,
              title: z.string().trim().min(1).max(500),
              detail: z.string().max(20_000).optional(),
            }),
          )
          .min(1)
          .max(100),
      }),
      await json(c),
    );
    return c.json(
      {
        work_items: await ctx.deliveryService.submitWorkItemDrafts(
          deliveryId,
          body.items.map((item) => ({
            feedbackSourceId: item.feedback_source_id,
            kind: item.kind,
            title: item.title,
            detail: item.detail,
          })),
          actor(c),
        ),
      },
      201,
    );
  });

  api.patch('/projects/:projectId/deliveries/:deliveryId/work-items/:workItemId', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const body = parseJson(
      z.object({
        status: workItemStatusSchema,
        resolution: z.string().max(20_000).nullable().optional(),
      }),
      await json(c),
    );
    return c.json(
      await ctx.deliveryService.updateWorkItem(
        deliveryId,
        c.req.param('workItemId'),
        body.status,
        body.resolution,
      ),
    );
  });

  api.post('/projects/:projectId/deliveries/:deliveryId/approvals', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const body = parseJson(
      z.object({
        artifact_ids: z.array(z.string()).min(1),
        approver_display_name: z.string().trim().min(1).max(200),
        approval_excerpt: z.string().trim().min(1).max(20_000),
        source_type: feedbackTypeSchema,
        source_url: z.string().url().nullable().optional(),
        approved_at: z.string().datetime(),
      }),
      await json(c),
    );
    return c.json(
      await ctx.deliveryService.recordApproval({
        deliveryId,
        artifactIds: body.artifact_ids,
        approverDisplayName: body.approver_display_name,
        approvalExcerpt: body.approval_excerpt,
        sourceType: body.source_type,
        sourceUrl: body.source_url,
        approvedAt: body.approved_at,
        actor: actor(c),
      }),
      201,
    );
  });

  api.patch('/projects/:projectId/deliveries/:deliveryId/gates/:gateKey/template', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const body = parseJson(
      z.object({
        required: z.boolean().optional(),
        label: z.string().trim().min(1).max(200).optional(),
        gate_type: gateTypeSchema.optional(),
      }),
      await json(c),
    );
    return c.json(
      await ctx.deliveryService.updateGateTemplate(deliveryId, c.req.param('gateKey'), {
        required: body.required,
        label: body.label,
        gateType: body.gate_type,
      }),
    );
  });

  api.post('/projects/:projectId/deliveries/:deliveryId/gates/:gateKey/result', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const idempotencyKey = requireIdempotencyKey(c);
    const body = parseJson(
      z.object({
        status: gateStatusSchema,
        summary: z.string().max(20_000).nullable().optional(),
        waiver_reason: z.string().max(20_000).nullable().optional(),
        warning_accepted: z.boolean().optional(),
        report_artifact_id: z.string().nullable().optional(),
      }),
      await json(c),
    );
    return c.json(
      await ctx.deliveryService.recordGateResult({
        deliveryId,
        gateKey: c.req.param('gateKey'),
        status: body.status,
        summary: body.summary,
        waiverReason: body.waiver_reason,
        warningAccepted: body.warning_accepted,
        reportArtifactId: body.report_artifact_id,
        idempotencyKey,
        actor: actor(c),
      }),
    );
  });

  api.post('/projects/:projectId/deliveries/:deliveryId/deployments', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const body = parseJson(
      z.object({
        deploy_id: z.string().min(1),
        relation: z.enum(['candidate', 'released', 'rollback']).optional(),
      }),
      await json(c),
    );
    return c.json(
      await ctx.deliveryService.linkDeploy({
        deliveryId,
        deployId: body.deploy_id,
        relation: body.relation,
      }),
      201,
    );
  });

  api.delete('/projects/:projectId/deliveries/:deliveryId/deployments/:deployId', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    return c.json({
      unlinked: await ctx.deliveryService.unlinkDeploy(deliveryId, c.req.param('deployId')),
    });
  });

  api.get('/projects/:projectId/deliveries/:deliveryId/readiness', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    return c.json(await ctx.deliveryService.getReadiness(deliveryId));
  });

  api.post('/projects/:projectId/deliveries/:deliveryId/receipt/preview', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const preview = await ctx.deliveryService.generateReceiptPreview(deliveryId);
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', contentDisposition(`${deliveryId}-receipt-preview.pdf`, true));
    c.header('X-Receipt-Page-Count', String(preview.pageCount));
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return c.body(Buffer.from(preview.bytes));
  });

  api.post('/projects/:projectId/deliveries/:deliveryId/receipt/finalize', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    if (!isAdminSession(c)) {
      throw new OpenLanderError(
        'Receipt finalization requires an authenticated administrator web session.',
        'RECEIPT_FINALIZE_WEB_SESSION_REQUIRED',
        403,
      );
    }
    return c.json(await ctx.deliveryService.finalizeReceipt(deliveryId, 'admin'));
  });

  api.get('/projects/:projectId/deliveries/:deliveryId/receipt/download', async (c) => {
    const projectId = c.req.param('projectId');
    const deliveryId = c.req.param('deliveryId');
    await assertDeliveryProject(ctx, c, projectId, deliveryId);
    const { receipt, blob } = await ctx.deliveryService.getReceiptDownload(deliveryId);
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Length', String(blob.size_bytes));
    c.header(
      'Content-Disposition',
      contentDisposition(`${deliveryId}-receipt-r${String(receipt.revision)}.pdf`, false),
    );
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    return stream(c, async (body) => {
      const receiptStream = ctx.artifactStore.open(blob.storage_key) as AsyncIterable<Uint8Array>;
      for await (const chunk of receiptStream) {
        await body.write(chunk);
      }
    });
  });

  return api;
}
