import { useState } from 'react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/context';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deployProject, scanEnvVars, type EnvVarInfo } from '@/lib/api';

interface DeployDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeploySuccess: () => void;
}

type Step = 'form' | 'scanning' | 'env-review' | 'deploying';

export function DeployDialog({ open, onOpenChange, onDeploySuccess }: DeployDialogProps) {
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [name, setName] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);
  const [envVars, setEnvVars] = useState<EnvVarInfo[]>([]);
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const { t } = useLanguage();

  const reset = () => {
    setRepoUrl('');
    setBranch('');
    setName('');
    setStep('form');
    setError(null);
    setEnvVars([]);
    setEnvValues({});
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

    try {
      const result = await scanEnvVars(repoUrl, branch || undefined);
      if (result.vars.length === 0) {
        await doDeploy({});
      } else {
        setEnvVars(result.vars);
        const initial: Record<string, string> = {};
        for (const v of result.vars) initial[v.key] = '';
        setEnvValues(initial);
        setStep('env-review');
      }
    } catch {
      await doDeploy({});
    }
  };

  const handleDeploy = async (e: React.FormEvent) => {
    e.preventDefault();
    await doDeploy(envValues);
  };

  const doDeploy = async (vars: Record<string, string>) => {
    setStep('deploying');
    setError(null);

    const filtered: Record<string, string> = {};
    for (const [k, v] of Object.entries(vars)) {
      if (v.trim()) filtered[k] = v.trim();
    }

    try {
      await deployProject(repoUrl, branch || undefined, name || undefined, filtered);
      reset();
      onDeploySuccess();
      onOpenChange(false);
      toast.success('Project deployed');
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('deploy.dialog.failed');
      setError(msg);
      toast.error('Deploy failed: ' + msg);
      setStep('env-review');
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent side="left" className="w-[400px] sm:w-[540px]">
        <SheetHeader>
          <SheetTitle>{t('deploy.dialog.title')}</SheetTitle>
          <SheetDescription>{t('deploy.dialog.description')}</SheetDescription>
        </SheetHeader>

        {/* Step: form */}
        {step === 'form' && (
          <form onSubmit={handleScan} className="space-y-4 py-4">
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
            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => handleClose(false)}>
                {'Cancel'}
              </Button>
              <Button
                type="submit"
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                {'Deploy'}
              </Button>
            </SheetFooter>
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

        {/* Step: env-review */}
        {step === 'env-review' && (
          <form onSubmit={handleDeploy} className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              {`Found ${String(envVars.length)} environment variable${envVars.length !== 1 ? 's' : ''} used in this project.`}
            </div>
            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {envVars.map((v) => (
                <div key={v.key} className="space-y-1">
                  <label className="text-sm font-medium font-mono">{v.key}</label>
                  <Input
                    placeholder={`Value for ${v.key}`}
                    value={envValues[v.key] ?? ''}
                    onChange={(e) => setEnvValues((prev) => ({ ...prev, [v.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            {error && <div className="text-sm text-red-500">{error}</div>}
            <SheetFooter>
              <Button type="button" variant="outline" onClick={() => setStep('form')}>
                {'Back'}
              </Button>
              <Button
                type="submit"
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                {'Deploy'}
              </Button>
            </SheetFooter>
          </form>
        )}

        {/* Step: deploying */}
        {step === 'deploying' && (
          <div className="py-8 text-center space-y-2">
            <div className="text-sm text-muted-foreground">{'Starting deployment...'}</div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
