import { useEffect, useState } from 'react';
import {
  Loader2,
  AlertCircle,
  Brain,
  ArrowDownToLine,
  ArrowUpFromLine,
  DollarSign,
  Activity,
  Clock,
  Zap,
} from 'lucide-react';
import { useLanguage } from '@/i18n/context.js';
import { cn } from '@/lib/utils.js';
import { useAiUsage } from '@/hooks/use-ai-usage.js';
import { listProjects } from '@/lib/api/projects.js';
import { StatCard } from './shared.js';
import { formatRelativeTime } from '@/lib/time.js';

export function AiUsageSection() {
  const { t } = useLanguage();
  const { summary, recent, isLoading, error } = useAiUsage();
  const [projects, setProjects] = useState<Record<string, string>>({});

  useEffect(() => {
    void listProjects(false)
      .then((data) => {
        const map: Record<string, string> = {};
        for (const p of data) map[p.id] = p.name;
        setProjects(map);
      })
      .catch(() => {});
  }, []);

  return (
    <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5">
      <div className="flex items-center gap-2">
        <Activity className="h-4 w-4 text-agent" />
        <h2 className="font-display text-sm font-semibold text-primary-ol">
          {t('settings.ai.usage.title') || 'Usage & Statistics'}
        </h2>
      </div>

      {error && (
        <div className="rounded-md bg-error/10 p-3 text-sm font-body text-error flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-agent" />
          <span className="ml-2 text-sm text-muted-ol">
            {t('settings.ai.usage.loading') || 'Loading...'}
          </span>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div data-testid="usage-total-input-tokens">
              <StatCard
                icon={<ArrowDownToLine className="h-4 w-4" />}
                label={t('settings.ai.usage.inputTokens') || 'Input Tokens'}
                value={summary?.totalInputTokens.toLocaleString() ?? '0'}
                color="text-blue-500"
              />
            </div>
            <div data-testid="usage-total-output-tokens">
              <StatCard
                icon={<ArrowUpFromLine className="h-4 w-4" />}
                label={t('settings.ai.usage.outputTokens') || 'Output Tokens'}
                value={summary?.totalOutputTokens.toLocaleString() ?? '0'}
                color="text-green-500"
              />
            </div>
            <div data-testid="usage-total-cost">
              <StatCard
                icon={<DollarSign className="h-4 w-4" />}
                label={t('settings.ai.usage.totalCost') || 'Total Cost'}
                value={`$${summary?.totalCostUsd?.toFixed(3) ?? '0.000'}`}
                color="text-yellow-500"
              />
            </div>
            <div data-testid="usage-call-count">
              <StatCard
                icon={<Zap className="h-4 w-4" />}
                label={t('settings.ai.usage.callCount') || 'Call Count'}
                value={summary?.callCount.toLocaleString() ?? '0'}
                color="text-purple-500"
              />
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-medium text-primary-ol">
              {t('settings.ai.usage.recentCalls') || 'Recent Calls'}
            </h3>
            {recent.length === 0 ? (
              <div className="rounded-lg border border-border bg-bg-panel shadow-sm p-8 text-center">
                <p className="text-xs font-body text-muted-ol">
                  {t('settings.ai.usage.empty') || 'No recent calls.'}
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-border bg-bg-subtle/50 divide-y divide-border">
                {recent.slice(0, 10).map((log) => (
                  <div
                    key={log.id}
                    className="flex flex-col sm:flex-row sm:items-center justify-between p-3 gap-4"
                  >
                    <div className="flex items-start sm:items-center gap-3">
                      <div
                        className={cn(
                          'flex items-center justify-center h-8 w-8 rounded-full shrink-0 mt-0.5 sm:mt-0',
                          log.result === 'failure' ? 'bg-error/10' : 'bg-bg-subtle',
                        )}
                      >
                        <Brain
                          className={cn(
                            'h-4 w-4',
                            log.result === 'failure' ? 'text-error' : 'text-agent',
                          )}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-primary-ol flex flex-wrap items-center gap-1.5">
                          {log.projectId && (
                            <span className="text-xs font-normal text-agent border border-agent/20 bg-agent/5 px-1.5 py-0.5 rounded">
                              {projects[log.projectId] || log.projectId.slice(0, 12)}
                            </span>
                          )}
                          {!log.projectId && (
                            <span className="text-xs font-normal text-muted-ol border border-border bg-bg-subtle px-1.5 py-0.5 rounded">
                              {(t as (key: string) => string)('settings.ai.usage.noProject') ||
                                'Global'}
                            </span>
                          )}
                          {(t as (key: string) => string)(
                            `settings.ai.usage.actionType.${log.actionType}`,
                          ) || log.actionType}
                          <span className="text-xs font-normal text-muted-ol bg-bg-subtle px-1.5 py-0.5 rounded">
                            {log.modelName}
                          </span>
                        </p>
                        <p className="text-xs text-secondary-ol flex flex-wrap items-center gap-1.5 mt-1">
                          <span className="flex items-center gap-1 whitespace-nowrap">
                            <Clock className="h-3 w-3" />
                            {formatRelativeTime(log.createdAt, t)}
                          </span>
                          {log.durationMs && (
                            <span className="whitespace-nowrap flex items-center gap-1">
                              <span className="text-border">|</span>
                              {(log.durationMs / 1000).toFixed(1)}s
                            </span>
                          )}
                          {log.source && (
                            <span className="whitespace-nowrap flex items-center gap-1">
                              <span className="text-border">|</span>
                              <span className="font-mono text-[10px] bg-bg-subtle px-1 rounded">
                                {(t as (key: string) => string)(
                                  `settings.ai.usage.source.${log.source}`,
                                ) || log.source}
                              </span>
                            </span>
                          )}
                          {log.result && (
                            <span className="whitespace-nowrap flex items-center gap-1">
                              <span className="text-border">|</span>
                              <span
                                className={cn(
                                  'font-mono text-[10px] px-1 rounded',
                                  log.result === 'success'
                                    ? 'text-success bg-success/10'
                                    : log.result === 'failure'
                                      ? 'text-error bg-error/10'
                                      : 'text-warning bg-warning/10',
                                )}
                              >
                                {(t as (key: string) => string)(
                                  `settings.ai.usage.result.${log.result}`,
                                ) || log.result}
                              </span>
                            </span>
                          )}
                          {log.toolsCalled && (
                            <span
                              className="truncate max-w-[200px] flex items-center gap-1"
                              title={log.toolsCalled}
                            >
                              <span className="text-border">|</span>
                              <span className="font-mono text-[10px] bg-bg-subtle px-1 rounded truncate">
                                {log.toolsCalled.split(',').length} tools
                              </span>
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    <div className="text-left sm:text-right shrink-0 ml-11 sm:ml-0">
                      <p className="text-sm font-medium text-primary-ol">
                        {((log.inputTokens || 0) + (log.outputTokens || 0)).toLocaleString()}{' '}
                        {t('settings.ai.usage.tokenUnit') || 'tokens'}
                      </p>
                      {log.costUsd != null && log.costUsd > 0 && (
                        <p className="text-xs text-muted-ol">${log.costUsd.toFixed(4)}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}
