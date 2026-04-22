import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, RefreshCw, ShieldCheck, AlertTriangle, DollarSign } from 'lucide-react';
import { usePollingTask } from '@/hooks/use-polling-task';
import { apiGet } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useLanguage } from '../../i18n/context.js';

interface OverviewStats {
  active_deploys: number;
  active_recoveries: number;
  pending_approvals: number;
  open_incidents: number;
  unhealthy_services: number;
  ai_spend_today: number;
}

export function ActivityPulse() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [stats, setStats] = useState<OverviewStats | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiGet<OverviewStats>('/api/overview/stats');
      setStats(data);
    } catch (e) {
      console.error('Failed to fetch overview stats', e);
    }
  }, []);

  usePollingTask(fetchStats, { intervalMs: 10000 });

  if (!stats) return null;

  const formatSpend = (spend: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(spend);
  };

  return (
    <div className="flex items-center gap-2" data-testid="activity-pulse">
      {/* Active Deploys */}
      <button
        onClick={() => navigate('/deployments')}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
          stats.active_deploys > 0
            ? 'bg-foreground/10 text-foreground hover:bg-foreground/20'
            : 'text-muted-foreground bg-muted/50 hover:bg-muted',
        )}
        title="Active Deployments"
      >
        <Rocket className="h-3.5 w-3.5" />
        <span className="font-mono">{stats.active_deploys}</span>
        <span className="hidden md:inline">{t('pulse.deploying')}</span>
      </button>

      {/* Active Recoveries */}
      <button
        onClick={() => navigate('/operations')}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
          stats.active_recoveries > 0
            ? 'bg-warning/10 text-warning hover:bg-warning/20'
            : 'text-muted-foreground bg-muted/50 hover:bg-muted',
        )}
        title="Active Recoveries"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', stats.active_recoveries > 0 && 'animate-spin')} />
        <span className="font-mono">{stats.active_recoveries}</span>
        <span className="hidden md:inline">{t('pulse.recovery')}</span>
      </button>

      {/* Pending Approvals */}
      <button
        onClick={() => navigate('/operations?tab=approvals')}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
          stats.pending_approvals > 0
            ? 'bg-error/10 text-error hover:bg-error/20'
            : 'text-muted-foreground bg-muted/50 hover:bg-muted',
        )}
        title="Pending Approvals"
      >
        <ShieldCheck className="h-3.5 w-3.5" />
        <span className="font-mono">{stats.pending_approvals}</span>
        <span className="hidden md:inline">{t('pulse.approval')}</span>
      </button>

      {/* Open Incidents */}
      <button
        onClick={() => navigate('/operations?tab=live')}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
          stats.open_incidents > 0
            ? 'bg-error/10 text-error hover:bg-error/20'
            : 'text-muted-foreground bg-muted/50 hover:bg-muted',
        )}
        title="Open Incidents"
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span className="font-mono">{stats.open_incidents}</span>
        <span className="hidden md:inline">{t('pulse.incidents')}</span>
      </button>

      {/* AI Spend */}
      <button
        onClick={() => navigate('/operations?tab=usage')}
        className={cn(
          'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap',
          stats.ai_spend_today > 0
            ? 'text-agent hover:bg-agent/10'
            : 'text-muted-foreground bg-muted/50 hover:bg-muted',
        )}
        title={t('pulse.aiSpend')}
      >
        <DollarSign className="h-3.5 w-3.5 shrink-0" />
        <span className="font-mono">{formatSpend(stats.ai_spend_today)}</span>
        <span className="hidden md:inline">{t('pulse.aiSpend')}</span>
      </button>
    </div>
  );
}
