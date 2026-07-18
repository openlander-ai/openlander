import { type FormEvent, type ReactNode, useEffect, useState } from 'react';
import { Github, Image, KeyRound, Layers, Loader2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/i18n/context';
import { deployService } from '@/lib/api';
import { deriveServiceName } from '@/lib/service-name';
import { cn } from '@/lib/utils';
import { GitCredentialWizard } from '@/components/git-credentials/GitCredentialWizard';
import { listGitCredentials, type GitCredential } from '@/lib/api/git-credentials';
import { selectMatchingGitCredential } from '@/lib/git-credential-selection';

type SourceKind = 'git' | 'image' | 'template';

interface AddServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  displayName: string;
  onCreated: () => void;
}

export function AddServiceDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  displayName,
  onCreated,
}: AddServiceDialogProps) {
  const { t } = useLanguage();
  const [source, setSource] = useState<SourceKind>('git');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serviceName, setServiceName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [dockerfilePath, setDockerfilePath] = useState('');
  const [dockerTarget, setDockerTarget] = useState('');
  const [buildContext, setBuildContext] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [port, setPort] = useState('');
  const [gitCredentialId, setGitCredentialId] = useState('');
  const [matchingCredentials, setMatchingCredentials] = useState<GitCredential[]>([]);
  const [credentialLoading, setCredentialLoading] = useState(false);
  const [credentialWizardOpen, setCredentialWizardOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
  }, [open]);

  useEffect(() => {
    if (source !== 'git' || !repoUrl.trim()) {
      setMatchingCredentials([]);
      setGitCredentialId('');
      setCredentialLoading(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setCredentialLoading(true);
      void listGitCredentials({ repoUrl: repoUrl.trim() })
        .then((credentials) => {
          if (cancelled) return;
          setMatchingCredentials(credentials);
          setGitCredentialId((current) => selectMatchingGitCredential(credentials, current));
        })
        .catch(() => {
          if (!cancelled) {
            setMatchingCredentials([]);
            setGitCredentialId('');
          }
        })
        .finally(() => {
          if (!cancelled) setCredentialLoading(false);
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [repoUrl, source]);

  const inferredName =
    source === 'git' ? deriveServiceName(repoUrl, 'git') : deriveServiceName(imageUrl, 'image');
  const effectiveServiceName = serviceName.trim() || inferredName;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (source === 'template') {
      toast.info(t('projectDetail.addService.templateSoon'));
      return;
    }
    if (!effectiveServiceName) {
      setError(t('projectDetail.addService.errorName'));
      return;
    }
    if (source === 'git' && !repoUrl.trim()) {
      setError(t('projectDetail.addService.errorRepo'));
      return;
    }
    if (
      source === 'git' &&
      matchingCredentials.filter((credential) => credential.status === 'verified').length > 1 &&
      !gitCredentialId
    ) {
      setError(t('repositoryKeys.picker.selectionRequired'));
      return;
    }
    if (source === 'image' && !imageUrl.trim()) {
      setError(t('projectDetail.addService.errorImage'));
      return;
    }

    const parsedPort = port.trim() ? Number(port.trim()) : undefined;
    if (
      parsedPort != null &&
      (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535)
    ) {
      setError(t('projectDetail.addService.errorPort'));
      return;
    }

    setSubmitting(true);
    try {
      const result =
        source === 'git'
          ? await deployService({
              source: 'git',
              projectId,
              projectName,
              serviceName: effectiveServiceName,
              repoUrl: repoUrl.trim(),
              branch: branch.trim() || null,
              dockerfilePath: dockerfilePath.trim() || undefined,
              dockerTarget: dockerTarget.trim() || undefined,
              buildContext: buildContext.trim() || undefined,
              gitCredentialId: gitCredentialId || undefined,
            })
          : await deployService({
              source: 'image',
              projectId,
              projectName,
              serviceName: effectiveServiceName,
              imageUrl: imageUrl.trim(),
              port: parsedPort,
            });

      if (!result.success) {
        throw new Error(result.error ?? t('projectDetail.addService.errorCreate'));
      }

      toast.success(
        t('projectDetail.addService.success', {
          name: result.serviceName ?? effectiveServiceName,
        }),
      );
      onCreated();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('projectDetail.addService.errorCreate'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[560px] border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] p-0">
        <form onSubmit={(event) => void handleSubmit(event)}>
          <DialogHeader className="border-b border-[color:var(--ol-border-subtle)] px-5 py-4">
            <DialogTitle className="text-[17px]">{t('projectDetail.addService.title')}</DialogTitle>
            <DialogDescription className="text-[13px]">
              {t('projectDetail.addService.descriptionPrefix')}{' '}
              <span className="ol-mono rounded bg-[color:var(--ol-panel-2)] px-1.5 py-0.5 text-[11.5px] text-[color:var(--ol-fg)]">
                {displayName}
              </span>{' '}
              {t('projectDetail.addService.descriptionSuffix')}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 px-5 py-4">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3" role="radiogroup">
              <SourceCard
                value="git"
                current={source}
                label={t('projectDetail.addService.git')}
                description={t('projectDetail.addService.gitDescription')}
                icon={<Github className="h-4 w-4" />}
                onPick={setSource}
              />
              <SourceCard
                value="image"
                current={source}
                label={t('projectDetail.addService.image')}
                description={t('projectDetail.addService.imageDescription')}
                icon={<Image className="h-4 w-4" />}
                onPick={setSource}
              />
              <SourceCard
                value="template"
                current={source}
                label={t('projectDetail.addService.template')}
                description={t('projectDetail.addService.templateDescription')}
                tag={t('projectDetail.addService.soon')}
                icon={<Layers className="h-4 w-4" />}
                onPick={setSource}
              />
            </div>

            {source === 'template' ? (
              <div className="rounded-lg border border-dashed border-[color:var(--ol-border-strong)] bg-[color:var(--ol-panel-2)] px-4 py-6 text-center text-[13px] text-[color:var(--ol-fg-muted)]">
                {t('projectDetail.addService.templateBody')}
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <Field
                  label={t('projectDetail.addService.serviceName')}
                  hint={t('projectDetail.addService.serviceNameHint', {
                    path: `${projectName}/${effectiveServiceName || 'service'}`,
                  })}
                >
                  <Input
                    value={serviceName}
                    onChange={(event) => setServiceName(event.target.value)}
                    placeholder={
                      source === 'git' ? inferredName || 'my-api' : inferredName || 'postgres'
                    }
                    className="border-[color:var(--ol-border)] bg-[color:var(--ol-bg)] font-mono"
                  />
                </Field>

                {source === 'git' ? (
                  <>
                    <Field label={t('projectDetail.addService.repo')}>
                      <Input
                        value={repoUrl}
                        onChange={(event) => {
                          setRepoUrl(event.target.value);
                          if (!serviceName) setError(null);
                        }}
                        placeholder="github.com/org/repo"
                        className="border-[color:var(--ol-border)] bg-[color:var(--ol-bg)] font-mono"
                      />
                    </Field>
                    <div className="rounded-md border border-[color:var(--ol-border-subtle)] bg-[color:var(--ol-panel-2)] p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--ol-fg)]">
                          <KeyRound className="h-3.5 w-3.5" />
                          {t('repositoryKeys.picker.title')}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!repoUrl.trim()}
                          onClick={() => setCredentialWizardOpen(true)}
                        >
                          <Plus className="h-3.5 w-3.5" />
                          {t('repositoryKeys.actions.createHere')}
                        </Button>
                      </div>
                      {credentialLoading ? (
                        <div className="flex items-center gap-2 text-[11.5px] text-[color:var(--ol-fg-muted)]">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          {t('repositoryKeys.loading')}
                        </div>
                      ) : (
                        <>
                          <select
                            aria-label={t('repositoryKeys.picker.title')}
                            value={gitCredentialId}
                            onChange={(event) => setGitCredentialId(event.target.value)}
                            className="h-9 w-full rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-bg)] px-3 text-[12px] text-[color:var(--ol-fg)]"
                          >
                            <option value="">{t('repositoryKeys.picker.automatic')}</option>
                            {matchingCredentials
                              .filter((credential) => credential.status === 'verified')
                              .map((credential) => (
                                <option key={credential.id} value={credential.id}>
                                  {credential.name} · {credential.fingerprint}
                                </option>
                              ))}
                          </select>
                          <p className="mt-1.5 text-[11px] text-[color:var(--ol-fg-muted)]">
                            {matchingCredentials.filter(
                              (credential) => credential.status === 'verified',
                            ).length === 1 && gitCredentialId
                              ? t('repositoryKeys.picker.matched')
                              : matchingCredentials.filter(
                                    (credential) => credential.status === 'verified',
                                  ).length > 1
                                ? t('repositoryKeys.picker.multiple')
                                : matchingCredentials.length > 0
                                  ? t('repositoryKeys.picker.pending')
                                  : t('repositoryKeys.picker.none')}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label={t('projectDetail.addService.branch')}>
                        <Input
                          value={branch}
                          onChange={(event) => setBranch(event.target.value)}
                          placeholder="main"
                          className="border-[color:var(--ol-border)] bg-[color:var(--ol-bg)] font-mono"
                        />
                      </Field>
                      <Field label={t('projectDetail.addService.dockerfilePath')}>
                        <Input
                          value={dockerfilePath}
                          onChange={(event) => setDockerfilePath(event.target.value)}
                          placeholder="Dockerfile"
                          className="border-[color:var(--ol-border)] bg-[color:var(--ol-bg)] font-mono"
                        />
                      </Field>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label={t('projectDetail.addService.dockerTarget')}>
                        <Input
                          value={dockerTarget}
                          onChange={(event) => setDockerTarget(event.target.value)}
                          placeholder="api"
                          className="border-[color:var(--ol-border)] bg-[color:var(--ol-bg)] font-mono"
                        />
                      </Field>
                      <Field label={t('projectDetail.addService.buildContext')}>
                        <Input
                          value={buildContext}
                          onChange={(event) => setBuildContext(event.target.value)}
                          placeholder="."
                          className="border-[color:var(--ol-border)] bg-[color:var(--ol-bg)] font-mono"
                        />
                      </Field>
                    </div>
                  </>
                ) : (
                  <>
                    <Field
                      label={t('projectDetail.addService.imageReference')}
                      hint={t('projectDetail.addService.imageReferenceHint')}
                    >
                      <Input
                        value={imageUrl}
                        onChange={(event) => setImageUrl(event.target.value)}
                        placeholder="nginx:alpine"
                        className="border-[color:var(--ol-border)] bg-[color:var(--ol-bg)] font-mono"
                      />
                    </Field>
                    <Field label={t('projectDetail.addService.containerPort')}>
                      <Input
                        value={port}
                        onChange={(event) => setPort(event.target.value)}
                        placeholder="3000"
                        inputMode="numeric"
                        className="border-[color:var(--ol-border)] bg-[color:var(--ol-bg)] font-mono"
                      />
                    </Field>
                  </>
                )}
              </div>
            )}

            {error && (
              <div className="rounded-md border border-[color:var(--ol-error)]/30 bg-[color:var(--ol-error-soft)] px-3 py-2 text-[12.5px] text-[color:var(--ol-error)]">
                {error}
              </div>
            )}
          </div>

          <DialogFooter className="border-t border-[color:var(--ol-border-subtle)] px-5 py-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              {t('projectDetail.addService.cancel')}
            </Button>
            <Button type="submit" disabled={submitting || source === 'template'}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting
                ? t('projectDetail.addService.creating')
                : t('projectDetail.addService.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <GitCredentialWizard
        open={credentialWizardOpen}
        onOpenChange={setCredentialWizardOpen}
        initialRepoUrl={repoUrl.trim()}
        onComplete={(credential) => {
          setMatchingCredentials((current) => [
            credential,
            ...current.filter((item) => item.id !== credential.id),
          ]);
          setGitCredentialId(credential.id);
        }}
      />
    </Dialog>
  );
}

function SourceCard({
  value,
  current,
  label,
  description,
  icon,
  tag,
  onPick,
}: {
  value: SourceKind;
  current: SourceKind;
  label: string;
  description: string;
  icon: ReactNode;
  tag?: string;
  onPick: (value: SourceKind) => void;
}) {
  const checked = current === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={() => onPick(value)}
      className={cn(
        'flex min-h-[92px] flex-col items-start gap-1 rounded-lg border px-3 py-3 text-left transition-colors',
        checked
          ? 'border-[color:var(--ol-primary)] bg-[color:var(--ol-primary-soft)]'
          : 'border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] hover:border-[color:var(--ol-border-strong)]',
      )}
    >
      <span className="mb-1 text-[color:var(--ol-fg-muted)]">{icon}</span>
      <span className="flex items-center gap-2 text-[13px] font-semibold text-[color:var(--ol-fg)]">
        {label}
        {tag && (
          <span className="rounded bg-[color:var(--ol-panel)] px-1.5 py-0.5 text-[10px] font-medium text-[color:var(--ol-fg-muted)]">
            {tag}
          </span>
        )}
      </span>
      <span className="text-[11.5px] leading-snug text-[color:var(--ol-fg-muted)]">
        {description}
      </span>
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[color:var(--ol-fg-subtle)]">
        {label}
      </span>
      {children}
      {hint && <span className="text-[11.5px] text-[color:var(--ol-fg-muted)]">{hint}</span>}
    </label>
  );
}
