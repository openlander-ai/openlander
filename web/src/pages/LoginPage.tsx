import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/auth';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-bg-app">
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="text-center space-y-2">
          <h1 className="font-display text-3xl font-bold text-primary-ol tracking-tight">
            OpenLander
          </h1>
          <p className="text-sm font-body text-secondary-ol">{t('login.signInPrompt')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            type="password"
            placeholder={t('login.password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            className="bg-bg-panel border-border"
          />

          {error && (
            <p data-testid="login-error" className="text-sm text-red-400 font-body">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-agent hover:bg-agent/90 text-white font-body"
          >
            {loading ? t('login.signingIn') : t('login.signIn')}
          </Button>
        </form>
      </div>
    </div>
  );
}
