import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { setupPassword } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/i18n/context';

interface PasswordStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function PasswordStep({ onNext, onBack }: PasswordStepProps) {
  const { t } = useLanguage();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!setupSecret.trim()) {
      setError(t('setup.password.secretEmpty'));
      return;
    }
    if (password !== confirm) {
      setError(t('setup.password.mismatch'));
      return;
    }
    if (!password) {
      setError(t('setup.password.empty'));
      return;
    }
    setSaving(true);
    try {
      await setupPassword(password, setupSecret.trim());
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-agent/10 flex items-center justify-center">
          <Lock className="h-8 w-8 text-agent" />
        </div>
        <div className="space-y-2">
          <h2 className="font-display text-2xl font-bold text-primary-ol tracking-tight">
            {t('setup.password.title')}
          </h2>
          <p className="text-sm font-body text-secondary-ol">{t('setup.password.subtitle')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-left">
          <div className="space-y-2">
            <Input
              type="text"
              placeholder={t('setup.password.secretPlaceholder')}
              value={setupSecret}
              onChange={(e) => setSetupSecret(e.target.value)}
              className="bg-bg-panel border-border font-mono"
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            <p className="text-xs font-body text-muted-ol">{t('setup.password.secretHint')}</p>
            <Input
              type="password"
              placeholder={t('setup.password.placeholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="bg-bg-panel border-border"
            />
            <Input
              type="password"
              placeholder={t('setup.password.confirmPlaceholder')}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="bg-bg-panel border-border"
            />
          </div>

          {error && <p className="text-sm text-red-400 font-body">{error}</p>}

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onBack}>
              {t('setup.common.back')}
            </Button>
            <Button
              type="submit"
              disabled={saving || !password || !confirm || !setupSecret.trim()}
              className="flex-1 bg-agent hover:bg-agent/90 text-white font-body"
            >
              {saving ? t('setup.password.saving') : t('setup.password.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
