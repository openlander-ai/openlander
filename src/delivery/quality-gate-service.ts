import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, rm, stat } from 'node:fs/promises';
import { basename } from 'node:path';

import type { Database } from '../db/index.js';
import type { Docker } from '../pipeline/docker.js';
import {
  DeliveryAgentRunConflictError,
  DeliveryAgentRunStateError,
  DeliveryManifestMismatchError,
  DeliveryQualityRunnerUnavailableError,
} from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';
import { cloneRepo } from '../pipeline/git.js';
import type { DeliveryService } from './delivery-service.js';
import type { DeliveryAgentRunService } from './agent-run-service.js';
import {
  deliveryManifestSha256,
  parseDeliveryManifest,
  resolveManifestReportPath,
  type DeliveryManifestCheck,
} from './manifest.js';
import { MAX_ARTIFACT_BYTES } from './types.js';

const log = createModuleLogger('delivery-quality-gate');

interface QualityCheckResult {
  check_key: string;
  gate_key: string;
  attempt: number;
  status: 'passed' | 'failed';
  exit_code: number;
  duration_ms: number;
  log_sha256: string;
  report_artifact_id: string | null;
}

export interface QualityGateExecutionResult {
  status: 'passed' | 'failed';
  project_id: string;
  delivery_id: string;
  run_id: string;
  checks: QualityCheckResult[];
  failed_checks: string[];
}

function redactQualityLog(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*)(?:bearer\s+)?[^\s]+/gi, '$1[REDACTED]')
    .replace(/\b(?:gh[opusr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]');
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function reportMimeType(check: DeliveryManifestCheck): string | null {
  if (!check.report) return null;
  if (check.report.format === 'junit') return 'application/junit+xml';
  if (check.report.path.toLowerCase().endsWith('.html')) return 'text/html';
  return 'application/json';
}

function imageDigest(info: { Id: string; RepoDigests?: string[] }): {
  digest: string;
  immutableReference: string;
} {
  const repoDigest = info.RepoDigests?.find((entry) => entry.includes('@sha256:'));
  if (repoDigest) {
    return {
      digest: repoDigest.slice(repoDigest.indexOf('@') + 1),
      immutableReference: repoDigest,
    };
  }
  return { digest: info.Id, immutableReference: info.Id };
}

export class DeliveryQualityGateService {
  private readonly activeRuns = new Map<string, Promise<QualityGateExecutionResult>>();

  constructor(
    private readonly db: Database,
    private readonly deliveryService: DeliveryService,
    private readonly agentRunService: DeliveryAgentRunService,
    private readonly docker: Docker,
    private readonly cloneRepository: typeof cloneRepo = cloneRepo,
  ) {}

  async start(input: { runId: string; checkKeys?: string[]; actor: string }): Promise<void> {
    if (this.activeRuns.has(input.runId)) {
      const run = await this.db.requireDeliveryAgentRun(input.runId);
      throw new DeliveryAgentRunConflictError(run.delivery_id);
    }
    const run = await this.db.requireDeliveryAgentRun(input.runId);
    if (run.status !== 'running') {
      throw new DeliveryAgentRunStateError(
        run.id,
        'Quality gates require a running Agent Run.',
        run.status,
      );
    }
    const execution = this.execute(input).finally(() => {
      this.activeRuns.delete(input.runId);
    });
    this.activeRuns.set(input.runId, execution);
    void execution.catch((error: unknown) => {
      log.error({ err: error, runId: input.runId }, 'Delivery quality-gate execution failed');
    });
  }

  getActive(runId: string): Promise<QualityGateExecutionResult> | undefined {
    return this.activeRuns.get(runId);
  }

  async execute(input: {
    runId: string;
    checkKeys?: string[];
    actor: string;
  }): Promise<QualityGateExecutionResult> {
    const run = await this.db.requireDeliveryAgentRun(input.runId);
    const delivery = await this.db.requireDelivery(run.delivery_id);
    await this.deliveryService.assertDeliveryCanMutate(delivery.id);
    const deployables = await this.db.getDeployablesByGroup(delivery.project_id);
    const sources = deployables.filter(
      (service) => service.source === 'git' && Boolean(service.repo_url),
    );
    const source = sources[0];
    if (sources.length !== 1 || !source?.repo_url) {
      throw new DeliveryQualityRunnerUnavailableError(
        delivery.project_id,
        sources.length === 0 ? 'git_source_missing' : 'multiple_git_sources',
      );
    }
    const clone = await this.cloneRepository({
      repoUrl: source.repo_url,
      branch: source.branch ?? undefined,
      gitCredentialId: source.git_credential_id ?? undefined,
      serviceId: source.id,
    });

    try {
      if (clone.commitSha.toLowerCase() !== run.commit_sha.toLowerCase()) {
        throw new DeliveryManifestMismatchError(run.id, {
          expectedCommitSha: run.commit_sha,
          actualCommitSha: clone.commitSha,
        });
      }
      const manifestPath = resolveManifestReportPath(clone.path, run.manifest_path);
      const manifestBytes = await readFile(manifestPath);
      const actualManifestSha256 = deliveryManifestSha256(manifestBytes);
      if (actualManifestSha256 !== run.manifest_sha256) {
        throw new DeliveryManifestMismatchError(run.id, {
          expectedManifestSha256: run.manifest_sha256,
          actualManifestSha256,
        });
      }
      const manifest = parseDeliveryManifest(manifestBytes.toString('utf8'));
      if (manifest.runner.image !== run.runner_image) {
        throw new DeliveryManifestMismatchError(run.id, {
          expectedRunnerImage: run.runner_image,
          actualRunnerImage: manifest.runner.image,
        });
      }
      const gates = await this.db.listDeliveryGates(delivery.id);
      const gateByKey = new Map(gates.map((gate) => [gate.gate_key, gate]));
      for (const check of manifest.checks) {
        const gate = gateByKey.get(check.gate);
        if (!gate || gate.source !== 'manifest') {
          throw new DeliveryManifestMismatchError(run.id, {
            checkKey: check.key,
            missingManifestGate: check.gate,
          });
        }
      }
      const selected = input.checkKeys?.length
        ? manifest.checks.filter((check) => input.checkKeys?.includes(check.key))
        : manifest.checks;
      const unknownCheckKeys = (input.checkKeys ?? []).filter(
        (key) => !manifest.checks.some((check) => check.key === key),
      );
      if (unknownCheckKeys.length > 0 || selected.length === 0) {
        throw new DeliveryManifestMismatchError(run.id, { unknownCheckKeys });
      }

      await this.docker.pullImage(manifest.runner.image);
      const inspected = await this.docker.inspectImage(manifest.runner.image);
      const resolvedImage = imageDigest(inspected);
      if (run.runner_image_digest && run.runner_image_digest !== resolvedImage.digest) {
        throw new DeliveryManifestMismatchError(run.id, {
          expectedRunnerImageDigest: run.runner_image_digest,
          actualRunnerImageDigest: resolvedImage.digest,
        });
      }
      if (!run.runner_image_digest) {
        await this.db.setDeliveryAgentRunRunnerDigest(run.id, resolvedImage.digest);
      }

      const results: QualityCheckResult[] = [];
      for (const check of selected) {
        const gate = gateByKey.get(check.gate);
        if (!gate) continue;
        const checkRow = await this.db.startDeliveryRunCheck({
          runId: run.id,
          gateId: gate.id,
          checkKey: check.key,
          command: check.command,
          runnerImageDigest: resolvedImage.digest,
        });
        let exitCode = 1;
        let durationMs = 0;
        let redactedLog = '';
        let timedOut = false;
        try {
          const executed = await this.docker.runEphemeralContainer({
            imageTag: resolvedImage.immutableReference,
            name: `ol-quality-${run.id.slice(-12)}-${check.key}-${String(checkRow.attempt)}`,
            projectId: delivery.project_id,
            workspacePath: clone.path,
            command: check.command,
            timeoutMs: (check.timeout_seconds ?? manifest.runner.timeout_seconds) * 1_000,
          });
          exitCode = executed.exitCode;
          durationMs = executed.durationMs;
          timedOut = executed.timedOut;
          redactedLog = redactQualityLog(executed.logs);
        } catch (error) {
          redactedLog = redactQualityLog(error instanceof Error ? error.message : String(error));
        }

        let reportArtifactId: string | null = null;
        let reportMissing = false;
        if (check.report) {
          const reportPath = resolveManifestReportPath(clone.path, check.report.path);
          let reportStat: Awaited<ReturnType<typeof stat>> | null = null;
          try {
            reportStat = await stat(reportPath);
          } catch (error) {
            const code =
              error && typeof error === 'object' && 'code' in error ? error.code : undefined;
            if (code !== 'ENOENT') throw error;
          }
          if (!reportStat?.isFile() || reportStat.size > MAX_ARTIFACT_BYTES) {
            reportMissing = true;
          } else {
            const artifact = await this.deliveryService.uploadArtifact({
              deliveryId: delivery.id,
              source: createReadStream(reportPath),
              filename: basename(reportPath),
              declaredMimeType: reportMimeType(check),
              logicalKey: `agent-run-${run.id}-${check.key}`,
              revision: checkRow.attempt,
              kind: 'qa_report',
              includeInReceipt: true,
              idempotencyKey: `agent-run:${run.id}:${check.key}:${String(checkRow.attempt)}`,
              actor: input.actor,
            });
            reportArtifactId = artifact.id;
          }
        }
        const passed = exitCode === 0 && !timedOut && !reportMissing;
        const finished = await this.db.finishDeliveryRunCheck({
          checkId: checkRow.id,
          status: passed ? 'passed' : 'failed',
          exitCode,
          durationMs,
          logSha256: sha256Text(redactedLog),
          reportArtifactId,
          details: {
            timed_out: timedOut,
            report_path: check.report?.path ?? null,
            report_format: check.report?.format ?? null,
            report_missing: reportMissing,
          },
        });
        results.push({
          check_key: check.key,
          gate_key: check.gate,
          attempt: finished.attempt,
          status: passed ? 'passed' : 'failed',
          exit_code: exitCode,
          duration_ms: durationMs,
          log_sha256: finished.log_sha256 ?? sha256Text(redactedLog),
          report_artifact_id: reportArtifactId,
        });
      }

      const allChecks = await this.db.listDeliveryRunChecks(run.id);
      const latestByKey = new Map<string, (typeof allChecks)[number]>();
      for (const check of allChecks) {
        const current = latestByKey.get(check.check_key);
        if (!current || current.attempt < check.attempt) latestByKey.set(check.check_key, check);
      }
      for (const gate of gates.filter((candidate) => candidate.source === 'manifest')) {
        const gateChecks = manifest.checks.filter((check) => check.gate === gate.gate_key);
        const latest = gateChecks.map((check) => latestByKey.get(check.key));
        const status = latest.some((check) => check?.status === 'failed')
          ? 'failed'
          : latest.every((check) => check?.status === 'passed')
            ? 'passed'
            : 'pending';
        const reportArtifactId = latest.find(
          (check) => check?.report_artifact_id,
        )?.report_artifact_id;
        await this.deliveryService.recordGateResult({
          deliveryId: delivery.id,
          gateKey: gate.gate_key,
          status,
          summary: `${String(latest.filter(Boolean).length)}/${String(gateChecks.length)} latest checks recorded.`,
          reportArtifactId,
          idempotencyKey: `agent-run:${run.id}:${gate.gate_key}:${latest.map((check) => check?.attempt ?? 0).join('-')}`,
          actor: input.actor,
        });
      }

      const failedChecks = [...latestByKey.values()]
        .filter((check) => check.status === 'failed')
        .map((check) => check.check_key);
      if (failedChecks.length > 0) {
        await this.agentRunService.fail({
          runId: run.id,
          summary: `Quality gates failed: ${failedChecks.join(', ')}`,
          actor: input.actor,
        });
      } else {
        await this.agentRunService.recordProgress({
          runId: run.id,
          phase: 'quality_gates_passed',
          summary: 'All manifest quality checks passed.',
          detail: { checks: [...latestByKey.keys()] },
          actor: input.actor,
        });
      }
      return {
        status: failedChecks.length > 0 ? 'failed' : 'passed',
        project_id: delivery.project_id,
        delivery_id: delivery.id,
        run_id: run.id,
        checks: results,
        failed_checks: failedChecks,
      };
    } catch (error) {
      const current = await this.db.requireDeliveryAgentRun(run.id);
      if (current.status === 'running') {
        await this.agentRunService.fail({
          runId: run.id,
          summary: error instanceof Error ? error.message : 'Quality-gate execution failed.',
          actor: input.actor,
        });
      }
      throw error;
    } finally {
      await rm(clone.path, { recursive: true, force: true });
    }
  }
}
