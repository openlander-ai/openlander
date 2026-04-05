import { Card } from '../ui/card.js';
import { Button } from '../ui/button.js';
import { Switch } from '../ui/switch.js';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ShieldOff,
  Clock,
  RefreshCw,
} from 'lucide-react';
import { cn } from '../../lib/utils.js';
import { CircuitBreakerBadge } from './CircuitBreakerBadge.js';
import { relativeTime } from './utils.js';
import { useLanguage } from '../../i18n/context.js';

export type StatusType = 'healthy' | 'degraded' | 'broken' | 'blocked' | 'attention';

interface StatusHeroCardProps {
  status: StatusType;
  cbState: string;
  cbFailures: number;
  activeIssuesCount: number;
  lastEventTime: number | null;
  autoRecoveryEnabled: boolean;
  configLoaded: boolean;
  resetting: boolean;
  onResetCircuitBreaker: () => void;
  onToggleAutoRecovery: (enabled: boolean) => void;
}

const STATUS_CONFIG = {
  healthy: {
    color: 'text-success',
    bg: 'bg-success/5',
    border: 'border-success/20',
    icon: CheckCircle2,
    titleKey: 'ops.status.healthy',
    descKey: 'ops.status.healthyDesc',
  },
  degraded: {
    color: 'text-warning',
    bg: 'bg-warning/5',
    border: 'border-warning/20',
    icon: AlertTriangle,
    titleKey: 'ops.status.degraded',
    descKey: 'ops.status.degradedDesc',
  },
  broken: {
    color: 'text-error',
    bg: 'bg-error/5',
    border: 'border-error/20',
    icon: XCircle,
    titleKey: 'ops.status.broken',
    descKey: 'ops.status.brokenDesc',
  },
  blocked: {
    color: 'text-error',
    bg: 'bg-error/10',
    border: 'border-error/30',
    icon: ShieldOff,
    titleKey: 'ops.status.blocked',
    descKey: 'ops.status.blockedDesc',
  },
  attention: {
    color: 'text-warning',
    bg: 'bg-warning/5',
    border: 'border-warning/20',
    icon: AlertTriangle,
    titleKey: 'ops.status.attention',
    descKey: 'ops.status.attentionDesc',
  },
};

export function StatusHeroCard({
  status,
  cbState,
  cbFailures,
  activeIssuesCount,
  lastEventTime,
  autoRecoveryEnabled,
  configLoaded,
  resetting,
  onResetCircuitBreaker,
  onToggleAutoRecovery,
}: StatusHeroCardProps) {
  const { t, language } = useLanguage();
  const currentStatus = STATUS_CONFIG[status];
  const StatusIcon = currentStatus.icon;

  return (
    <Card
      className={cn(
        'flex flex-col md:flex-row items-start md:items-center justify-between p-6 border shadow-sm',
        currentStatus.bg,
        currentStatus.border,
      )}
    >
      <div className="flex items-start gap-4 mb-4 md:mb-0">
        <StatusIcon className={cn('h-8 w-8 mt-1', currentStatus.color)} />
        <div className="flex flex-col">
          <h2 className={cn('text-xl font-bold', currentStatus.color)}>
            {t(currentStatus.titleKey)}
          </h2>
          <p className="text-sm text-secondary-ol mt-1">{t(currentStatus.descKey)}</p>
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-ol font-medium">
            <CircuitBreakerBadge state={cbState} failures={cbFailures} />
            <span className="flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" />
              {activeIssuesCount} {t('Issue')}
              {activeIssuesCount !== 1 ? 's' : ''}
            </span>
            {lastEventTime && (
              <span className="flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                {relativeTime(lastEventTime, language)}
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
        {status === 'blocked' && (
          <Button
            variant="destructive"
            onClick={onResetCircuitBreaker}
            disabled={resetting}
            className="w-full sm:w-auto"
          >
            {resetting ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ShieldOff className="h-4 w-4 mr-2" />
            )}
            {t('operations.circuitBreakers.reset')}
          </Button>
        )}
        {(status === 'broken' || status === 'blocked') && status !== 'blocked' && (
          <Button variant="outline" className="w-full sm:w-auto">
            <RefreshCw className="h-4 w-4 mr-2" />
            {t('Retry Recovery')}
          </Button>
        )}
        <div className="flex items-center gap-3 bg-bg-panel px-4 py-2 rounded-lg border border-[hsl(var(--border))] w-full sm:w-auto justify-between sm:justify-start">
          <span className="text-sm font-medium text-primary-ol">{t('Auto-recovery')}</span>
          <Switch
            checked={autoRecoveryEnabled}
            onCheckedChange={onToggleAutoRecovery}
            disabled={!configLoaded}
          />
        </div>
      </div>
    </Card>
  );
}
