import { useState, useEffect } from 'react';
import { getApiToken, regenerateApiToken, changePassword } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Eye, EyeOff, Copy, Check, RefreshCw, Lock, Key } from 'lucide-react';
import { toast } from 'sonner';
import { useCopy } from '@/hooks/use-copy';

export function SecuritySettingsTab() {
  const [apiToken, setApiToken] = useState<string>('');
  const [showToken, setShowToken] = useState(false);
  const { copy, isCopied } = useCopy();
  const [regenerating, setRegenerating] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  useEffect(() => {
    getApiToken()
      .then((res) => setApiToken(res.token))
      .catch(() => toast.error('Failed to load API token'));
  }, []);

  const handleCopyToken = () => {
    if (!apiToken) return;
    void copy(apiToken);
  };

  const handleRegenerateToken = async () => {
    if (!confirm('Previous token will be immediately invalidated. Continue?')) return;

    setRegenerating(true);
    try {
      const res = await regenerateApiToken();
      setApiToken(res.token);
      setShowToken(true);
      toast.success('API token regenerated successfully');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to regenerate token');
    } finally {
      setRegenerating(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      await changePassword(currentPassword, newPassword);
      toast.success('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: unknown) {
      setPasswordError(err instanceof Error ? err.message : 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const maskedToken = apiToken
    ? `${apiToken.slice(0, 7)}••••••••${apiToken.slice(-4)}`
    : '••••••••••••••••';

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Key className="h-4 w-4 text-agent" />
          <h2 className="font-display text-lg font-semibold text-primary-ol">API Token</h2>
        </div>
        <p className="text-sm font-body text-muted-ol">
          Use this token to authenticate with the OpenLander API or MCP server.
        </p>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Input
                type={showToken ? 'text' : 'password'}
                value={showToken ? apiToken : maskedToken}
                readOnly
                className="font-mono text-sm bg-bg-app border-border pr-10"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0 text-muted-ol hover:text-primary-ol"
                onClick={() => setShowToken(!showToken)}
              >
                {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 font-body border-border bg-bg-app hover:bg-bg-subtle"
              onClick={handleCopyToken}
            >
              {isCopied() ? <Check className="h-4 w-4 text-agent" /> : <Copy className="h-4 w-4" />}
              {isCopied() ? 'Copied!' : 'Copy'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 font-body border-border bg-bg-app hover:bg-bg-subtle text-error hover:text-error"
              onClick={handleRegenerateToken}
              disabled={regenerating}
            >
              <RefreshCw className={`h-4 w-4 ${regenerating ? 'animate-spin' : ''}`} />
              Regenerate
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Lock className="h-4 w-4 text-agent" />
          <h2 className="font-display text-lg font-semibold text-primary-ol">Change Password</h2>
        </div>
        <p className="text-sm font-body text-muted-ol">
          Update your login password. You will remain logged in after changing it.
        </p>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4">
          <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
            <div className="space-y-2">
              <label className="text-sm font-medium text-primary-ol">Current Password</label>
              <Input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="bg-bg-app border-border"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-primary-ol">New Password</label>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="bg-bg-app border-border"
                required
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-primary-ol">Confirm New Password</label>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="bg-bg-app border-border"
                required
              />
            </div>

            {passwordError && <p className="text-sm text-error font-medium">{passwordError}</p>}

            <Button
              type="submit"
              disabled={changingPassword || !currentPassword || !newPassword || !confirmPassword}
              className="w-full bg-agent text-white hover:bg-agent/90 font-body"
            >
              {changingPassword ? 'Changing Password...' : 'Change Password'}
            </Button>
          </form>
        </div>
      </section>
    </div>
  );
}
