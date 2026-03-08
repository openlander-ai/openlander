/**
 * Post-Deploy Insight Generator (v0.0.11 — 11-1).
 *
 * After a successful deployment, generates insights about:
 *   1. Health check status (pass / fail with response time)
 *   2. Stale containers (previous image containers still running)
 *   3. Resource usage (memory > 80%)
 *   4. Build time comparison (vs average of previous successful deploys)
 *
 * Insights are returned as structured objects that the NDJSON stream
 * serializes into `insight` timeline items for the frontend.
 */

import type { Docker } from './docker.js';
import type { Database, DeployLogRow } from '../db/index.js';
import { getSystemStats } from '../monitor/stats.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('insight');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ActionButton {
  label: string;
  action: string; // 'cleanup_stale' | 'view_logs' | 'retry_healthcheck'
}

export interface Insight {
  title: string;
  detail?: string;
  severity: 'info' | 'warning' | 'error';
  actions: ActionButton[];
}

interface InsightContext {
  projectId: string;
  totalDurationMs: number;
  url: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long to wait for the first successful health check after deploy. */
const HEALTHCHECK_TIMEOUT_MS = 30_000;
const HEALTHCHECK_POLL_INTERVAL_MS = 2_000;

/** Memory usage threshold that triggers a warning. */
const MEMORY_WARNING_PERCENT = 80;

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate post-deploy insights for a project.
 *
 * Called after `deploy:success`. Each check is independent — a failure in
 * one check does not block the others.
 */
export async function generatePostDeployInsights(
  ctx: InsightContext,
  docker: Docker,
  db: Database,
): Promise<Insight[]> {
  const insights: Insight[] = [];

  // Run all checks concurrently
  const results = await Promise.allSettled([
    checkHealth(ctx, db),
    checkStaleContainers(ctx.projectId, docker, db),
    Promise.resolve(checkResourceUsage()),
    Promise.resolve(checkBuildTime(ctx, db)),
  ]);

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value) {
      if (Array.isArray(result.value)) {
        insights.push(...result.value);
      } else {
        insights.push(result.value);
      }
    } else if (result.status === 'rejected') {
      log.warn({ err: result.reason }, 'Insight check failed');
    }
  }

  // If nothing noteworthy, add a single "all clear" insight
  if (insights.length === 0) {
    insights.push({
      title: '✅ 배포 완료. 이상 없음.',
      severity: 'info',
      actions: [],
    });
  }

  return insights;
}

// ---------------------------------------------------------------------------
// Individual checks
// ---------------------------------------------------------------------------

/**
 * Wait up to 30s for a health check on the project's assigned port.
 * Returns an insight about the health check result.
 */
async function checkHealth(ctx: InsightContext, db: Database): Promise<Insight> {
  const project = db.getProject(ctx.projectId);
  if (!project || project.assigned_port == null) {
    return {
      title: '⚠️ 헬스체크 스킵 — 포트 정보 없음.',
      severity: 'warning',
      actions: [],
    };
  }

  const port = project.assigned_port;
  const deadline = Date.now() + HEALTHCHECK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const start = Date.now();
      const res = await fetch(`http://localhost:${String(port)}/`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      const elapsed = Date.now() - start;

      if (res.ok) {
        return {
          title: `✅ 헬스체크 통과 (응답 ${String(res.status)}, ${String(elapsed)}ms)`,
          severity: 'info',
          actions: [],
        };
      }
    } catch {
      // Not ready yet — retry
    }

    await sleep(HEALTHCHECK_POLL_INTERVAL_MS);
  }

  return {
    title: '⚠️ 헬스체크 아직 미통과. 로그를 확인할까?',
    severity: 'warning',
    actions: [{ label: '로그 보기', action: 'view_logs' }],
  };
}

/**
 * Find containers from previous deployments of the same project
 * that are still running (stale containers).
 */
async function checkStaleContainers(
  projectId: string,
  docker: Docker,
  db: Database,
): Promise<Insight | null> {
  const project = db.getProject(projectId);
  if (!project) return null;

  const currentContainerId = project.container_id;
  if (!currentContainerId) return null;

  try {
    const allContainers = await docker.listManagedContainers();

    // Find containers for the same project that are NOT the current one
    const stale = allContainers.filter((c) => {
      // Match by name prefix (project name) but exclude current container
      const isOld = c.id !== currentContainerId;
      const isSameProject = c.name.startsWith(project.name);
      const isRunning = c.status === 'running';
      return isOld && isSameProject && isRunning;
    });

    if (stale.length === 0) return null;

    const names = stale.map((c) => c.name).join(', ');
    return {
      title: `💡 이전 버전 컨테이너 ${String(stale.length)}개가 있어. 정리할까?`,
      detail: names,
      severity: 'info',
      actions: [{ label: '정리', action: 'cleanup_stale' }],
    };
  } catch (err) {
    log.warn({ err }, 'Failed to check stale containers');
    return null;
  }
}

/**
 * Check system resource usage after deploy.
 * Warns if memory exceeds the configured threshold.
 */
function checkResourceUsage(): Insight | null {
  try {
    const stats = getSystemStats();

    if (stats.memory.usagePercent > MEMORY_WARNING_PERCENT) {
      return {
        title: `⚠️ 메모리 ${String(stats.memory.usagePercent)}% 사용 중.`,
        detail: `${String(stats.memory.usedMB)}MB / ${String(stats.memory.totalMB)}MB`,
        severity: 'warning',
        actions: [],
      };
    }

    return null;
  } catch (err) {
    log.warn({ err }, 'Failed to check resource usage');
    return null;
  }
}

function checkBuildTime(ctx: InsightContext, db: Database): Insight | null {
  try {
    const logs = db.getDeployLogs(ctx.projectId, 10);

    const previousSuccessful = logs.filter(
      (l: DeployLogRow) =>
        l.status === 'success' && l.duration_ms != null && l.duration_ms !== ctx.totalDurationMs,
    );

    if (previousSuccessful.length === 0) return null;

    const totalMs = previousSuccessful.reduce((sum, l) => sum + (l.duration_ms ?? 0), 0);
    const avgMs = totalMs / previousSuccessful.length;

    if (avgMs === 0) return null;

    const ratio = ctx.totalDurationMs / avgMs;
    const percentChange = Math.round((ratio - 1) * 100);

    if (percentChange >= 20) {
      const currentSec = Math.round(ctx.totalDurationMs / 1000);
      const avgSec = Math.round(avgMs / 1000);
      return {
        title: `📊 빌드 시간 ${String(currentSec)}초 — 평균(${String(avgSec)}초)보다 ${String(percentChange)}% 느려졌어.`,
        severity: 'warning',
        actions: [],
      };
    }

    if (percentChange <= -20) {
      return {
        title: '📊 빌드 시간 개선!',
        detail: `평균보다 ${String(Math.abs(percentChange))}% 빨라졌어.`,
        severity: 'info',
        actions: [],
      };
    }

    return null;
  } catch (err) {
    log.warn({ err }, 'Failed to check build time');
    return null;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
