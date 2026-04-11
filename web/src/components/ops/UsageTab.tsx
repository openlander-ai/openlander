import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { getAiUsageSummary, getAiUsageRecent } from '@/lib/api/usage';
import type { AiUsageSummary, AiUsageLog } from '@/lib/api/usage';
import { Skeleton } from '@/components/ui/skeleton';
import { parseTimestamp } from '@/lib/time';

export function UsageTab() {
  const [summary, setSummary] = useState<AiUsageSummary | null>(null);
  const [recentLogs, setRecentLogs] = useState<AiUsageLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadUsage = async () => {
      try {
        const [summaryData, recentData] = await Promise.all([
          getAiUsageSummary(),
          getAiUsageRecent({ limit: 50 }),
        ]);
        setSummary(summaryData);
        setRecentLogs(recentData.logs);
      } catch (error) {
        console.error('Failed to fetch AI usage:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadUsage();
  }, []);

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!summary || summary.callCount === 0) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-center border border-dashed border-[hsl(var(--border))] rounded-lg m-6 bg-bg-subtle/30">
        <BarChart3 className="h-12 w-12 text-muted-ol mb-4" />
        <h3 className="text-lg font-medium text-primary-ol mb-2">No AI usage recorded</h3>
        <p className="text-sm text-muted-ol max-w-md">
          Usage data appears when AI features are active.
        </p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel">
          <p className="text-sm font-medium text-muted-ol mb-1">Total Cost</p>
          <p className="text-2xl font-semibold text-primary-ol">
            ${summary.totalCostUsd ? summary.totalCostUsd.toFixed(4) : '0.0000'}
          </p>
        </div>
        <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel">
          <p className="text-sm font-medium text-muted-ol mb-1">Total Tokens</p>
          <p className="text-2xl font-semibold text-primary-ol">
            {(summary.totalInputTokens + summary.totalOutputTokens).toLocaleString()}
          </p>
          <p className="text-xs text-muted-ol mt-1">
            {summary.totalInputTokens.toLocaleString()} in /{' '}
            {summary.totalOutputTokens.toLocaleString()} out
          </p>
        </div>
        <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel">
          <p className="text-sm font-medium text-muted-ol mb-1">Total Calls</p>
          <p className="text-2xl font-semibold text-primary-ol">
            {summary.callCount.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden">
        <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-bg-subtle">
          <h3 className="font-medium text-primary-ol">Recent Activity</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-ol uppercase bg-bg-subtle border-b border-[hsl(var(--border))]">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Model</th>
                <th className="px-4 py-3 font-medium text-right">Tokens</th>
                <th className="px-4 py-3 font-medium text-right">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {recentLogs.map((log) => {
                const date = parseTimestamp(String(log.createdAt));

                return (
                  <tr key={log.id} className="hover:bg-bg-subtle/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-ol">
                      {date ? date.toLocaleString() : 'Unknown'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-md bg-bg-subtle border border-[hsl(var(--border))] text-xs font-medium text-primary-ol">
                        {log.actionType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-secondary-ol">{log.modelName || 'Unknown'}</td>
                    <td className="px-4 py-3 text-right text-secondary-ol">
                      {log.totalTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-secondary-ol">
                      {log.costUsd ? `$${log.costUsd.toFixed(4)}` : '-'}
                    </td>
                  </tr>
                );
              })}
              {recentLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-ol">
                    No recent activity
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
