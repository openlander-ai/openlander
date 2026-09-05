import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/i18n/context';
import {
  getServiceResources,
  updateServiceResources,
  type ResourceLimitsResponse,
} from '@/lib/api/projects';
import { cn } from '@/lib/utils';

interface Props {
  projectId: string;
  serviceId: string;
  isCompose?: boolean;
  isManaged?: boolean;
  serviceStatus?: string;
}

export function ServiceResourceLimitsPanel({
  projectId,
  serviceId,
  isCompose,
  isManaged,
  serviceStatus,
}: Props) {
  const { t } = useLanguage();
  const [profile, setProfile] = useState<string | null>(null);
  const [customMb, setCustomMb] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [applied, setApplied] = useState<ResourceLimitsResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setWarnings([]);
    setApplied(null);
    setSaved(false);
    void getServiceResources(projectId, serviceId)
      .then((data) => {
        if (cancelled) return;
        setApplied(data);
        setProfile(data.profile);
        if (data.profile === 'custom' && data.memory) {
          setCustomMb(String(Math.floor(data.memory.limitBytes / 1024 / 1024)));
        } else {
          setCustomMb('');
        }
        if (data.warnings?.length) setWarnings(data.warnings);
      })
      .catch(() => {
        if (!cancelled) setError(t('resources.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, serviceId, serviceStatus, t]);

  const selectedMb =
    profile === 'custom'
      ? Number(customMb)
      : ({ micro: 256, small: 512, medium: 1024, large: 2048 }[profile ?? ''] ?? 0);
  const requiresStop =
    isManaged &&
    applied?.running &&
    selectedMb > 0 &&
    (!applied.memory || selectedMb * 1024 * 1024 < applied.memory.limitBytes);

  const handleSave = async () => {
    if (!profile || requiresStop || !applied) return;
    if (profile === 'custom') {
      const mb = Number(customMb);
      if (!Number.isInteger(mb) || mb < 64) return;
    }
    setSaving(true);
    setSaved(false);
    try {
      const result = await updateServiceResources(projectId, serviceId, {
        profile: profile as 'micro' | 'small' | 'medium' | 'large' | 'custom',
        ...(profile === 'custom' ? { memoryMb: Number(customMb) } : {}),
      });
      setApplied(result);
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError(t(isManaged ? 'resources.managedSaveFailed' : 'resources.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-foreground/80">{t('resources.loading')}</div>;
  }

  if (isCompose) {
    return (
      <div
        className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200"
        data-testid="resource-limits-compose-unsupported"
      >
        {t('resources.composeNotSupported')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {isManaged && applied && (
        <p className="text-sm font-medium" data-testid="applied-memory-limit">
          {applied.memory
            ? t('resources.appliedMemory', { mb: String(applied.memory.limitBytes / 1024 / 1024) })
            : t('resources.noLimit')}
        </p>
      )}
      {warnings.map((warning) => (
        <div
          key={warning}
          className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200"
        >
          {warning}
        </div>
      ))}

      {!profile && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
          {t('resources.noLimitWarning')}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{t('resources.profile')}</label>
        <Select
          value={profile ?? ''}
          onValueChange={setProfile}
          data-testid="resource-profile-select"
        >
          <SelectTrigger>
            <SelectValue placeholder={t('resources.noLimit')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="micro">{t('resources.profiles.micro')}</SelectItem>
            <SelectItem value="small">{t('resources.profiles.small')}</SelectItem>
            <SelectItem value="medium">{t('resources.profiles.medium')}</SelectItem>
            <SelectItem value="large">{t('resources.profiles.large')}</SelectItem>
            <SelectItem value="custom">{t('resources.profiles.custom')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {profile === 'custom' && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground">
            {t('resources.customMemory')}
          </label>
          <Input
            type="number"
            min={64}
            value={customMb}
            onChange={(e) => setCustomMb(e.target.value)}
            placeholder="512"
            data-testid="custom-memory-input"
          />
          <p className="text-xs text-foreground/80">{t('resources.customMemoryHint')}</p>
        </div>
      )}

      <p className="text-xs text-foreground/80">
        {t(isManaged ? 'resources.appliesImmediately' : 'resources.appliesOnRedeploy')}
      </p>
      {requiresStop && (
        <p role="alert" className="text-sm text-warning">
          {t('resources.stopBeforeDecrease')}
        </p>
      )}

      <Button
        onClick={handleSave}
        disabled={
          saving ||
          !applied ||
          !profile ||
          Boolean(requiresStop) ||
          (profile === 'custom' && (!Number.isInteger(selectedMb) || selectedMb < 64))
        }
        data-testid="save-resource-limits"
        className={cn(saved && 'bg-green-600 hover:bg-green-600')}
      >
        {saving
          ? t('resources.saving')
          : saved
            ? t('resources.saved')
            : t(isManaged ? 'resources.apply' : 'resources.save')}
      </Button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
