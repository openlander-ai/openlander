import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { fetchOpsConfig, updateOpsConfig } from '@/lib/api/operations';
import { useLanguage } from '@/i18n/context';
import { AutomationPolicyEditor } from './AutomationPolicyEditor';

interface OpsConfigState {
  enabled: boolean;
  auto_restart: boolean;
  auto_cleanup: boolean;
  drift_detection: boolean;
  thresholds: {
    disk_cleanup_percent: number;
    recovery_max_per_day: number;
    alert_dedup_minutes: number;
    digest_time: string;
  };
  channels: {
    email?: {
      host: string;
      port: number;
      secure: boolean;
      auth: { user: string; pass: string };
      from: string;
      to: string[];
    };
  };
}

const DEFAULT_CONFIG: OpsConfigState = {
  enabled: true,
  auto_restart: true,
  auto_cleanup: true,
  drift_detection: true,
  thresholds: {
    disk_cleanup_percent: 80,
    recovery_max_per_day: 5,
    alert_dedup_minutes: 15,
    digest_time: '09:00',
  },
  channels: {},
};

export function OperationsSettings() {
  const { t } = useLanguage();
  const [config, setConfig] = useState<OpsConfigState>(DEFAULT_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [emailHost, setEmailHost] = useState('');
  const [emailPort, setEmailPort] = useState('587');
  const [emailUser, setEmailUser] = useState('');
  const [emailPass, setEmailPass] = useState('');
  const [emailFrom, setEmailFrom] = useState('');
  const [emailTo, setEmailTo] = useState('');

  useEffect(() => {
    void fetchOpsConfig().then((data) => {
      if (data.config && typeof data.config === 'object') {
        const cfg = data.config as Partial<OpsConfigState>;
        setConfig((prev) => ({ ...prev, ...cfg }));
        if (cfg.channels?.email) {
          setEmailHost(cfg.channels.email.host ?? '');
          setEmailPort(String(cfg.channels.email.port ?? 587));
          setEmailUser(cfg.channels.email.auth?.user ?? '');
          setEmailFrom(cfg.channels.email.from ?? '');
          setEmailTo((cfg.channels.email.to ?? []).join(', '));
        }
      }
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = {
        ...config,
        channels: emailHost
          ? {
              email: {
                host: emailHost,
                port: Number(emailPort),
                secure: Number(emailPort) === 465,
                auth: { user: emailUser, pass: emailPass },
                from: emailFrom,
                to: emailTo
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              },
            }
          : config.channels,
      };
      await updateOpsConfig(payload);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.operations.general')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {[
            { key: 'enabled', label: t('settings.operations.enabled') },
            { key: 'auto_restart', label: t('settings.operations.autoRestart') },
            { key: 'auto_cleanup', label: t('settings.operations.autoCleanup') },
            { key: 'drift_detection', label: t('settings.operations.driftDetection') },
          ].map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <Label>{label}</Label>
              <Switch
                checked={config[key as keyof OpsConfigState] as boolean}
                onCheckedChange={(v) => setConfig((c) => ({ ...c, [key]: v }))}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Automation Policy */}
      <AutomationPolicyEditor />

      {/* Thresholds */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.operations.thresholds')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t('settings.operations.diskCleanupPercent')}</Label>
              <Input
                type="number"
                min={70}
                max={95}
                value={config.thresholds.disk_cleanup_percent}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    thresholds: { ...c.thresholds, disk_cleanup_percent: Number(e.target.value) },
                  }))
                }
              />
            </div>
            <div>
              <Label>{t('settings.operations.recoveryMaxPerDay')}</Label>
              <Input
                type="number"
                value={config.thresholds.recovery_max_per_day}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    thresholds: { ...c.thresholds, recovery_max_per_day: Number(e.target.value) },
                  }))
                }
              />
            </div>
            <div>
              <Label>{t('settings.operations.alertDedupMinutes')}</Label>
              <Input
                type="number"
                value={config.thresholds.alert_dedup_minutes}
                onChange={(e) =>
                  setConfig((c) => ({
                    ...c,
                    thresholds: { ...c.thresholds, alert_dedup_minutes: Number(e.target.value) },
                  }))
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.operations.digestTime')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <Label>{t('settings.operations.digestTime')}</Label>
            <Switch
              checked={config.thresholds.digest_time !== ''}
              onCheckedChange={(v) =>
                setConfig((c) => ({
                  ...c,
                  thresholds: { ...c.thresholds, digest_time: v ? '09:00' : '' },
                }))
              }
            />
          </div>
          <div>
            <Label>{t('settings.operations.digestTime')}</Label>
            <Input
              type="text"
              placeholder="09:00"
              value={config.thresholds.digest_time}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  thresholds: { ...c.thresholds, digest_time: e.target.value },
                }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Email */}
      <Card>
        <CardHeader>
          <CardTitle>{t('settings.operations.emailNotifications')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>{t('settings.operations.smtpHost')}</Label>
              <Input
                value={emailHost}
                onChange={(e) => setEmailHost(e.target.value)}
                placeholder="smtp.example.com"
              />
            </div>
            <div>
              <Label>{t('settings.operations.port')}</Label>
              <Input
                type="number"
                value={emailPort}
                onChange={(e) => setEmailPort(e.target.value)}
              />
            </div>
            <div>
              <Label>{t('settings.operations.username')}</Label>
              <Input value={emailUser} onChange={(e) => setEmailUser(e.target.value)} />
            </div>
            <div>
              <Label>{t('settings.operations.password')}</Label>
              <Input
                type="password"
                value={emailPass}
                onChange={(e) => setEmailPass(e.target.value)}
              />
            </div>
            <div>
              <Label>{t('settings.operations.fromAddress')}</Label>
              <Input
                value={emailFrom}
                onChange={(e) => setEmailFrom(e.target.value)}
                placeholder="alerts@example.com"
              />
            </div>
            <div>
              <Label>{t('settings.operations.recipients')}</Label>
              <Input
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                placeholder="admin@example.com"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Button onClick={() => void handleSave()} disabled={saving}>
        {saving
          ? t('settings.operations.saving')
          : saved
            ? t('settings.operations.saved')
            : t('settings.operations.save')}
      </Button>
    </div>
  );
}
