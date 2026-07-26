import { useCallback, useEffect, useState } from 'react';
import { KeyRound, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { GitCredentialWizard } from '@/components/git-credentials/GitCredentialWizard';
import { OuterCard } from '@/components/Shell/OuterCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useLanguage } from '@/i18n/context';
import {
  listGitCredentials,
  removeGitCredential,
  verifyGitCredential,
  type GitCredential,
  type GitCredentialStatus,
} from '@/lib/api/git-credentials';
import { localizeApiError } from '@/lib/localized-api-error';

export function SSHKeysSettings() {
  const { language, t } = useLanguage();
  const [credentials, setCredentials] = useState<GitCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<GitCredential | null>(null);
  const [workingId, setWorkingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCredentials(await listGitCredentials());
    } catch (err) {
      setError(localizeApiError(err, t, 'repositoryKeys.errors.load', 'common.errors.codes'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleVerify(credential: GitCredential) {
    setWorkingId(credential.id);
    try {
      const verified = await verifyGitCredential(credential.id);
      setCredentials((current) =>
        current.map((item) => (item.id === verified.id ? verified : item)),
      );
      if (verified.status === 'verified') toast.success(t('repositoryKeys.messages.verified'));
    } catch (err) {
      toast.error(localizeApiError(err, t, 'repositoryKeys.errors.verify', 'common.errors.codes'));
      await load();
    } finally {
      setWorkingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget || deleteTarget.usage_count > 0) return;
    setWorkingId(deleteTarget.id);
    try {
      await removeGitCredential(deleteTarget.id);
      setCredentials((current) => current.filter((item) => item.id !== deleteTarget.id));
      setDeleteTarget(null);
      toast.success(t('repositoryKeys.messages.deleted'));
    } catch (err) {
      toast.error(localizeApiError(err, t, 'repositoryKeys.errors.delete', 'common.errors.codes'));
    } finally {
      setWorkingId(null);
    }
  }

  const locale = language === 'ko' ? 'ko-KR' : 'en-US';

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <OuterCard
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-[color:var(--ol-fg-muted)]" />
            {t('repositoryKeys.title')}
          </span>
        }
        subtitle={t('repositoryKeys.subtitle')}
        actions={
          <Button type="button" size="sm" onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4" />
            {t('repositoryKeys.actions.add')}
          </Button>
        }
      >
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-center justify-between gap-3 rounded-md border border-[color:var(--ol-error)] bg-[color:var(--ol-error-soft)] px-3 py-2 text-[12.5px] text-[color:var(--ol-error)]"
          >
            <span>{error}</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
              <RefreshCw className="h-3.5 w-3.5" />
              {t('repositoryKeys.actions.retry')}
            </Button>
          </div>
        )}

        {loading ? (
          <div
            className="grid min-h-40 place-items-center"
            aria-label={t('repositoryKeys.loading')}
          >
            <Loader2 className="h-5 w-5 animate-spin text-[color:var(--ol-fg-muted)]" />
          </div>
        ) : credentials.length === 0 ? (
          <div className="rounded-md border border-dashed border-[color:var(--ol-border-strong)] px-6 py-10 text-center">
            <KeyRound className="mx-auto h-7 w-7 text-[color:var(--ol-fg-subtle)]" />
            <p className="mt-3 text-[13px] font-medium">{t('repositoryKeys.empty.title')}</p>
            <p className="mt-1 text-[12px] text-[color:var(--ol-fg-muted)]">
              {t('repositoryKeys.empty.body')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-left text-[12px]">
              <thead className="text-[color:var(--ol-fg-muted)]">
                <tr className="border-b border-[color:var(--ol-border-subtle)]">
                  <th className="px-2 py-2 font-medium">
                    {t('repositoryKeys.columns.repository')}
                  </th>
                  <th className="px-2 py-2 font-medium">{t('repositoryKeys.columns.status')}</th>
                  <th className="px-2 py-2 font-medium">
                    {t('repositoryKeys.columns.fingerprint')}
                  </th>
                  <th className="px-2 py-2 font-medium">{t('repositoryKeys.columns.activity')}</th>
                  <th className="px-2 py-2 font-medium">{t('repositoryKeys.columns.services')}</th>
                  <th className="px-2 py-2 text-right font-medium">
                    {t('repositoryKeys.columns.actions')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {credentials.map((credential) => (
                  <tr
                    key={credential.id}
                    className="border-b border-[color:var(--ol-border-subtle)] last:border-0"
                  >
                    <td className="px-2 py-3 align-top">
                      <div className="font-medium text-[color:var(--ol-fg)]">{credential.name}</div>
                      <a
                        href={credential.repository_url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block font-mono text-[11px] text-[color:var(--ol-primary)] hover:underline"
                      >
                        {credential.repository_key}
                      </a>
                    </td>
                    <td className="px-2 py-3 align-top">
                      <StatusBadge status={credential.status} t={t} />
                    </td>
                    <td className="px-2 py-3 align-top font-mono text-[11px]">
                      {credential.fingerprint}
                    </td>
                    <td className="px-2 py-3 align-top text-[11px] text-[color:var(--ol-fg-muted)]">
                      <div>
                        {t('repositoryKeys.activity.verified')}:{' '}
                        {formatDate(credential.verified_at, locale)}
                      </div>
                      <div>
                        {t('repositoryKeys.activity.used')}:{' '}
                        {formatDate(credential.last_used_at, locale)}
                      </div>
                    </td>
                    <td className="px-2 py-3 align-top">
                      {credential.services.length > 0 ? (
                        <div className="flex max-w-44 flex-wrap gap-1">
                          {credential.services.map((service) => (
                            <Badge
                              key={service.service_id}
                              variant="neutral"
                              className="max-w-full truncate text-[10px]"
                            >
                              {service.project_id}/{service.service_name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[color:var(--ol-fg-subtle)]">—</span>
                      )}
                    </td>
                    <td className="px-2 py-3 align-top">
                      <div className="flex justify-end gap-1">
                        {credential.status !== 'verified' && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={workingId === credential.id}
                            onClick={() => void handleVerify(credential)}
                          >
                            {workingId === credential.id && (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            )}
                            {t('repositoryKeys.actions.verify')}
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          title={
                            credential.usage_count > 0
                              ? t('repositoryKeys.delete.inUse')
                              : t('repositoryKeys.actions.delete')
                          }
                          disabled={credential.usage_count > 0 || workingId === credential.id}
                          onClick={() => setDeleteTarget(credential)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </OuterCard>

      <GitCredentialWizard
        open={wizardOpen}
        onOpenChange={(open) => {
          setWizardOpen(open);
          if (!open) void load();
        }}
        onComplete={(credential) =>
          setCredentials((current) => [
            credential,
            ...current.filter((item) => item.id !== credential.id),
          ])
        }
      />

      <Dialog open={deleteTarget != null} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent className="max-w-md border-[color:var(--ol-border)] bg-[color:var(--ol-panel)]">
          <DialogHeader>
            <DialogTitle>{t('repositoryKeys.delete.title')}</DialogTitle>
            <DialogDescription>
              {t('repositoryKeys.delete.body', { name: deleteTarget?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && deleteTarget.services.length > 0 && (
            <div className="rounded-md border border-[color:var(--ol-warning)] bg-[color:var(--ol-warning-soft)] px-3 py-2 text-[12px]">
              <p className="font-medium">{t('repositoryKeys.delete.inUse')}</p>
              <ul className="mt-1 list-inside list-disc">
                {deleteTarget.services.map((service) => (
                  <li key={service.service_id}>
                    {service.project_id}/{service.service_name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)}>
              {t('repositoryKeys.actions.cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={
                !deleteTarget || deleteTarget.usage_count > 0 || workingId === deleteTarget.id
              }
              onClick={() => void handleDelete()}
            >
              {t('repositoryKeys.actions.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function StatusBadge({ status, t }: { status: GitCredentialStatus; t: (key: string) => string }) {
  const variant = status === 'verified' ? 'green' : status === 'failed' ? 'red' : 'yellow';
  return <Badge variant={variant}>{t(`repositoryKeys.status.${status}`)}</Badge>;
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

export default SSHKeysSettings;
