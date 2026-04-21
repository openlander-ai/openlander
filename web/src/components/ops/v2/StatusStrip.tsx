import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  HelpCircle,
  AlertCircle,
  ShieldAlert,
  Bot,
  Menu,
  Wifi,
  WifiOff,
  Loader2,
} from 'lucide-react';
import { cn } from '../../../lib/utils.js';
import { useLanguage } from '../../../i18n/context.js';

export interface StatusStripProps {
  healthState: 'healthy' | 'degraded' | 'critical' | 'unknown';
  activeIncidentCount: number;
  pendingApprovalCount: number;
  trippedCircuitBreakerCount: number;
  isAgentActive?: boolean;
  connectionStatus?: 'connected' | 'disconnected' | 'reconnecting';
  onIncidentClick?: () => void;
  onApprovalClick?: () => void;
  /** Called when the hamburger/menu button is clicked (mobile only) */
  onMenuClick?: () => void;
}

const HEALTH_CONFIG = {
  healthy: {
    icon: CheckCircle2,
    color: 'text-success',
    bg: 'bg-success/10',
    labelKey: 'opsV2.statusStrip.healthy',
  },
  degraded: {
    icon: AlertTriangle,
    color: 'text-warning',
    bg: 'bg-warning/10',
    labelKey: 'opsV2.statusStrip.degraded',
  },
  critical: {
    icon: XCircle,
    color: 'text-error',
    bg: 'bg-error/10',
    labelKey: 'opsV2.statusStrip.critical',
  },
  unknown: {
    icon: HelpCircle,
    color: 'text-muted-foreground',
    bg: 'bg-muted/10',
    labelKey: 'opsV2.statusStrip.unknown',
  },
} as const;

export function StatusStrip({
  healthState,
  activeIncidentCount,
  pendingApprovalCount,
  trippedCircuitBreakerCount,
  isAgentActive = false,
  connectionStatus,
  onIncidentClick,
  onApprovalClick,
  onMenuClick,
}: StatusStripProps) {
  const { t } = useLanguage();
  const health = HEALTH_CONFIG[healthState];
  const HealthIcon = health.icon;

  return (
    <div
      className={cn(
        'sticky top-0 z-10',
        'flex items-center gap-3 px-3 py-2 md:gap-4 md:px-4',
        'bg-bg-panel/80 backdrop-blur-sm',
        'border-b border-[hsl(var(--border))]',
        'text-xs font-medium',
      )}
    >
      {/* Hamburger — visible only at < md (mobile), triggers rail drawer */}
      {onMenuClick && (
        <button
          type="button"
          onClick={onMenuClick}
          aria-label={t('opsV2.nav.openNavigation')}
          className="flex md:hidden items-center justify-center h-6 w-6 rounded-md text-muted-foreground hover:text-foreground/80 hover:bg-bg-subtle transition-colors shrink-0"
        >
          <Menu className="h-4 w-4" />
        </button>
      )}

      {/* Health state — always visible */}
      <div className={cn('flex items-center gap-1.5', health.color)}>
        <HealthIcon className="h-4 w-4" />
        <span className="hidden sm:inline">{t('opsV2.statusStrip.healthState')}</span>
        <span
          className={cn(
            'inline-flex items-center rounded-full px-1.5 py-0.5',
            health.bg,
            health.color,
          )}
        >
          {t(health.labelKey)}
        </span>
      </div>

      <span className="h-3 w-px bg-[hsl(var(--border))] hidden sm:block" />

      {/* Active incidents — always visible */}
      <button
        type="button"
        onClick={onIncidentClick}
        disabled={!onIncidentClick}
        className={cn(
          'flex items-center gap-1.5 transition-colors',
          activeIncidentCount > 0 ? 'text-error hover:text-error/80' : 'text-muted-foreground',
          onIncidentClick && 'cursor-pointer hover:underline',
          !onIncidentClick && 'cursor-default',
        )}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        <span>{t('opsV2.statusStrip.incidentCount', { count: activeIncidentCount })}</span>
      </button>

      {/* Pending approvals — hidden at < sm */}
      <span className="h-3 w-px bg-[hsl(var(--border))] hidden sm:block" />
      <button
        type="button"
        onClick={onApprovalClick}
        disabled={!onApprovalClick}
        className={cn(
          'hidden sm:flex items-center gap-1.5 transition-colors',
          pendingApprovalCount > 0 ? 'text-warning hover:text-warning/80' : 'text-muted-foreground',
          onApprovalClick && 'cursor-pointer hover:underline',
          !onApprovalClick && 'cursor-default',
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5" />
        <span>{t('opsV2.statusStrip.approvalCount', { count: pendingApprovalCount })}</span>
      </button>

      {/* Tripped circuit breakers — hidden at < md, only shown when count > 0 */}
      {trippedCircuitBreakerCount > 0 && (
        <>
          <span className="h-3 w-px bg-[hsl(var(--border))] hidden md:block" />
          <div className="hidden md:flex items-center gap-1.5 text-error">
            <ShieldAlert className="h-3.5 w-3.5" />
            <span>
              {t('opsV2.statusStrip.circuitBreakerCount', { count: trippedCircuitBreakerCount })}
            </span>
          </div>
        </>
      )}

      {/* Agent badge — hidden at < md, only when active */}
      {isAgentActive && (
        <>
          <span className="h-3 w-px bg-[hsl(var(--border))] hidden md:block" />
          <div className="hidden md:flex items-center gap-1.5 text-agent">
            <Bot className="h-3.5 w-3.5" />
            <span>{t('opsV2.statusStrip.agentStatus')}</span>
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-agent opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-agent" />
            </span>
          </div>
        </>
      )}

      {/* Connection status indicator — pushed to the far right */}
      {connectionStatus && connectionStatus !== 'connected' && (
        <>
          <span className="flex-1" />
          <div
            className={cn(
              'flex items-center gap-1.5 text-[10px] font-medium',
              connectionStatus === 'reconnecting' ? 'text-warning' : 'text-error',
            )}
          >
            {connectionStatus === 'reconnecting' ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <WifiOff className="h-3 w-3" />
            )}
            <span>
              {connectionStatus === 'reconnecting'
                ? t('opsV2.connection.reconnecting')
                : t('opsV2.connection.disconnected')}
            </span>
          </div>
        </>
      )}
      {connectionStatus === 'connected' && (
        <>
          <span className="flex-1" />
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-success">
            <Wifi className="h-3 w-3" />
            <span>{t('opsV2.connection.connected')}</span>
          </div>
        </>
      )}
    </div>
  );
}
