import { type FormEvent, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useLanguage } from '@/i18n/context';
import {
  createGitCredential,
  verifyGitCredential,
  type GitCredential,
} from '@/lib/api/git-credentials';

interface GitCredentialWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialRepoUrl?: string;
  onComplete: (credential: GitCredential) => void;
}

export function GitCredentialWizard({
  open,
  onOpenChange,
  initialRepoUrl = '',
  onComplete,
}: GitCredentialWizardProps) {
  const { t } = useLanguage();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [repoUrl, setRepoUrl] = useState(initialRepoUrl);
  const [name, setName] = useState('');
  const [credential, setCredential] = useState<GitCredential | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setRepoUrl(initialRepoUrl);
    setName('');
    setCredential(null);
    setBusy(false);
    setCopied(false);
    setError(null);
  }, [initialRepoUrl, open]);

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!repoUrl.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createGitCredential({
        repoUrl: repoUrl.trim(),
        name: name.trim() || undefined,
      });
      setCredential(created);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('repositoryKeys.errors.create'));
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!credential) return;
    try {
      await navigator.clipboard.writeText(credential.public_key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError(t('repositoryKeys.errors.copy'));
    }
  }

  async function handleVerify() {
    if (!credential || busy) return;
    setBusy(true);
    setError(null);
    try {
      const verified = await verifyGitCredential(credential.id);
      setCredential(verified);
      if (verified.status !== 'verified') {
        setError(t('repositoryKeys.errors.notAuthorized'));
        return;
      }
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('repositoryKeys.errors.verify'));
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    if (!credential || credential.status !== 'verified') return;
    onComplete(credential);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[620px] border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]">
        <DialogHeader>
          <DialogTitle>{t('repositoryKeys.wizard.title')}</DialogTitle>
          <DialogDescription>
            {t('repositoryKeys.wizard.step', { current: step, total: 3 })}
          </DialogDescription>
        </DialogHeader>

        {step === 1 && (
          <form className="flex flex-col gap-4" onSubmit={(event) => void handleCreate(event)}>
            <div className="flex flex-col gap-2">
              <Label htmlFor="repository-key-repo">{t('repositoryKeys.fields.repository')}</Label>
              <Input
                id="repository-key-repo"
                value={repoUrl}
                onChange={(event) => setRepoUrl(event.target.value)}
                placeholder="https://github.com/owner/repository"
                autoFocus
                required
                className="font-mono"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="repository-key-name">{t('repositoryKeys.fields.name')}</Label>
              <Input
                id="repository-key-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t('repositoryKeys.fields.namePlaceholder')}
              />
            </div>
            {error && <ErrorMessage message={error} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('repositoryKeys.actions.cancel')}
              </Button>
              <Button type="submit" disabled={busy || !repoUrl.trim()}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('repositoryKeys.actions.generate')}
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 2 && credential && (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-bg)] p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[color:var(--ol-fg-muted)]">
                  {t('repositoryKeys.wizard.publicKey')}
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => void handleCopy()}>
                  {copied ? (
                    <Check className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <Copy className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {copied ? t('repositoryKeys.actions.copied') : t('repositoryKeys.actions.copy')}
                </Button>
              </div>
              <pre className="whitespace-pre-wrap break-all text-[11px] text-[color:var(--ol-fg)]">
                {credential.public_key}
              </pre>
            </div>
            <div className="rounded-md border border-[color:var(--ol-warning)] bg-[color:var(--ol-warning-soft)] px-3 py-2 text-[12.5px] text-[color:var(--ol-fg)]">
              {t('repositoryKeys.wizard.readOnlyWarning')}
            </div>
            <a
              href={credential.github_setup_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex w-fit items-center gap-1.5 text-[13px] text-[color:var(--ol-primary)] hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              {t('repositoryKeys.actions.openGitHub')}
            </a>
            {error && <ErrorMessage message={error} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('repositoryKeys.actions.finishLater')}
              </Button>
              <Button type="button" onClick={() => void handleVerify()} disabled={busy}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {t('repositoryKeys.actions.verify')}
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 3 && credential && (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-[color:var(--ol-success)] bg-[color:var(--ol-success-soft)] px-4 py-4">
              <div className="flex items-center gap-2 font-medium text-[color:var(--ol-success)]">
                <Check className="h-4 w-4" />
                {t('repositoryKeys.wizard.verifiedTitle')}
              </div>
              <p className="mt-2 text-[12.5px] text-[color:var(--ol-fg-muted)]">
                {t('repositoryKeys.wizard.verifiedBody', { repository: credential.repository_key })}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" onClick={finish} autoFocus>
                {t('repositoryKeys.actions.done')}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-md border border-[color:var(--ol-error)] bg-[color:var(--ol-error-soft)] px-3 py-2 text-[12.5px] text-[color:var(--ol-error)]"
    >
      {message}
    </div>
  );
}
