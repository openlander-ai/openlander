import { execSync } from 'node:child_process';
import { createModuleLogger } from '../lib/logger.js';
import { getSystemStats } from '../monitor/stats.js';

const log = createModuleLogger('cleanup');

const DISK_CLEANUP_THRESHOLD_PERCENT = 80;

function parseReclaimedMB(output: string): number {
  const match = output.match(/Total reclaimed space:\s*([0-9.]+)\s*([A-Za-z]+)/i);
  if (!match || !match[1] || !match[2]) {
    return 0;
  }

  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) {
    return 0;
  }

  const unit = match[2].toUpperCase();
  if (unit === 'B') return 0;
  if (unit === 'KB' || unit === 'KIB') return value / 1000;
  if (unit === 'MB' || unit === 'MIB') return value;
  if (unit === 'GB' || unit === 'GIB') return value * 1000;
  if (unit === 'TB' || unit === 'TIB') return value * 1000 * 1000;
  return 0;
}

function parseRemovedCount(output: string): number {
  const deletedMatches = output.match(/^deleted:\s+/gim) ?? [];
  const untaggedMatches = output.match(/^untagged:\s+/gim) ?? [];
  return deletedMatches.length + untaggedMatches.length;
}

interface PruneResult {
  status: 'ok' | 'error';
  removed: number;
  reclaimedMB: number;
  error?: string;
}

export function pruneDanglingImages(): PruneResult {
  try {
    const output = execSync('docker image prune -f', {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000,
    });

    const removed = parseRemovedCount(output);
    const reclaimedMB = parseReclaimedMB(output);

    log.info({ removed, reclaimedMB }, 'Pruned dangling Docker images');
    return { status: 'ok', removed, reclaimedMB };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, 'Failed to prune dangling Docker images');
    return { status: 'error', removed: 0, reclaimedMB: 0, error: message };
  }
}

export function pruneBuildCache(): PruneResult {
  try {
    const output = execSync('docker builder prune -af', {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120000,
    });

    const reclaimedMB = parseReclaimedMB(output);
    log.info({ reclaimedMB }, 'Pruned Docker build cache');
    return { status: 'ok', removed: 0, reclaimedMB };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, 'Failed to prune Docker build cache');
    return { status: 'error', removed: 0, reclaimedMB: 0, error: message };
  }
}

export function pruneUnusedImages(): PruneResult {
  try {
    const output = execSync('docker image prune -a -f --filter "until=24h"', {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 120000,
    });

    const removed = parseRemovedCount(output);
    const reclaimedMB = parseReclaimedMB(output);

    log.info({ removed, reclaimedMB }, 'Pruned unused Docker images older than 24h');
    return { status: 'ok', removed, reclaimedMB };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ err }, 'Failed to prune unused Docker images');
    return { status: 'error', removed: 0, reclaimedMB: 0, error: message };
  }
}

export function postDeployCleanup(): void {
  try {
    const dangling = pruneDanglingImages();
    log.info({ dangling }, 'Post-deploy Docker cleanup completed');
  } catch (err) {
    log.warn({ err }, 'Post-deploy Docker cleanup failed');
  }
}

/**
 * Report high disk pressure without mutating the shared Docker daemon.
 *
 * An OpenLander process cannot prove ownership of dangling images or BuildKit
 * cache on a Docker socket shared with another instance. Automatic maintenance
 * therefore stays audit-only; an administrator can still run the explicit
 * cleanup_docker action after reviewing its scope.
 */
export function auditDiskThresholdCleanup(): void {
  try {
    const usagePercent = getSystemStats().disk.usagePercent;
    log.warn(
      { usagePercent, thresholdPercent: DISK_CLEANUP_THRESHOLD_PERCENT },
      'Disk usage is above the cleanup threshold; automatic Docker cleanup is audit-only',
    );
  } catch (err) {
    log.warn({ err }, 'Failed to audit disk cleanup threshold');
  }
}

export function diskThresholdCleanup(): void {
  try {
    const before = getSystemStats().disk.usagePercent;
    log.info(
      { beforePercent: before, thresholdPercent: DISK_CLEANUP_THRESHOLD_PERCENT },
      'Running disk-threshold Docker cleanup',
    );

    const dangling = pruneDanglingImages();
    const buildCache = pruneBuildCache();

    const afterBaseCleanup = getSystemStats().disk.usagePercent;

    let unusedImages: { removed: number; reclaimedMB: number } | undefined;
    if (afterBaseCleanup >= DISK_CLEANUP_THRESHOLD_PERCENT) {
      unusedImages = pruneUnusedImages();
    }

    const after = getSystemStats().disk.usagePercent;
    log.info(
      {
        beforePercent: before,
        afterPercent: after,
        dangling,
        buildCache,
        unusedImages,
      },
      'Disk-threshold Docker cleanup completed',
    );
  } catch (err) {
    log.warn({ err }, 'Disk-threshold Docker cleanup failed');
  }
}

export function shouldRunCleanup(): boolean {
  try {
    const usagePercent = getSystemStats().disk.usagePercent;
    return usagePercent >= DISK_CLEANUP_THRESHOLD_PERCENT;
  } catch (err) {
    log.warn({ err }, 'Failed to evaluate disk cleanup threshold');
    return false;
  }
}

export { DISK_CLEANUP_THRESHOLD_PERCENT };
