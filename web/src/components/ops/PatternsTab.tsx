import { useEffect, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { apiGet } from '@/lib/api/client';
import { Skeleton } from '@/components/ui/skeleton';
import { parseTimestamp } from '@/lib/time';
import { useLanguage } from '@/i18n/context';

interface DeploymentPattern {
  id: string;
  project_id: string;
  pattern_type: string;
  error_signature: string;
  fix_action: string;
  success_count: number;
  failure_count: number;
  last_seen_at: string | number;
}

export function PatternsTab() {
  const { t } = useLanguage();
  const [patterns, setPatterns] = useState<DeploymentPattern[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadPatterns = async () => {
      try {
        const data = await apiGet<{ patterns: DeploymentPattern[]; total: number }>(
          '/api/ops/patterns',
        );
        setPatterns(data.patterns);
      } catch (error) {
        console.error('Failed to fetch patterns:', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadPatterns();
  }, []);

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (patterns.length === 0) {
    return (
      <div className="p-12 flex flex-col items-center justify-center text-center border border-dashed border-[hsl(var(--border))] rounded-lg m-6 bg-bg-subtle/30">
        <GitBranch className="h-12 w-12 text-muted-ol mb-4" />
        <h3 className="text-lg font-medium text-primary-ol mb-2">{t('patternsTab.noPatterns')}</h3>
        <p className="text-sm text-muted-ol max-w-md">{t('patternsTab.emptyMessage')}</p>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-ol uppercase bg-bg-subtle border-b border-[hsl(var(--border))]">
              <tr>
                <th className="px-4 py-3 font-medium">{t('patternsTab.patternType')}</th>
                <th className="px-4 py-3 font-medium">{t('patternsTab.errorSignature')}</th>
                <th className="px-4 py-3 font-medium">{t('patternsTab.fixAction')}</th>
                <th className="px-4 py-3 font-medium text-center">
                  {t('patternsTab.successFailure')}
                </th>
                <th className="px-4 py-3 font-medium text-right">{t('patternsTab.lastSeen')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[hsl(var(--border))]">
              {patterns.map((pattern) => {
                const date = parseTimestamp(String(pattern.last_seen_at));

                return (
                  <tr key={pattern.id} className="hover:bg-bg-subtle/50 transition-colors">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-1 rounded-md bg-bg-subtle border border-[hsl(var(--border))] text-xs font-medium text-primary-ol">
                        {pattern.pattern_type}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className="max-w-[300px] truncate font-mono text-xs text-secondary-ol"
                        title={pattern.error_signature}
                      >
                        {pattern.error_signature}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className="max-w-[250px] truncate text-secondary-ol"
                        title={pattern.fix_action}
                      >
                        {pattern.fix_action}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <span className="text-success font-medium">{pattern.success_count}</span>
                        <span className="text-muted-ol">/</span>
                        <span className="text-error font-medium">{pattern.failure_count}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-muted-ol whitespace-nowrap">
                      {date ? date.toLocaleDateString() : t('patternsTab.unknown')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
