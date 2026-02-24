import { cpus, totalmem, freemem, loadavg, uptime, hostname } from 'node:os';
import { statfsSync } from 'node:fs';

/**
 * System resource monitoring.
 *
 * Provides CPU, memory, and disk usage for the host machine.
 * Used by the agent to report system status and warn about resource constraints.
 */

export interface SystemStats {
  hostname: string;
  uptime: {
    seconds: number;
    formatted: string;
  };
  cpu: {
    cores: number;
    model: string;
    loadAvg1m: number;
    loadAvg5m: number;
    loadAvg15m: number;
    usagePercent: number;
  };
  memory: {
    totalMB: number;
    usedMB: number;
    freeMB: number;
    usagePercent: number;
  };
  disk: {
    totalGB: number;
    usedGB: number;
    freeGB: number;
    usagePercent: number;
  };
}

/** Get current system resource usage. */
export function getSystemStats(): SystemStats {
  const cpuInfo = cpus();
  const totalMem = totalmem();
  const freeMem = freemem();
  const usedMem = totalMem - freeMem;
  const load = loadavg();
  const uptimeSec = uptime();

  // Disk usage for root partition
  let disk = { totalGB: 0, usedGB: 0, freeGB: 0, usagePercent: 0 };
  try {
    const fs = statfsSync('/');
    const totalBytes = fs.blocks * fs.bsize;
    const freeBytes = fs.bavail * fs.bsize;
    const usedBytes = totalBytes - freeBytes;
    disk = {
      totalGB: round(totalBytes / 1e9),
      usedGB: round(usedBytes / 1e9),
      freeGB: round(freeBytes / 1e9),
      usagePercent: round((usedBytes / totalBytes) * 100),
    };
  } catch {
    // statfs not available on all platforms
  }

  // CPU usage estimate from load average vs core count
  const cpuCores = cpuInfo.length || 1;
  const cpuUsage = round(((load[0] ?? 0) / cpuCores) * 100);

  return {
    hostname: hostname(),
    uptime: {
      seconds: Math.floor(uptimeSec),
      formatted: formatUptime(uptimeSec),
    },
    cpu: {
      cores: cpuCores,
      model: cpuInfo[0]?.model ?? 'unknown',
      loadAvg1m: round(load[0] ?? 0),
      loadAvg5m: round(load[1] ?? 0),
      loadAvg15m: round(load[2] ?? 0),
      usagePercent: Math.min(cpuUsage, 100),
    },
    memory: {
      totalMB: round(totalMem / 1e6),
      usedMB: round(usedMem / 1e6),
      freeMB: round(freeMem / 1e6),
      usagePercent: round((usedMem / totalMem) * 100),
    },
    disk,
  };
}

/** Format a human-readable summary string for display. */
export function formatStatsSummary(stats: SystemStats): string {
  const lines = [
    `Host: ${stats.hostname}`,
    `Uptime: ${stats.uptime.formatted}`,
    `CPU: ${String(stats.cpu.cores)} cores (${stats.cpu.model})`,
    `  Load: ${String(stats.cpu.loadAvg1m)} / ${String(stats.cpu.loadAvg5m)} / ${String(stats.cpu.loadAvg15m)} (1/5/15m)`,
    `  Usage: ~${String(stats.cpu.usagePercent)}%`,
    `Memory: ${String(stats.memory.usedMB)}MB / ${String(stats.memory.totalMB)}MB (${String(stats.memory.usagePercent)}%)`,
    `Disk: ${String(stats.disk.usedGB)}GB / ${String(stats.disk.totalGB)}GB (${String(stats.disk.usagePercent)}%)`,
  ];

  // Warnings
  if (stats.memory.usagePercent > 85) {
    lines.push('⚠️ Memory usage is high');
  }
  if (stats.disk.usagePercent > 90) {
    lines.push('⚠️ Disk usage is high');
  }

  return lines.join('\n');
}

// --- Helpers ---

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${String(days)}d`);
  if (hours > 0) parts.push(`${String(hours)}h`);
  parts.push(`${String(mins)}m`);

  return parts.join(' ');
}
