import { useState, type FormEvent } from 'react';
import { Lock } from 'lucide-react';
import { setupPassword } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface PasswordStepProps {
  onNext: () => void;
}

export function PasswordStep({ onNext }: PasswordStepProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) {
      setError('Passwords do not match');
      return;
    }
    if (!password) {
      setError('Password cannot be empty');
      return;
    }
    setSaving(true);
    try {
      await setupPassword(password);
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Lock className="h-6 w-6 text-agent" />
        <div>
          <h2 className="font-display text-xl font-bold text-primary-ol">Set Password</h2>
          <p className="text-sm font-body text-secondary-ol mt-0.5">
            Protect your dashboard with a password
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="bg-bg-panel border-border"
            autoFocus
          />
          <Input
            type="password"
            placeholder="Confirm password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="bg-bg-panel border-border"
          />
        </div>

        {error && <p className="text-sm text-red-400 font-body">{error}</p>}

        <Button
          type="submit"
          disabled={saving || !password || !confirm}
          className="w-full bg-agent hover:bg-agent/90 text-white font-body"
        >
          {saving ? 'Setting up...' : 'Set Password & Continue'}
        </Button>
      </form>
    </div>
  );
}
