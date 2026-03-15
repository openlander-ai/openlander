import { useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/context';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { deployProject } from '@/lib/api';
import { useEnvScanFlow } from '@/hooks/use-env-scan-flow';

interface DeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeploySuccess: () => void;
}

type Step = 'form' | 'scanning' | 'env-review' | 'deploying';

export function DeployDialog({ open, onOpenChange, onDeploySuccess }: DeployDialogProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [environment, setEnvironment] = useState<string>('production');
  const [branch, setBranch] = useState('main');
  const [name, setName] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const { t } = useLanguage();

  const {
    envStep,
    envVars,
    pasteText,
    setPasteText,
    matchedVars,
    missingVars,
    extraVars,
    missingValues,
    setMissingValues,
    editedValues,
    setEditedValues,
    startScan,
    parseAndMap,
    removeExtra,
    buildFinalVars,
    goBackToPaste,
    reset: resetEnvFlow,
  } = useEnvScanFlow();

  const reset = () => {
    setRepoUrl('');
    setEnvironment('production');
    setBranch('main');
    setName('');
    setStep('form');
    setError(null);
    resetEnvFlow();
  };

  const handleEnvironmentChange = (value: string) => {
    setEnvironment(value);
  };

  const handleClose = (open: boolean) => {
    if (!open) reset();
    onOpenChange(open);
  };

  const handleScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoUrl) return;
    setError(null);
    setStep('scanning');

    const hasVars = await startScan(repoUrl, branch || undefined);
    if (!hasVars) {
      await doDeploy({});
    } else {
      setStep('env-review');
    }
  };

  const handleParseAndMap = () => {
    if (!pasteText.trim()) {
      // Empty paste = skip
      void doDeploy({});
      return;
    }

    const success = parseAndMap();
    if (!success) {
      toast.error(t('deploy.dialog.noValidPairs'));
    }
  };

  const handleRemoveExtra = (key: string) => {
    removeExtra(key);
  };

  const handleDeployFromSummary = async () => {
    const vars = buildFinalVars();
    await doDeploy(vars);
  };

  const doDeploy = async (vars: Record<string, string>) => {
    setStep('deploying');
    setError(null);

    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
      if (v.trim()) filtered[k] = v.trim();
    }

    try {
      await deployProject(repoUrl, branch || undefined, name || undefined, filtered, environment);
      reset();
      onDeploySuccess();
      onOpenChange(false);
      toast.success('Project deployed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('deploy.dialog.failed');
      setError(msg);
      toast.error('Deploy failed: ' + msg);
      if (envVars.length > 0) {
        setStep('env-review');
      } else {
        setStep('form');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {step === 'env-review' && envStep === 'paste'
              ? t('deploy.dialog.pasteEnvTitle')
              : t('deploy.dialog.title')}
          </DialogTitle>
          <DialogDescription>
            {step === 'env-review' && envStep === 'paste'
              ? t('deploy.dialog.pasteEnvDescription')
              : t('deploy.dialog.description')}
          </DialogDescription>
        </DialogHeader>

        {/* Step: form */}
        {step === 'form' && (
          <form onSubmit={handleScan} className="space-y-4 py-2">
            <div className="space-y-2">
              <label
                htmlFor="repo-url"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {'Repository URL'}
              </label>
              <Input
                id="repo-url"
                placeholder="github.com/user/repo"
                value={repoUrl}
                onChange={(e) => setRepoUrl(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="environment"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {'Environment'}
              </label>
              <Select value={environment} onValueChange={handleEnvironmentChange}>
                <SelectTrigger id="environment">
                  <SelectValue placeholder="Select environment" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="development">Development</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label
                htmlFor="branch"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {'Branch (Optional)'}
              </label>
              <Input
                id="branch"
                placeholder="main"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="name"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                {t('deploy.dialog.projectName')}
              </label>
              <Input
                id="name"
                placeholder={t('deploy.dialog.autoDetected')}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            {error && <div className="text-sm text-red-500">{error}</div>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                {'Cancel'}
              </Button>
              <Button
                type="submit"
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                {'Deploy'}
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* Step: scanning */}
        {step === 'scanning' && (
          <div className="py-8 text-center space-y-2">
            <div className="text-sm text-muted-foreground">
              {'Scanning for environment variables...'}
            </div>
          </div>
        )}

        {/* Step: env-review — paste phase */}
        {step === 'env-review' && envStep === 'paste' && (
          <div className="space-y-4 py-2">
            <div className="text-xs text-muted-foreground">
              {`Found ${String(envVars.length)} environment variable${envVars.length !== 1 ? 's' : ''} used in this project.`}
            </div>
            <textarea
              className="w-full rounded-md px-3 py-2 text-xs font-mono bg-bg-app border border-border text-primary-ol placeholder:text-muted-ol resize-none focus:outline-none focus:ring-1 focus:ring-agent/40"
              rows={8}
              placeholder={t('deploy.dialog.pasteEnvPlaceholder')}
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <DialogFooter className="flex items-center justify-between">
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-primary-ol transition-colors"
                onClick={() => void doDeploy({})}
              >
                {t('deploy.dialog.skipEnvVars')}
              </button>
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setStep('form')}>
                  {'Back'}
                </Button>
                <Button
                  type="button"
                  className="bg-foreground text-background hover:bg-foreground/90"
                  onClick={handleParseAndMap}
                >
                  {t('deploy.dialog.parseAndMap')}
                </Button>
              </div>
            </DialogFooter>
          </div>
        )}

        {/* Step: env-review — summary phase */}
        {step === 'env-review' && envStep === 'summary' && (
          <div className="space-y-3 py-2">
            <div className="max-h-64 overflow-y-auto space-y-3 pr-1">
              {/* Matched section */}
              {matchedVars.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-green-500">
                    <span>{'✓'}</span>
                    <span>
                      {matchedVars.length} {t('deploy.dialog.varsMatched')}
                    </span>
                  </div>
                  {matchedVars.map((v) => (
                    <div key={v.key} className="flex items-center gap-2">
                      <label className="text-xs font-mono text-muted-foreground min-w-0 shrink-0 max-w-[140px] truncate">
                        {v.key}
                      </label>
                      <Input
                        className="h-7 text-xs font-mono flex-1"
                        value={editedValues[v.key] ?? v.value}
                        onChange={(e) =>
                          setEditedValues((prev) => ({ ...prev, [v.key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Missing section */}
              {missingVars.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-amber-500">
                    <span>{'⚠'}</span>
                    <span>
                      {missingVars.length} {t('deploy.dialog.varsMissing')}
                    </span>
                  </div>
                  {missingVars.map((v) => (
                    <div key={v.key} className="flex items-center gap-2">
                      <label className="text-xs font-mono text-muted-foreground min-w-0 shrink-0 max-w-[140px] truncate">
                        {v.key}
                      </label>
                      <Input
                        className="h-7 text-xs font-mono flex-1"
                        placeholder={`Value for ${v.key}`}
                        value={missingValues[v.key] ?? ''}
                        onChange={(e) =>
                          setMissingValues((prev) => ({ ...prev, [v.key]: e.target.value }))
                        }
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Extra section */}
              {extraVars.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <span>{'+'}</span>
                    <span>
                      {extraVars.length} {t('deploy.dialog.varsExtra')}
                    </span>
                  </div>
                  {extraVars.map((v) => (
                    <div key={v.key} className="flex items-center gap-2">
                      <label className="text-xs font-mono text-muted-foreground min-w-0 shrink-0 max-w-[140px] truncate">
                        {v.key}
                      </label>
                      <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                        {v.value || '(empty)'}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-red-500 transition-colors shrink-0"
                        onClick={() => handleRemoveExtra(v.key)}
                      >
                        {'✕'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {error && <div className="text-sm text-red-500">{error}</div>}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => goBackToPaste()}>
                {t('deploy.dialog.rePaste')}
              </Button>
              <Button
                type="button"
                className="bg-foreground text-background hover:bg-foreground/90"
                onClick={() => void handleDeployFromSummary()}
              >
                {'Deploy'}
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Step: deploying */}
        {step === 'deploying' && (
          <div className="py-8 text-center space-y-2">
            <div className="text-sm text-muted-foreground">{'Starting deployment...'}</div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
