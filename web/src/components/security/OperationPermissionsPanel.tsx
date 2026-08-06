import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Database, ShieldCheck } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useLanguage } from '@/i18n/context';
import {
  getOperationPermissions,
  updateOperationPermissions,
  type DatabaseAccessPermission,
  type DestructiveActionPermission,
  type OperationPermissionResponse,
  type OperationPermissionScope,
} from '@/lib/api/security-permissions';
import { localizeApiError } from '@/lib/localized-api-error';

type InheritableDestructivePermission = DestructiveActionPermission | 'inherit';
type InheritableDatabasePermission = DatabaseAccessPermission | 'inherit';

interface OperationPermissionsPanelProps {
  scope: OperationPermissionScope;
  targetId?: string;
}

export function OperationPermissionsPanel({ scope, targetId }: OperationPermissionsPanelProps) {
  const { t } = useLanguage();
  const [response, setResponse] = useState<OperationPermissionResponse | null>(null);
  const [destructive, setDestructive] = useState<InheritableDestructivePermission>('inherit');
  const [databaseAccess, setDatabaseAccess] = useState<InheritableDatabasePermission>('inherit');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const applyResponse = useCallback(
    (next: OperationPermissionResponse) => {
      setResponse(next);
      const selectedOverride =
        scope === 'global'
          ? next.permissions.global
          : scope === 'project'
            ? next.permissions.project_override
            : next.permissions.service_override;
      setDestructive(selectedOverride?.destructive_actions ?? 'inherit');
      setDatabaseAccess(selectedOverride?.database_access ?? 'inherit');
    },
    [scope],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setResponse(null);
    setError(null);
    void getOperationPermissions(scope, targetId)
      .then((next) => {
        if (active) applyResponse(next);
      })
      .catch((cause) => {
        if (active) {
          setError(
            localizeApiError(cause, t, 'securityPermissions.loadFailed', 'common.apiError.codes'),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applyResponse, scope, t, targetId]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const next = await updateOperationPermissions(
        scope,
        {
          destructive_actions: destructive === 'inherit' ? null : destructive,
          database_access: databaseAccess === 'inherit' ? null : databaseAccess,
        },
        targetId,
      );
      applyResponse(next);
      setSaved(true);
    } catch (cause) {
      setError(
        localizeApiError(cause, t, 'securityPermissions.saveFailed', 'common.apiError.codes'),
      );
    } finally {
      setSaving(false);
    }
  };

  const effective = response?.permissions.effective;
  const allowInherit = scope !== 'global';

  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
      {loading ? (
        <p className="text-xs text-foreground/60">{t('securityPermissions.loading')}</p>
      ) : response ? (
        <>
          <PermissionRow
            icon={<ShieldCheck className="h-4 w-4" />}
            title={t('securityPermissions.destructive.title')}
            description={t('securityPermissions.destructive.description')}
            value={destructive}
            onChange={(value) => {
              setDestructive(value as InheritableDestructivePermission);
              setSaved(false);
            }}
            effectiveLabel={
              effective
                ? t(`securityPermissions.options.${effective.destructive_actions}`)
                : undefined
            }
            allowInherit={allowInherit}
            options={['allow', 'approval_required', 'block']}
          />
          <PermissionRow
            icon={<Database className="h-4 w-4" />}
            title={t('securityPermissions.database.title')}
            description={t('securityPermissions.database.description')}
            value={databaseAccess}
            onChange={(value) => {
              setDatabaseAccess(value as InheritableDatabasePermission);
              setSaved(false);
            }}
            effectiveLabel={
              effective ? t(`securityPermissions.options.${effective.database_access}`) : undefined
            }
            allowInherit={allowInherit}
            options={['allow', 'block']}
          />
        </>
      ) : null}

      {error ? <p className="text-xs text-error">{error}</p> : null}
      {saved ? <p className="text-xs text-success">{t('securityPermissions.saved')}</p> : null}
      {!loading && response ? (
        <div>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? t('securityPermissions.saving') : t('securityPermissions.save')}
          </Button>
        </div>
      ) : null}
    </form>
  );
}

function PermissionRow({
  icon,
  title,
  description,
  value,
  onChange,
  effectiveLabel,
  allowInherit,
  options,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  effectiveLabel?: string;
  allowInherit: boolean;
  options: string[];
}) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 text-foreground/60">{icon}</span>
        <div>
          <p className="text-sm font-medium text-foreground">{title}</p>
          <p className="mt-1 text-xs leading-5 text-foreground/70">{description}</p>
          {allowInherit && effectiveLabel ? (
            <p className="mt-1 text-[11px] text-foreground/60">
              {t('securityPermissions.effective', { value: effectiveLabel })}
            </p>
          ) : null}
        </div>
      </div>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 min-w-44 rounded-md border border-[hsl(var(--border))] bg-bg-subtle px-3 text-xs text-foreground"
      >
        {allowInherit ? <option value="inherit">{t('securityPermissions.inherit')}</option> : null}
        {options.map((option) => (
          <option key={option} value={option}>
            {t(`securityPermissions.options.${option}`)}
          </option>
        ))}
      </select>
    </div>
  );
}
