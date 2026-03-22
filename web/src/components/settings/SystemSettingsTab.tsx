import { useCallback, useEffect, useState } from 'react';
import { Cpu, HardDrive, Loader2, MemoryStick, Plus, Shield, Trash2 } from 'lucide-react';
import {
  deleteGlobalSecret,
  getGlobalSecrets,
  setGlobalSecret,
  type GlobalSecret,
} from '@/lib/api';
import { useLanguage } from '@/i18n/context';
import { useSystemStats } from '@/hooks/use-system-stats';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDisk, formatMemory, StatCard } from '@/components/settings/shared';

export function SystemSettingsTab() {
  const { stats } = useSystemStats();
  const { t } = useLanguage();
  const [secrets, setSecrets] = useState<GlobalSecret[]>([]);
  const [secretKey, setSecretKey] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [secretDesc, setSecretDesc] = useState('');
  const [secretSaving, setSecretSaving] = useState(false);

  const fetchSecrets = useCallback(async () => {
    try {
      const data = await getGlobalSecrets();
      setSecrets(data.secrets);
    } catch {
      return;
    }
  }, []);

  useEffect(() => {
    fetchSecrets();
  }, [fetchSecrets]);

  const handleAddSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secretKey.trim() || !secretValue.trim()) return;
    setSecretSaving(true);
    try {
      await setGlobalSecret(secretKey.trim(), secretValue, secretDesc.trim() || undefined);
      setSecretKey('');
      setSecretValue('');
      setSecretDesc('');
      await fetchSecrets();
    } catch {
      return;
    } finally {
      setSecretSaving(false);
    }
  };

  const handleDeleteSecret = async (key: string) => {
    try {
      await deleteGlobalSecret(key);
      await fetchSecrets();
    } catch {
      return;
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-agent" />
          <h2 className="font-display text-lg font-semibold text-primary-ol">
            {t('settings.system.globalSecrets')}
          </h2>
        </div>
        <p className="text-xs font-body text-secondary-ol">{t('settings.secrets.description')}</p>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-4">
          {secrets.length === 0 ? (
            <p className="text-sm font-body text-muted-ol">{t('settings.secrets.noSecrets')}</p>
          ) : (
            <div className="space-y-2">
              {secrets.map((s) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-app/50 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-primary-ol">{s.key}</span>
                      <span className="font-mono text-xs text-muted-ol">{s.maskedValue}</span>
                    </div>
                    {s.description && (
                      <p className="text-xs font-body text-muted-ol mt-0.5 truncate">
                        {s.description}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-ol hover:text-error shrink-0"
                    onClick={() => handleDeleteSecret(s.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleAddSecret} className="space-y-2 pt-2 border-t border-border">
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder={'KEY_NAME'}
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="font-mono text-sm bg-bg-app border-border"
              />
              <Input
                type="password"
                placeholder={'Secret value'}
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                className="font-mono text-sm bg-bg-app border-border"
              />
            </div>
            <Input
              placeholder={'Description (optional)'}
              value={secretDesc}
              onChange={(e) => setSecretDesc(e.target.value)}
              className="text-sm bg-bg-app border-border"
            />
            <Button
              type="submit"
              disabled={secretSaving || !secretKey.trim() || !secretValue.trim()}
              size="sm"
              className="gap-1.5 bg-agent text-bg-app hover:bg-agent/90 font-body"
            >
              {secretSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              {'Add Secret'}
            </Button>
          </form>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-secondary-ol" />
          <h2 className="font-display text-lg font-semibold text-primary-ol">
            {t('settings.system.systemResources')}
          </h2>
        </div>

        {stats ? (
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              icon={<Cpu className="h-4 w-4" />}
              label={'CPU'}
              value={`${typeof stats.cpu === 'number' ? stats.cpu.toFixed(0) : (stats.cpu?.usagePercent?.toFixed(0) ?? '—')}%`}
              color="text-agent"
            />
            <StatCard
              icon={<MemoryStick className="h-4 w-4" />}
              label={'Memory'}
              value={formatMemory(stats.memory)}
              color="text-warning"
            />
            <StatCard
              icon={<HardDrive className="h-4 w-4" />}
              label={'Disk'}
              value={formatDisk(stats.disk)}
              color="text-success"
            />
          </div>
        ) : (
          <p className="text-sm font-body text-muted-ol">{t('settings.system.loading')}</p>
        )}
      </section>
    </div>
  );
}
