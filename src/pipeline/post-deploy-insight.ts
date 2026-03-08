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

type Locale = 'en' | 'ko';

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
  locale: string = 'en',
): Promise<Insight[]> {
  const insights: Insight[] = [];
  const resolvedLocale: Locale = locale === 'ko' ? 'ko' : 'en';

  // Run all checks concurrently
  const results = await Promise.allSettled([
    checkHealth(ctx, db, resolvedLocale),
    checkStaleContainers(ctx.projectId, docker, db, resolvedLocale),
    Promise.resolve(checkResourceUsage(resolvedLocale)),
    Promise.resolve(checkBuildTime(ctx, db, resolvedLocale)),
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
      title: pickLocale(resolvedLocale, {
        ko: '✅ 배포 완료. 이상 징후가 없습니다.',
        en: '✅ Deploy complete. No issues detected.',
      }),
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
async function checkHealth(ctx: InsightContext, db: Database, locale: Locale): Promise<Insight> {
  const project = db.getProject(ctx.projectId);
  if (!project || project.assigned_port == null) {
    return {
      title: pickLocale(locale, {
        ko: '⚠️ 헬스체크 건너뜀 - 포트 정보가 없습니다.',
        en: '⚠️ Health check skipped - no assigned port found.',
      }),
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
          title: pickLocale(locale, {
            ko: `✅ 헬스체크 통과 (응답 ${String(res.status)}, ${String(elapsed)}ms)`,
            en: `✅ Health check passed (${String(res.status)}, ${String(elapsed)}ms)`,
          }),
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
    title: pickLocale(locale, {
      ko: '⚠️ 헬스체크가 아직 통과하지 않았습니다. 로그 확인이 필요합니다.',
      en: '⚠️ Health check is still failing. Review logs for details.',
    }),
    severity: 'warning',
    actions: [
      {
        label: pickLocale(locale, { ko: '로그 보기', en: 'View logs' }),
        action: 'view_logs',
      },
    ],
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
  locale: Locale,
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
      title: pickLocale(locale, {
        ko: `💡 이전 버전 컨테이너 ${String(stale.length)}개가 실행 중입니다. 정리를 권장합니다.`,
        en: `💡 ${String(stale.length)} stale container(s) from previous versions are still running. Cleanup is recommended.`,
      }),
      detail: names,
      severity: 'info',
      actions: [
        {
          label: pickLocale(locale, { ko: '정리', en: 'Clean up' }),
          action: 'cleanup_stale',
        },
      ],
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
function checkResourceUsage(locale: Locale): Insight | null {
  try {
    const stats = getSystemStats();

    if (stats.memory.usagePercent > MEMORY_WARNING_PERCENT) {
      return {
        title: pickLocale(locale, {
          ko: `⚠️ 메모리 사용률이 ${String(stats.memory.usagePercent)}%입니다.`,
          en: `⚠️ Memory usage is ${String(stats.memory.usagePercent)}%.`,
        }),
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

function checkBuildTime(ctx: InsightContext, db: Database, locale: Locale): Insight | null {
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
        title: pickLocale(locale, {
          ko: `📊 빌드 시간 ${String(currentSec)}초 - 평균(${String(avgSec)}초) 대비 ${String(percentChange)}% 느립니다.`,
          en: `📊 Build took ${String(currentSec)}s - ${String(percentChange)}% slower than average (${String(avgSec)}s).`,
        }),
        severity: 'warning',
        actions: [],
      };
    }

    if (percentChange <= -20) {
      return {
        title: pickLocale(locale, {
          ko: '📊 빌드 시간이 개선되었습니다.',
          en: '📊 Build time improved.',
        }),
        detail: pickLocale(locale, {
          ko: `평균 대비 ${String(Math.abs(percentChange))}% 빨라졌습니다.`,
          en: `${String(Math.abs(percentChange))}% faster than average.`,
        }),
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

function pickLocale(locale: Locale, text: { ko: string; en: string }): string {
  return locale === 'ko' ? text.ko : text.en;
}
