import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type DiskStats = {
  usagePercent?: number;
  usedGB?: number;
};

export function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 space-y-2">
      <div className={cn('flex items-center gap-2 text-muted-ol', color)}>
        {icon}
        <span className="text-xs font-body uppercase tracking-wider">{label}</span>
      </div>
      <p
        className="text-lg font-mono font-bold text-primary-ol leading-tight line-clamp-2"
        title={value}
      >
        {value}
      </p>
    </div>
  );
}

export function formatMemory(
  mem: number | { usedMB?: number; totalMB?: number; usagePercent?: number },
): string {
  if (typeof mem === 'number') return `${(mem / (1024 * 1024 * 1024)).toFixed(1)}G`;
  if (mem?.usagePercent != null) return `${mem.usagePercent.toFixed(0)}%`;
  if (mem?.usedMB != null) return `${(mem.usedMB / 1024).toFixed(1)}G`;
  return '—';
}

export function formatDisk(disk: unknown): string {
  if (!disk || typeof disk !== 'object') return '—';
  const stats = disk as DiskStats;
  if (stats.usagePercent != null) return `${stats.usagePercent.toFixed(0)}%`;
  if (stats.usedGB != null) return `${stats.usedGB.toFixed(0)}G`;
  return '—';
}
