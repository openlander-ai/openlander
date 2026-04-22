import { useEffect, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { getAiUsageSummary, getAiUsageRecent } from '@/lib/api/usage';
import type { AiUsageSummary, AiUsageLog } from '@/lib/api/usage';
import { Skeleton } from '@/components/ui/skeleton';
import { PageEmptyState } from '@/components/ui/page-empty-state';
import { parseTimestamp } from '@/lib/time';
import { useLanguage } from '@/i18n/context';

export function UsageTab() {
  const { t } = useLanguage();
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
      <PageEmptyState
        icon={BarChart3}
        title={t('usageTab.noUsage')}
        description={t('usageTab.emptyMessage')}
      />
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel">
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {t('usageTab.totalCost')}
          </p>
          <p className="text-2xl font-semibold text-foreground">
            ${summary.totalCostUsd ? summary.totalCostUsd.toFixed(2) : '0.00'}
          </p>
        </div>
        <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel">
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {t('usageTab.totalTokens')}
          </p>
          <p className="text-2xl font-semibold text-foreground">
            {(summary.totalInputTokens + summary.totalOutputTokens).toLocaleString()}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {summary.totalInputTokens.toLocaleString()} {t('usageTab.in')} /{' '}
            {summary.totalOutputTokens.toLocaleString()} {t('usageTab.out')}
          </p>
        </div>
        <div className="p-4 rounded-lg border border-[hsl(var(--border))] bg-bg-panel">
          <p className="text-sm font-medium text-muted-foreground mb-1">
            {t('usageTab.totalCalls')}
          </p>
          <p className="text-2xl font-semibold text-foreground">
            {summary.callCount.toLocaleString()}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden">
        <div className="px-4 py-3 border-b border-[hsl(var(--border))] bg-bg-subtle">
          <h3 className="font-medium text-foreground">{t('usageTab.recentActivity')}</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-bg-subtle border-b border-[hsl(var(--border))]">
              <tr>
                <th className="px-4 py-3 font-medium">{t('usageTab.time')}</th>
                <th className="px-4 py-3 font-medium">{t('usageTab.action')}</th>
                <th className="px-4 py-3 font-medium">{t('usageTab.model')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('usageTab.tokens')}</th>
                <th className="px-4 py-3 font-medium text-right">{t('usageTab.cost')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {recentLogs.map((log) => {
                const date = parseTimestamp(String(log.createdAt));

                return (
                  <tr key={log.id} className="hover:bg-bg-subtle/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
                      {date ? date.toLocaleString() : 'Unknown'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="px-2 py-1 rounded-md bg-bg-subtle border border-[hsl(var(--border))] text-xs font-medium text-foreground">
                        {log.actionType}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-foreground/80">
                      {log.modelName || t('usageTab.unknown')}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground/80">
                      {log.totalTokens.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right text-foreground/80">
                      {log.costUsd ? `$${log.costUsd.toFixed(4)}` : '-'}
                    </td>
                  </tr>
                );
              })}
              {recentLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                    {t('usageTab.noRecentActivity')}
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
