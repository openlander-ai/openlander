import { AlertTriangle, CheckCircle2, Activity, ShieldAlert } from 'lucide-react';
import type { DeployLogDetail } from '@/types';
import { useLanguage } from '@/i18n/context';
import { DiagnoseButton } from '@/components/agent/DiagnoseButton';

interface DiagnosisPanelProps {
  deployment: DeployLogDetail | null;
}

export function DiagnosisPanel({ deployment }: DiagnosisPanelProps) {
  const { t } = useLanguage();

  if (!deployment) return null;

  if (deployment.status === 'success') {
    return (
      <div className="sticky top-6 space-y-4">
        <h3 className="text-sm font-display font-medium text-secondary-ol">Diagnosis</h3>
        <div className="rounded-lg border border-success/30 bg-success/5 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-success shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-display font-medium text-primary-ol">
                No issues detected
              </h4>
              <p className="text-sm font-body text-secondary-ol">Build completed successfully.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="sticky top-6 space-y-4">
      <h3 className="text-sm font-display font-medium text-secondary-ol">Diagnosis</h3>

      {deployment.failureSummary && (
        <div className="rounded-lg border border-warning/30 bg-warning/5 border-l-4 border-l-warning p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-sm font-display font-medium text-primary-ol">Error Detection</h4>
              <p className="text-sm font-body text-secondary-ol">{deployment.failureSummary}</p>
            </div>
          </div>
        </div>
      )}

      {deployment.status === 'failed' && deployment.buildLog && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4">
          <div className="flex items-start gap-3">
            <ShieldAlert className="h-5 w-5 text-agent shrink-0 mt-0.5" />
            <div className="space-y-1 w-full">
              <h4 className="text-sm font-display font-medium text-primary-ol">AI Diagnosis</h4>
              <p className="text-sm font-body text-secondary-ol mb-3">
                {t('deploy.buildFailureDetected')}
              </p>
              <DiagnoseButton
                className="w-full"
                projectId={deployment.projectId}
                deployId={deployment.id}
                errorMessage={deployment.failureSummary ?? deployment.buildLog ?? undefined}
                logLines={deployment.buildLog.split('\n').slice(-80)}
              />
            </div>
          </div>
        </div>
      )}

      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 opacity-50">
        <div className="flex items-start gap-3">
          <Activity className="h-5 w-5 text-muted-ol shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-display font-medium text-primary-ol">Recovery Attempts</h4>
            <p className="text-sm font-body text-muted-ol">No recovery data available.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
