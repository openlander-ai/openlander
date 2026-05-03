import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { nanoid } from 'nanoid';

import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import type { AgentPool } from '../llm/agent-pool.js';
import type { DeployPipeline } from '../pipeline/deploy.js';
import { createModuleLogger } from '../lib/logger.js';
import {
  CircuitBreakerOpenError,
  ProjectArchivedError,
  ProjectRecoveringError,
} from '../errors.js';

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

interface EnvironmentBranchTarget {
  id: string;
  type: 'production' | 'development';
  branch: string | null;
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

/**
 * Map a pipeline mutation-policy error to a graceful "skipped" webhook result.
 *
 * Returns `null` for non-policy errors so the caller can rethrow / log.
 * Push events MUST NOT crash a webhook just because the project is archived,
 * recovering, or under an open circuit breaker — those are operator-set states
 * and the push itself is still a valid event.
 *
 * Day 9 F5: also returns the structured `reason` so the caller can emit a
 * `webhook:skipped` activity event.
 */
function mapPolicySkip(
  err: unknown,
  projectId: string,
): { result: WebhookResult; reason: 'archived' | 'recovering' | 'circuit_broken' } | null {
  if (err instanceof ProjectArchivedError) {
    return {
      result: {
        accepted: true,
        projectId,
        message: 'Project is archived; webhook redeploy skipped.',
      },
      reason: 'archived',
    };
  }
  if (err instanceof ProjectRecoveringError) {
    return {
      result: {
        accepted: true,
        projectId,
        message: 'Project is recovering; webhook redeploy skipped.',
      },
      reason: 'recovering',
    };
  }
  if (err instanceof CircuitBreakerOpenError) {
    return {
      result: {
        accepted: true,
        projectId,
        message: 'Circuit breaker open; webhook redeploy skipped.',
      },
      reason: 'circuit_broken',
    };
  }
  return null;
}

export class WebhookManager {
  constructor(
    private readonly pipeline: DeployPipeline,
    private readonly db: Database,
    // Day 8 Bug #4: webhook no longer emits deploy:start (the pipeline owns
    // that emit). Day 9 F5: webhook does emit `webhook:skipped` when policy
    // gracefully refuses the redeploy so operators see the push event in the
    // activity feed instead of "I pushed but nothing happened".
    private readonly events: EventBus,
    // 1.0 GA: optional agent pool so webhook redeploys go through the same
    // per-project lock as UI / agent / MCP triggers. Without this, a webhook
    // push during an in-flight UI redeploy bypassed the in-memory lock and
    // raced through to the DB-level `withDeployLock` (which would silently
    // skip without a typed 409). Optional so existing tests can keep
    // instantiating without the dependency.
    private readonly agentPool?: AgentPool,
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

    const project = await this.db.getProject(projectId);
    if (!project) {
      return { accepted: false, projectId, message: 'Project not found.' };
    }

    const config = await this.db.getWebhookConfig(projectId, source);
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
      const deployable = await this.db.getDeployableForProject(projectId);
      const result = await this.pipeline.deployPreview({
        parentProjectId: projectId,
        previewName,
        repoUrl: prEvent.repoUrl || deployable?.repo_url || '',
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

    const targetEnvironment = await this.resolvePushEnvironment(projectId, parsed.branch);
    if (!targetEnvironment) {
      const expectedBranch = config.branch_filter || 'main';
      if (parsed.branch !== expectedBranch) {
        return {
          accepted: false,
          projectId,
          message: `Ignored push to '${parsed.branch}' (filter '${expectedBranch}').`,
        };
      }
    }

    // Day 8 Bug #4: Do NOT emit `deploy:start` from the webhook — the
    // pipeline (redeploy / deployEnvironment) emits it itself, AFTER the
    // mutation policy clears. Emitting here pre-policy caused stale
    // active-project state in `questionBridge` and false "started" entries
    // in the activity feed whenever the policy short-circuited (archived /
    // recovering / circuit-open).
    if (targetEnvironment) {
      // 1.0 GA: same per-project lock as the redeploy branch below, so a
      // webhook environment deploy that races with another mutation is
      // rejected at the in-memory boundary with a typed `webhook:skipped`.
      const envLockSessionId = `webhook-env-${source}-${projectId}-${nanoid(6)}`;
      const envLockAcquired = this.agentPool
        ? this.agentPool.acquireProjectLock(projectId, envLockSessionId)
        : true;
      if (!envLockAcquired) {
        const lock = this.agentPool?.getProjectLock(projectId);
        const message = `Project is busy (held by ${lock?.sessionId ?? 'another session'}); webhook environment deploy queued/skipped.`;
        await this.emitWebhookSkipped(projectId, 'recovering', source, message);
        return {
          accepted: true,
          projectId,
          message,
        };
      }
      try {
        const deployResult = await this.pipeline.deployEnvironment(
          projectId,
          targetEnvironment.id,
          { trigger: 'webhook' },
        );
        if (!deployResult.success) {
          return {
            accepted: false,
            projectId,
            message: deployResult.error ?? 'Environment deploy failed.',
          };
        }

        return {
          accepted: true,
          projectId,
          message: `Deploy triggered for ${targetEnvironment.type} environment (${parsed.branch}@${parsed.commitSha}).`,
        };
      } catch (err) {
        const skip = mapPolicySkip(err, projectId);
        if (skip) {
          await this.emitWebhookSkipped(projectId, skip.reason, source, skip.result.message);
          return skip.result;
        }
        throw err;
      } finally {
        if (this.agentPool) {
          this.agentPool.releaseProjectLock(projectId, envLockSessionId);
        }
      }
    }

    // 1.0 GA: take the per-project lock so a webhook push during an in-flight
    // UI / agent / MCP redeploy is rejected at the in-memory boundary instead
    // of silently colliding at the DB layer. Without an agent pool (legacy
    // tests, headless mode) we fall through unchanged.
    const lockSessionId = `webhook-${source}-${projectId}-${nanoid(6)}`;
    const lockAcquired = this.agentPool
      ? this.agentPool.acquireProjectLock(projectId, lockSessionId)
      : true;
    if (!lockAcquired) {
      const lock = this.agentPool?.getProjectLock(projectId);
      const message = `Project is busy (held by ${lock?.sessionId ?? 'another session'}); webhook redeploy queued/skipped.`;
      await this.emitWebhookSkipped(projectId, 'recovering', source, message);
      return {
        accepted: true,
        projectId,
        message,
      };
    }

    try {
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
    } catch (err) {
      const skip = mapPolicySkip(err, projectId);
      if (skip) {
        await this.emitWebhookSkipped(projectId, skip.reason, source, skip.result.message);
        return skip.result;
      }
      throw err;
    } finally {
      if (this.agentPool) {
        this.agentPool.releaseProjectLock(projectId, lockSessionId);
      }
    }
  }

  /**
   * Day 9 F5: emit `webhook:skipped` so the activity feed surfaces the
   * silently-refused webhook. Without this, operators see "I pushed but
   * nothing happened" with zero trace.
   */
  private async emitWebhookSkipped(
    projectId: string,
    reason: 'archived' | 'recovering' | 'circuit_broken',
    source: WebhookSource,
    message?: string,
  ): Promise<void> {
    try {
      await this.events.emit('webhook:skipped', {
        projectId,
        reason,
        source,
        ...(message ? { message } : {}),
      });
    } catch (err) {
      log.warn(
        { err, projectId, reason, source },
        'Failed to emit webhook:skipped event (non-fatal)',
      );
    }
  }

  private async resolvePushEnvironment(
    projectId: string,
    branch: string,
  ): Promise<EnvironmentBranchTarget | null> {
    const environments = (await this.db.getEnvironmentsByProject(projectId)).map((environment) => ({
      id: environment.id,
      type: environment.type,
      branch: environment.branch,
    }));

    const branchMatches = environments.filter((environment) => environment.branch === branch);
    if (branchMatches.length === 0) {
      return null;
    }

    if (branch === 'main') {
      const production = branchMatches.find((environment) => environment.type === 'production');
      if (production) {
        return production;
      }
    }

    const development = branchMatches.find((environment) => environment.type === 'development');
    if (development) {
      return development;
    }

    return branchMatches[0] ?? null;
  }

  private async cleanupPreview(parentProjectId: string, prNumber: number): Promise<void> {
    const previews = await this.db.getPreviewProjects(parentProjectId);
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
  } catch (err) {
    log.debug({ err }, 'Failed to parse webhook payload');
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
