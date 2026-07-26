/**
 * LoginPage / AuthScreen — single page, two modes (v0.1).
 *
 * For v0.1, first boot and sign-in
 * share one surface:
 *
 *   - signin (default) — password input only
 *   - setup  (when /api/setup/status hasPassword=false) — password +
 *     confirm, 8-char minimum
 *
 * The setup branch wires to /api/auth/setup-password, which on success
 * already sets the session cookie. Onboarding R2 (2026-05-13) directs
 * the post-setup redirect at `/setup` rather than `/projects` — there
 * is no docker/traefik readiness yet on first boot, so SetupGuard
 * would have ricocheted `/projects` → `/setup` anyway. Going directly
 * to /setup removes the double redirect and lets the wizard own the
 * first-boot flow start-to-finish.
 *
 * While the status check is in flight we render a small skeleton with
 * descriptive copy; on failure we fall back to signin (preserves the
 * pre-v0.1 behaviour for users running older backends).
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { Loader2 } from 'lucide-react';
import { useAuth } from '@/contexts/auth';
import { useLanguage } from '@/i18n/context';
import { LanguageToggle } from '@/components/LanguageToggle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getSetupStatus } from '@/lib/api';
import { setupPassword } from '@/lib/api/auth';
import { isPasswordTooShort } from '@/lib/auth/password-policy';
import { localizeApiError } from '@/lib/localized-api-error';

type Mode = 'signin' | 'setup';

export function LoginPage() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();
  const { t } = useLanguage();

  // Guard against setState calls after unmount (post-navigate or fast
  // route changes during the in-flight setup-status request).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Decide mode from /api/setup/status. While loading, show a skeleton —
  // we don't want a flicker from signin → setup once the status lands.
  useEffect(() => {
    void getSetupStatus()
      .then((status) => {
        if (!mountedRef.current) return;
        setMode(status.hasPassword === false ? 'setup' : 'signin');
      })
      .catch(() => {
        if (!mountedRef.current) return;
        // Fall back to signin on any status fetch error — preserves the
        // pre-v0.1 behaviour for users running older backends.
        setMode('signin');
      });
  }, []);

  const handleSignin = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(password);
      navigate('/projects', { replace: true });
    } catch (err) {
      if (mountedRef.current) {
        setError(localizeApiError(err, t, 'login.errorGeneric', 'common.errors.codes'));
      }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  };

  const handleSetup = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (isPasswordTooShort(password)) {
      setError(t('setup.password.tooShort'));
      return;
    }
    if (password !== confirm) {
      setError(t('setup.password.mismatch'));
      return;
    }
    setLoading(true);
    try {
      await setupPassword(password);
      // Backend created a session cookie on success. Hard-reload into
      // /setup so AuthProvider re-runs verifySession() against the new
      // cookie AND lands on the wizard directly — first boot has no
      // docker/traefik yet, so SetupGuard would have bounced /projects
      // → /setup anyway. Going there straight removes that ricochet.
      // Use replace() so the back button doesn't return the user to /login.
      window.location.replace('/setup');
    } catch (err) {
      if (mountedRef.current) {
        setError(localizeApiError(err, t, 'setup.password.errorGeneric', 'common.errors.codes'));
        setLoading(false);
      }
    }
  };

  if (mode == null) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex h-screen flex-col items-center justify-center gap-3 bg-bg-app"
      >
        <Loader2
          aria-label={t('login.loadingLabel')}
          className="h-5 w-5 animate-spin text-[color:var(--ol-fg-muted)]"
        />
        <p className="text-[12px] font-body text-foreground/60">{t('login.checkingStatus')}</p>
      </div>
    );
  }

  return (
    <div className="relative flex h-screen items-center justify-center bg-bg-app">
      <div className="absolute right-4 top-4">
        <LanguageToggle />
      </div>
      <div className="w-full max-w-sm space-y-6 px-4">
        <div className="text-center space-y-2">
          <h1 className="font-display text-3xl font-bold text-foreground tracking-tight">
            {mode === 'setup' ? t('setup.password.title') : 'OpenLander'}
          </h1>
          <p className="text-sm font-body text-foreground/80">
            {mode === 'setup' ? t('setup.password.subtitle') : t('login.signInPrompt')}
          </p>
        </div>

        {mode === 'setup' ? (
          // noValidate so the native HTML5 minLength check doesn't beat
          // our handler to the punch — we want the user to see the
          // tooShort error message we set in handleSetup().
          <form onSubmit={(e) => void handleSetup(e)} className="space-y-4" noValidate>
            <div className="space-y-1">
              <label htmlFor="setup-password" className="sr-only">
                {t('setup.password.placeholder')}
              </label>
              <Input
                id="setup-password"
                type="password"
                placeholder={t('setup.password.placeholder')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
                autoComplete="new-password"
                aria-describedby="setup-password-hint"
                className="bg-bg-panel border-border"
              />
              <p id="setup-password-hint" className="text-[11px] font-body text-foreground/60">
                {t('setup.password.lengthHint')}
              </p>
            </div>
            <div>
              <label htmlFor="setup-password-confirm" className="sr-only">
                {t('setup.password.confirmPlaceholder')}
              </label>
              <Input
                id="setup-password-confirm"
                type="password"
                placeholder={t('setup.password.confirmPlaceholder')}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                className="bg-bg-panel border-border"
              />
            </div>
            {error && (
              <p data-testid="login-error" role="alert" className="text-sm text-red-400 font-body">
                {error}
              </p>
            )}

            <Button
              type="submit"
              // Only block the click when nothing has been entered or a
              // request is in flight. Length / mismatch are surfaced as
              // inline errors on submit, so the user actually learns the
              // rule instead of staring at a greyed
              // button (CCG advisor feedback on PR #200).
              disabled={loading || !password || !confirm}
              className="w-full bg-agent hover:bg-agent/90 text-white font-body"
            >
              {loading ? t('setup.password.saving') : t('setup.password.submit')}
            </Button>
          </form>
        ) : (
          <form onSubmit={(e) => void handleSignin(e)} className="space-y-4">
            <label htmlFor="signin-password" className="sr-only">
              {t('login.password')}
            </label>
            <Input
              id="signin-password"
              type="password"
              placeholder={t('login.password')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="bg-bg-panel border-border"
            />

            {error && (
              <p data-testid="login-error" role="alert" className="text-sm text-red-400 font-body">
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
        )}
      </div>
    </div>
  );
}
