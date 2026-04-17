import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import { getProjectResources, updateProjectResources } from '@/lib/api/projects';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

interface Props {
  projectId: string;
}

export function ResourceLimitsPanel({ projectId }: Props) {
  const { t } = useLanguage();
  const [profile, setProfile] = useState<string | null>(null);
  const [customMb, setCustomMb] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getProjectResources(projectId)
      .then((data) => {
        setProfile(data.profile);
        if (data.profile === 'custom' && data.memory) {
          setCustomMb(String(Math.floor(data.memory.limitBytes / 1024 / 1024)));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleSave = async () => {
    if (!profile) return;
    setSaving(true);
    try {
      await updateProjectResources(projectId, {
        profile: profile as 'micro' | 'small' | 'medium' | 'large' | 'custom',
        ...(profile === 'custom' ? { memoryMb: parseInt(customMb, 10) } : {}),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // error silently — user can retry
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-secondary-ol">Loading...</div>;
  }

  return (
    <div className="space-y-4">
      {!profile && (
        <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3 text-sm text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
          {t('resources.noLimitWarning')}
        </div>
      )}

      <div className="space-y-2">
        <label className="text-sm font-medium text-primary-ol">{t('resources.profile')}</label>
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
          <label className="text-sm font-medium text-primary-ol">
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
          <p className="text-xs text-secondary-ol">{t('resources.customMemoryHint')}</p>
        </div>
      )}

      <p className="text-xs text-secondary-ol">{t('resources.appliesOnRedeploy')}</p>

      <Button
        onClick={handleSave}
        disabled={saving || !profile || (profile === 'custom' && !customMb)}
        data-testid="save-resource-limits"
        className={cn(saved && 'bg-green-600 hover:bg-green-600')}
      >
        {saving ? t('resources.saving') : saved ? t('resources.saved') : t('resources.save')}
      </Button>
    </div>
  );
}
