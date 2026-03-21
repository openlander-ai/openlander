import type { useEnvScanFlow } from '@/hooks/use-env-scan-flow';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Rocket } from 'lucide-react';
import { toast } from 'sonner';

interface GitRepo {
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  cloneUrl: string;
  isPrivate: boolean;
  defaultBranch: string;
  language: string | null;
  updatedAt: string;
  stars: number;
}

interface ConfigureDeployStepProps {
  selectedRepo: GitRepo;
  environment: string;
  branch: string;
  onBranchChange: (value: string) => void;
  onEnvironmentChange: (value: string) => void;
  onCancel: () => void;
  onConfirmDeploy: () => void;
  onDeployWithVars: (vars: Record<string, string>) => void;
  envScan: ReturnType<typeof useEnvScanFlow>;
  t: (key: string) => string;
}

export function ConfigureDeployStep({
  selectedRepo,
  environment,
  branch,
  onBranchChange,
  onEnvironmentChange,
  onCancel,
  onConfirmDeploy,
  onDeployWithVars,
  envScan,
  t,
}: ConfigureDeployStepProps) {
  return (
    <div className="flex-1 p-6 flex flex-col">
      <div className="max-w-xl mx-auto w-full bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-6 space-y-6">
        <div>
          <h2 className="text-base font-display font-bold text-primary-ol flex items-center gap-2">
            <Rocket className="h-4 w-4" />
            Deploy {selectedRepo.name}
          </h2>
          <p className="text-xs text-secondary-ol font-body mt-1">{selectedRepo.fullName}</p>
        </div>

        {envScan.envStep === 'scanning' && (
          <div className="py-8 flex flex-col items-center justify-center space-y-3">
            <Loader2 className="h-6 w-6 animate-spin text-agent" />
            <p className="text-xs text-secondary-ol font-body">
              Scanning for environment variables...
            </p>
          </div>
        )}

        {envScan.envStep === 'paste' && (
          <div className="space-y-4">
            <div className="text-xs text-secondary-ol font-body">
              {`Found ${String(envScan.envVars.length)} environment variable${envScan.envVars.length !== 1 ? 's' : ''} used in this project.`}
            </div>
            <textarea
              className="w-full rounded-md px-3 py-2 text-xs font-mono bg-bg-app border border-[hsl(var(--border))] text-primary-ol placeholder:text-muted-ol resize-none focus:outline-none focus:ring-1 focus:ring-agent/40"
              rows={8}
              placeholder={t('deploy.dialog.pasteEnvPlaceholder')}
              value={envScan.pasteText}
              onChange={(e) => envScan.setPasteText(e.target.value)}
            />
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                className="text-xs text-secondary-ol hover:text-primary-ol transition-colors font-body"
                onClick={() => void onDeployWithVars({})}
              >
                {t('deploy.dialog.skipEnvVars')}
              </button>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => envScan.reset()}
                  className="h-8 text-xs font-body"
                >
                  Back
                </Button>
                <Button
                  type="button"
                  className="h-8 text-xs font-body bg-foreground text-background hover:bg-foreground/90"
                  onClick={() => {
                    if (!envScan.parseAndMap()) {
                      toast.error(t('deploy.dialog.noValidPairs'));
                    }
                  }}
                >
                  {t('deploy.dialog.parseAndMap')}
                </Button>
              </div>
            </div>
          </div>
        )}

        {envScan.envStep === 'summary' && (
          <div className="space-y-4">
            <div className="max-h-64 overflow-y-auto space-y-4 pr-1">
              {envScan.matchedVars.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-green-500">
                    <span>&#x2713;</span>
                    <span>
                      {envScan.matchedVars.length} {t('deploy.dialog.varsMatched')}
                    </span>
                  </div>
                  {envScan.matchedVars.map((v) => (
                    <div key={v.key} className="flex items-center gap-2">
                      <label className="text-xs font-mono text-secondary-ol min-w-0 shrink-0 max-w-[140px] truncate">
                        {v.key}
                      </label>
                      <Input
                        className="h-7 text-xs font-mono flex-1 bg-bg-subtle border-[hsl(var(--border))]"
                        value={envScan.editedValues[v.key] ?? v.value}
                        onChange={(e) =>
                          envScan.setEditedValues((prev) => ({
                            ...prev,
                            [v.key]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {envScan.missingVars.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-500">
                    <span>&#x26A0;</span>
                    <span>
                      {envScan.missingVars.length} {t('deploy.dialog.varsMissing')}
                    </span>
                  </div>
                  {envScan.missingVars.map((v) => (
                    <div key={v.key} className="flex items-center gap-2">
                      <label className="text-xs font-mono text-secondary-ol min-w-0 shrink-0 max-w-[140px] truncate">
                        {v.key}
                      </label>
                      <Input
                        className="h-7 text-xs font-mono flex-1 bg-bg-subtle border-[hsl(var(--border))]"
                        placeholder={`Value for ${v.key}`}
                        value={envScan.missingValues[v.key] ?? ''}
                        onChange={(e) =>
                          envScan.setMissingValues((prev) => ({
                            ...prev,
                            [v.key]: e.target.value,
                          }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {envScan.extraVars.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-secondary-ol">
                    <span>+</span>
                    <span>
                      {envScan.extraVars.length} {t('deploy.dialog.varsExtra')}
                    </span>
                  </div>
                  {envScan.extraVars.map((v) => (
                    <div key={v.key} className="flex items-center gap-2">
                      <label className="text-xs font-mono text-secondary-ol min-w-0 shrink-0 max-w-[140px] truncate">
                        {v.key}
                      </label>
                      <span className="text-xs font-mono text-secondary-ol truncate flex-1">
                        {v.value || '(empty)'}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-secondary-ol hover:text-error transition-colors shrink-0"
                        onClick={() => envScan.removeExtra(v.key)}
                      >
                        &#x2715;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => envScan.goBackToPaste()}
                className="flex-1 h-8 text-xs font-body"
              >
                {t('deploy.dialog.rePaste')}
              </Button>
              <Button
                onClick={() => void onDeployWithVars(envScan.buildFinalVars())}
                className="flex-1 h-8 text-xs font-body bg-foreground text-background hover:bg-foreground/90"
              >
                Deploy
              </Button>
            </div>
          </div>
        )}

        {envScan.envStep === 'idle' && (
          <>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-medium text-primary-ol">Environment</label>
                <Select value={environment} onValueChange={onEnvironmentChange}>
                  <SelectTrigger className="h-8 text-xs bg-bg-subtle border-[hsl(var(--border))]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="production">Production</SelectItem>
                    <SelectItem value="development">Development</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium text-primary-ol">Branch</label>
                <Input
                  value={branch}
                  onChange={(e) => onBranchChange(e.target.value)}
                  className="h-8 text-xs bg-bg-subtle border-[hsl(var(--border))]"
                />
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={onCancel} className="flex-1 h-8 text-xs font-body">
                Cancel
              </Button>
              <Button
                onClick={onConfirmDeploy}
                className="flex-1 h-8 text-xs font-body bg-foreground text-background hover:bg-foreground/90"
              >
                Deploy Project
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
