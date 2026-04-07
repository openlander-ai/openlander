import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  fetchAllCircuitBreakers,
  resetCircuitBreaker,
  type CircuitBreakerWithProject,
} from '@/lib/api/operations';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import { describeCBState, relativeTime } from '@/components/ops/utils';
interface CircuitBreakerMapProps {
  projectId?: string;
  projectNameById: Record<string, string>;
  refreshToken: number;
}

const STATE_ORDER: Record<CircuitBreakerWithProject['state'], number> = {
  open: 0,
  half_open: 1,
  closed: 2,
};

export function CircuitBreakerMap({
  projectId,
  projectNameById,
  refreshToken,
}: CircuitBreakerMapProps) {
  const { t, language } = useLanguage();
  const [breakers, setBreakers] = useState<CircuitBreakerWithProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [resettingProjectId, setResettingProjectId] = useState<string | null>(null);

  const loadBreakers = useCallback(async () => {
    try {
      const data = await fetchAllCircuitBreakers();
      setBreakers(data.breakers ?? []);
    } catch (err) {
      console.error('Failed to load circuit breakers', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadBreakers();
  }, [loadBreakers, refreshToken]);

  const visibleBreakers = useMemo(() => {
    let filtered = projectId
      ? breakers.filter((breaker) => breaker.projectId === projectId)
      : [...breakers];

    // Hide archived projects
    filtered = filtered.filter((breaker) => !!projectNameById[breaker.projectId]);

    filtered.sort((a, b) => {
      const stateDiff = STATE_ORDER[a.state] - STATE_ORDER[b.state];
      if (stateDiff !== 0) {
        return stateDiff;
      }
      return b.failureCount - a.failureCount;
    });

    return filtered;
  }, [breakers, projectId, projectNameById]);

  const openBreakers = visibleBreakers.filter((breaker) => breaker.state !== 'closed');

  const handleReset = async (breaker: CircuitBreakerWithProject) => {
    setResettingProjectId(breaker.projectId);
    try {
      await resetCircuitBreaker(breaker.projectId);
      toast.success(`${breaker.projectName} · ${t('operations.circuitBreakers.reset')}`);
      await loadBreakers();
    } catch (err) {
      console.error('Failed to reset circuit breaker', err);
      toast.error(t('approval.banner.error'));
    } finally {
      setResettingProjectId(null);
    }
  };

  return (
    <Card className="border-border bg-panel p-4 lg:p-5">
      <h2 className="mb-4 font-display text-lg font-semibold text-primary-ol">
        {t('operations.circuitBreakers.title')}
      </h2>

      {loading ? (
        <div className="text-sm font-body text-muted-ol">{t('Loading...')}</div>
      ) : openBreakers.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-success/30 bg-success/10 px-4 py-8 text-center text-sm font-body text-success">
          <CheckCircle2 className="h-6 w-6 mb-2 opacity-80" />
          {t('operations.circuitBreakers.allHealthy')}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {openBreakers.map((breaker) => {
            const isOpen = breaker.state === 'open';
            const isHalfOpen = breaker.state === 'half_open';
            const failureTimestamp = breaker.lastFailureAt;

            return (
              <div
                key={breaker.projectId}
                className={cn(
                  'rounded-lg border bg-bg-subtle px-4 py-3',
                  isOpen && 'border-error/60',
                  isHalfOpen && 'border-warning/60',
                )}
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <p
                    className="truncate font-body text-sm font-medium text-primary-ol flex-1"
                    title={projectNameById[breaker.projectId]}
                  >
                    {projectNameById[breaker.projectId]}
                  </p>
                  <div className="flex flex-col gap-1 items-end">
                    <Badge variant="outline" className="font-body text-xs font-semibold">
                      {describeCBState(breaker.state, breaker.failureCount, language).label}
                    </Badge>
                  </div>
                </div>

                <div className="flex flex-col gap-1 mt-1 text-xs">
                  <p className="font-body text-primary-ol leading-relaxed">
                    {describeCBState(breaker.state, breaker.failureCount, language).explanation}
                  </p>
                  <p className="font-body text-muted-ol">
                    {t('ops.lastFailure')}:{' '}
                    {failureTimestamp ? relativeTime(failureTimestamp, language) : '-'}
                  </p>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  className="mt-3 w-full"
                  onClick={() => void handleReset(breaker)}
                  disabled={resettingProjectId === breaker.projectId}
                >
                  {t('operations.circuitBreakers.reset')}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
