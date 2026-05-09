import { AlertTriangle, CheckCircle2, Activity, ShieldAlert } from 'lucide-react';
import type { DeployLogDetail } from '@/types';
import { useLanguage } from '@/i18n/context';

interface DiagnosisPanelProps {
  deployment: DeployLogDetail | null;
}

export function DiagnosisPanel({ deployment }: DiagnosisPanelProps) {
  const { t } = useLanguage();

  if (!deployment) return null;

  if (deployment.status === 'success') {
    return (
      <div className="sticky top-6 space-y-4">
        <h3 className="text-sm font-display font-medium text-foreground/80">Diagnosis</h3>
        <div className="rounded-lg border border-success/30 bg-success/5 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-display font-medium text-foreground">
                No issues detected
              </h4>
              <p className="text-sm font-body text-foreground/80">Build completed successfully.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-6 space-y-4">
      <h3 className="text-sm font-display font-medium text-foreground/80">Diagnosis</h3>

      {deployment.failureSummary && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 border-l-4 border-l-warning p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-display font-medium text-foreground">Error Detection</h4>
              <p className="text-sm font-body text-foreground/80">{deployment.failureSummary}</p>
            </div>
          </div>
        </div>
      )}

      {deployment.status === 'failed' && deployment.buildLog && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-agent shrink-0 mt-0.5" />
            <div className="space-y-1 w-full">
              <h4 className="text-sm font-display font-medium text-foreground">Build Log</h4>
              <p className="text-sm font-body text-foreground/80 mb-3">
                {t('deploy.buildFailureDetected')}
              </p>
              <pre className="max-h-56 overflow-auto rounded-md border border-[hsl(var(--border))] bg-bg-terminal p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                {deployment.buildLog.split('\n').slice(-80).join('\n')}
              </pre>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 opacity-50">
        <div className="flex items-start gap-3">
          <Activity className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-display font-medium text-foreground">Recovery Attempts</h4>
            <p className="text-sm font-body text-muted-foreground">No recovery data available.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
