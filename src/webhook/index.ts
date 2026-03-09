import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import type { DeployPipeline } from '../pipeline/deploy.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('webhook');

export interface WebhookResult {
  accepted: boolean;
  projectId?: string;
  message: string;
}

export type WebhookSource = 'github' | 'gitlab' | 'bitbucket';

interface ParsedPushEvent {
  branch: string;
  commitSha: string;
  repoUrl: string;
}

export interface ParsedPREvent {
  action: 'opened' | 'synchronize' | 'closed';
  prNumber: number;
  branch: string;
  baseBranch: string;
  commitSha: string;
  repoUrl: string;
  title: string;
}

const textEncoder = new TextEncoder();

export class WebhookManager {
  constructor(
    private readonly pipeline: DeployPipeline,
    private readonly db: Database,
    private readonly events: EventBus,
  ) {}

  generateSecret(projectId: string): string {
    return `${projectId}.${randomBytes(32).toString('hex')}`;
  }

  verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
    if (!signature || !secret) {
      return false;
    }
    const normalized = normalizeSignature(signature);
    if (!isHex(normalized)) {
      return false;
    }

    const expected = createHmac('sha256', secret).update(payload).digest('hex');
    return safeEqualHex(expected, normalized);
  }

  verifyGitLabToken(token: string, secret: string): boolean {
    return token.length > 0 && token === secret;
  }

  async handleWebhook(
    source: WebhookSource,
    headers: Record<string, string>,
    body: string,
  ): Promise<WebhookResult> {
    const projectId = headers['x-openlander-project-id'];
    if (!projectId) {
      return { accepted: false, message: 'Missing project id.' };
    }

    const project = this.db.getProject(projectId);
    if (!project) {
      return { accepted: false, projectId, message: 'Project not found.' };
    }

    const config = this.db.getWebhookConfig(projectId, source);
    if (!config || config.enabled !== 1) {
      return { accepted: false, projectId, message: 'Webhook config missing or disabled.' };
    }

    const verified = await verifySourceSignature(source, headers, body, config.secret, this);
    if (!verified) {
      return { accepted: false, projectId, message: 'Signature verification failed.' };
    }

    if (isPREvent(source, headers)) {
      const prEvent = parsePRPayload(source, body);
      if (!prEvent) {
        return { accepted: false, projectId, message: 'Invalid PR payload.' };
      }

      if (prEvent.action === 'closed') {
        await this.cleanupPreview(projectId, prEvent.prNumber);
        return {
          accepted: true,
          projectId,
          message: `Preview cleanup for PR #${String(prEvent.prNumber)}.`,
        };
      }

      const previewName = `${project.name}-pr-${String(prEvent.prNumber)}`;
      const result = await this.pipeline.deployPreview({
        parentProjectId: projectId,
        previewName,
        repoUrl: prEvent.repoUrl || project.repo_url || '',
        branch: prEvent.branch,
        prNumber: prEvent.prNumber,
        commitSha: prEvent.commitSha,
      });

      return {
        accepted: result.success,
        projectId,
        message: result.success
          ? `Preview deployed for PR #${String(prEvent.prNumber)} at ${result.url ?? 'N/A'}.`
          : (result.error ?? 'Preview deploy failed.'),
      };
    }

    if (!isPushEvent(source, headers)) {
      return { accepted: false, projectId, message: 'Ignored non-push event.' };
    }

    const parsed = parsePushPayload(source, body);
    if (!parsed) {
      return { accepted: false, projectId, message: 'Invalid push payload.' };
    }

    const expectedBranch = config.branch_filter || 'main';
    if (parsed.branch !== expectedBranch) {
      return {
        accepted: false,
        projectId,
        message: `Ignored push to '${parsed.branch}' (filter '${expectedBranch}').`,
      };
    }

    await this.events.emit('deploy:start', {
      projectId,
      repoUrl: parsed.repoUrl || project.repo_url || '',
    });

    const redeploy = await this.pipeline.redeploy(projectId);
    if (!redeploy.success) {
      return {
        accepted: false,
        projectId,
        message: redeploy.error ?? 'Redeploy failed.',
      };
    }

    return {
      accepted: true,
      projectId,
      message: `Redeploy triggered for ${parsed.branch}@${parsed.commitSha}.`,
    };
  }

  private async cleanupPreview(parentProjectId: string, prNumber: number): Promise<void> {
    const previews = this.db.getPreviewProjects(parentProjectId);
    const target = previews.find((preview) => preview.pr_number === prNumber);
    if (target) {
      await this.pipeline.remove(target.id);
    }
  }
}

function isPushEvent(source: WebhookSource, headers: Record<string, string>): boolean {
  if (source === 'github') {
    return headers['x-github-event'] === 'push';
  }
  if (source === 'gitlab') {
    return headers['x-gitlab-event'] === 'Push Hook';
  }
  return headers['x-event-key'] === 'repo:push';
}

export function isPREvent(source: WebhookSource, headers: Record<string, string>): boolean {
  if (source === 'github') {
    return headers['x-github-event'] === 'pull_request';
  }
  if (source === 'gitlab') {
    return headers['x-gitlab-event'] === 'Merge Request Hook';
  }
  const event = headers['x-event-key'] ?? '';
  return event.startsWith('pullrequest:');
}

async function verifySourceSignature(
  source: WebhookSource,
  headers: Record<string, string>,
  body: string,
  secret: string,
  manager: WebhookManager,
): Promise<boolean> {
  if (source === 'gitlab') {
    return manager.verifyGitLabToken(headers['x-gitlab-token'] ?? '', secret);
  }

  if (source === 'github') {
    const signature = headers['x-hub-signature-256'] ?? '';
    return verifyHmacSha256WebCrypto(body, signature, secret);
  }

  const signature = headers['x-hub-signature'] ?? '';
  return verifyHmacSha256WebCrypto(body, signature, secret);
}

function parsePushPayload(source: WebhookSource, body: string): ParsedPushEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch (err) {
    log.warn({ err }, 'Failed to parse webhook payload JSON');
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const obj = payload as Record<string, unknown>;
  if (source === 'github') {
    return parseGitHubPayload(obj);
  }
  if (source === 'gitlab') {
    return parseGitLabPayload(obj);
  }
  return parseBitbucketPayload(obj);
}

function parsePRPayload(source: WebhookSource, body: string): ParsedPREvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const obj = payload as Record<string, unknown>;
  if (source === 'github') {
    return parseGitHubPRPayload(obj);
  }
  if (source === 'gitlab') {
    return parseGitLabPRPayload(obj);
  }
  return parseBitbucketPRPayload(obj);
}

export function parseGitHubPRPayload(payload: Record<string, unknown>): ParsedPREvent | null {
  const action = getString(payload.action);
  let mappedAction: ParsedPREvent['action'];
  if (action === 'opened' || action === 'reopened') {
    mappedAction = 'opened';
  } else if (action === 'synchronize') {
    mappedAction = 'synchronize';
  } else if (action === 'closed') {
    mappedAction = 'closed';
  } else {
    return null;
  }

  const prNumberValue =
    nestedUnknown(payload, ['pull_request', 'number']) ?? nestedUnknown(payload, ['number']);
  if (typeof prNumberValue !== 'number') {
    return null;
  }
  const prNumber = prNumberValue;

  const branch = nestedString(payload, ['pull_request', 'head', 'ref']);
  const baseBranch = nestedString(payload, ['pull_request', 'base', 'ref']);
  const commitSha = nestedString(payload, ['pull_request', 'head', 'sha']);
  const repoUrl =
    nestedString(payload, ['pull_request', 'head', 'repo', 'clone_url']) ||
    nestedString(payload, ['repository', 'clone_url']);
  const title = nestedString(payload, ['pull_request', 'title']);

  if (!branch || !commitSha) {
    return null;
  }

  return { action: mappedAction, prNumber, branch, baseBranch, commitSha, repoUrl, title };
}

/** @internal */
export function parseGitLabPRPayload(payload: Record<string, unknown>): ParsedPREvent | null {
  const attrs = payload.object_attributes;
  if (!attrs || typeof attrs !== 'object') {
    return null;
  }
  const record = attrs as Record<string, unknown>;

  const action = getString(record.action);
  let mappedAction: ParsedPREvent['action'];
  if (action === 'open' || action === 'reopen') {
    mappedAction = 'opened';
  } else if (action === 'update') {
    mappedAction = 'synchronize';
  } else if (action === 'close' || action === 'merge') {
    mappedAction = 'closed';
  } else {
    return null;
  }

  const prNumber = typeof record.iid === 'number' ? record.iid : null;
  if (prNumber === null) {
    return null;
  }

  const branch = getString(record.source_branch);
  const baseBranch = getString(record.target_branch);
  const commitSha =
    nestedString(record, ['last_commit', 'id']) || getString(record.merge_commit_sha);
  const repoUrl = nestedString(payload, ['project', 'git_http_url']);
  const title = getString(record.title);

  if (!branch || !commitSha) {
    return null;
  }

  return { action: mappedAction, prNumber, branch, baseBranch, commitSha, repoUrl, title };
}

/** @internal */
export function parseBitbucketPRPayload(payload: Record<string, unknown>): ParsedPREvent | null {
  const pr = payload.pullrequest;
  if (!pr || typeof pr !== 'object') {
    return null;
  }
  const record = pr as Record<string, unknown>;

  const state = getString(record.state);
  let mappedAction: ParsedPREvent['action'];
  if (state === 'OPEN') {
    mappedAction = 'opened';
  } else if (state === 'MERGED' || state === 'DECLINED' || state === 'SUPERSEDED') {
    mappedAction = 'closed';
  } else {
    mappedAction = 'synchronize';
  }

  const prNumber = typeof record.id === 'number' ? record.id : null;
  if (prNumber === null) {
    return null;
  }

  const branch = nestedString(record, ['source', 'branch', 'name']);
  const baseBranch = nestedString(record, ['destination', 'branch', 'name']);
  const commitSha = nestedString(record, ['source', 'commit', 'hash']);
  const repoUrl = nestedString(payload, ['repository', 'links', 'html', 'href']);
  const title = getString(record.title);

  if (!branch || !commitSha) {
    return null;
  }

  return { action: mappedAction, prNumber, branch, baseBranch, commitSha, repoUrl, title };
}

function parseGitHubPayload(payload: Record<string, unknown>): ParsedPushEvent | null {
  const branch = branchFromRef(getString(payload.ref));
  const commitSha = getString(payload.after) || nestedString(payload, ['head_commit', 'id']);
  const repoUrl =
    nestedString(payload, ['repository', 'clone_url']) ||
    nestedString(payload, ['repository', 'html_url']) ||
    '';

  if (!branch || !commitSha) {
    return null;
  }
  return { branch, commitSha, repoUrl };
}

function parseGitLabPayload(payload: Record<string, unknown>): ParsedPushEvent | null {
  const branch = branchFromRef(getString(payload.ref));
  const commitSha = getString(payload.checkout_sha) || getString(payload.after);
  const repoUrl =
    nestedString(payload, ['project', 'git_http_url']) ||
    nestedString(payload, ['project', 'web_url']) ||
    nestedString(payload, ['project', 'homepage']) ||
    '';

  if (!branch || !commitSha) {
    return null;
  }
  return { branch, commitSha, repoUrl };
}

function parseBitbucketPayload(payload: Record<string, unknown>): ParsedPushEvent | null {
  const changes = nestedUnknown(payload, ['push', 'changes']);
  if (!Array.isArray(changes)) {
    return null;
  }

  let branch = '';
  let commitSha = '';

  for (const entry of changes) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const record = entry as Record<string, unknown>;
    const maybeBranch = nestedString(record, ['new', 'name']);
    const maybeSha = nestedString(record, ['new', 'target', 'hash']);
    if (maybeBranch && maybeSha) {
      branch = maybeBranch;
      commitSha = maybeSha;
      break;
    }
  }

  const repoUrl =
    nestedString(payload, ['repository', 'links', 'html', 'href']) ||
    bitbucketCloneUrl(payload) ||
    '';

  if (!branch || !commitSha) {
    return null;
  }
  return { branch, commitSha, repoUrl };
}

function bitbucketCloneUrl(payload: Record<string, unknown>): string {
  const links = nestedUnknown(payload, ['repository', 'links', 'clone']);
  if (!Array.isArray(links)) {
    return '';
  }

  for (const link of links) {
    if (!link || typeof link !== 'object') {
      continue;
    }
    const href = nestedString(link as Record<string, unknown>, ['href']);
    if (href) {
      return href;
    }
  }

  return '';
}

function branchFromRef(ref: string): string {
  return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;
}

function getString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function nestedUnknown(obj: Record<string, unknown>, keys: string[]): unknown {
  let current: unknown = obj;
  for (const key of keys) {
    if (!current || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function nestedString(obj: Record<string, unknown>, keys: string[]): string {
  const value = nestedUnknown(obj, keys);
  return typeof value === 'string' ? value : '';
}

async function verifyHmacSha256WebCrypto(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  if (!signature || !secret) {
    return false;
  }

  const normalized = normalizeSignature(signature);
  if (!isHex(normalized)) {
    return false;
  }

  const key = await crypto.subtle.importKey(
    'raw',
    textEncoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, textEncoder.encode(payload));
  const expected = toHex(new Uint8Array(digest));

  return safeEqualHex(expected, normalized);
}

function normalizeSignature(signature: string): string {
  const lowered = signature.trim().toLowerCase();
  if (lowered.startsWith('sha256=')) {
    return lowered.slice('sha256='.length);
  }
  return lowered;
}

function isHex(value: string): boolean {
  return value.length > 0 && value.length % 2 === 0 && /^[a-f0-9]+$/u.test(value);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function safeEqualHex(expectedHex: string, providedHex: string): boolean {
  const expected = Buffer.from(expectedHex, 'hex');
  const provided = Buffer.from(providedHex, 'hex');
  if (expected.length === 0 || provided.length === 0 || expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(expected, provided);
}
