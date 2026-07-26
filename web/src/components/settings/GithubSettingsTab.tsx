import { useState } from 'react';
import { Check, CheckCircle2, Copy, ExternalLink, Github, Loader2, RefreshCw } from 'lucide-react';
import { connectGithub, disconnectGithub, type SetupStatus } from '@/lib/api';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCopy } from '@/hooks/use-copy';
import { useGithubDeviceFlow } from '@/hooks/use-github-device-flow';
import { localizeApiError } from '@/lib/localized-api-error';

interface GithubSettingsTabProps {
  status: SetupStatus | null;
  refetch: () => Promise<void>;
  forceReauthorize?: boolean;
  onComplete?: () => void | Promise<void>;
  onCancel?: () => void;
}

export function GithubSettingsTab({
  status,
  refetch,
  forceReauthorize = false,
  onComplete,
  onCancel,
}: GithubSettingsTabProps) {
  const { t } = useLanguage();
  const { copy, isCopied } = useCopy();
  const [githubToken, setGithubToken] = useState('');
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubDisconnecting, setGithubDisconnecting] = useState(false);
  const {
    deviceFlow,
    githubError,
    setGithubError,
    startDeviceFlow: handleStartDeviceFlow,
    cancelDeviceFlow: handleCancelDeviceFlow,
    resetDeviceFlow,
  } = useGithubDeviceFlow({
    onComplete: async () => {
      await refetch();
      await onComplete?.();
    },
  });

  const handleConnectGithub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubToken.trim()) return;
    setGithubConnecting(true);
    setGithubError('');
    try {
      await connectGithub(githubToken.trim());
      await refetch();
      setGithubToken('');
      await onComplete?.();
    } catch (err: unknown) {
      setGithubError(
        localizeApiError(err, t, 'settings.github.connectFailed', 'common.errors.codes'),
      );
    } finally {
      setGithubConnecting(false);
    }
  };

  const handleDisconnectGithub = async () => {
    setGithubDisconnecting(true);
    setGithubError('');
    try {
      await disconnectGithub();
      resetDeviceFlow();
      await refetch();
    } catch (err: unknown) {
      setGithubError(
        localizeApiError(err, t, 'settings.github.disconnectFailed', 'common.errors.codes'),
      );
    } finally {
      setGithubDisconnecting(false);
    }
  };

  const handleCopyCode = async () => {
    if (!deviceFlow?.userCode) return;
    await copy(deviceFlow.userCode);
  };

  const handleCancel = () => {
    handleCancelDeviceFlow();
    onCancel?.();
  };

  return (
    <section className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-6 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Github className="h-4 w-4 text-foreground/80" />
          <h2 className="font-display text-sm font-semibold text-foreground">
            {forceReauthorize
              ? t('settings.github.reauthorizeTitle')
              : t('settings.github.connectionTitle')}
          </h2>
        </div>
        {onCancel && !deviceFlow && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={handleCancel}
            className="text-xs font-body text-muted-foreground"
          >
            {t('settings.github.cancel')}
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/50 p-4 space-y-3">
        <p className="text-sm font-body text-foreground/80">{t('settings.github.description')}</p>

        {status?.github?.ok && !forceReauthorize ? (
          <div className="flex items-center justify-between p-3 rounded-lg border border-success/20 bg-success/5">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm font-medium">
                {t('settings.github.connectedAs', {
                  username: status.github.username ?? '',
                })}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs text-error hover:text-error hover:bg-error/10"
              onClick={handleDisconnectGithub}
              disabled={githubDisconnecting}
            >
              {githubDisconnecting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                t('settings.github.disconnect')
              )}
            </Button>
          </div>
        ) : deviceFlow ? (
          <div className="space-y-4">
            <div className="text-center space-y-3">
              <p className="text-sm font-body text-foreground/80">
                {t('settings.github.enterCode')}
              </p>
              <p className="font-mono text-2xl tracking-[0.3em] text-foreground font-bold">
                {deviceFlow.userCode}
              </p>
            </div>
            <div className="flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => window.open(deviceFlow.verificationUri, '_blank')}
                className="gap-1.5 font-body"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {t('settings.github.openGithub')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyCode}
                className="gap-1.5 font-body"
              >
                {isCopied() ? (
                  <Check className="h-3.5 w-3.5 text-success" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {isCopied() ? t('settings.github.copied') : t('settings.github.copyCode')}
              </Button>
            </div>
            <div className="flex items-center justify-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span role="status" className="text-xs font-body">
                {t('settings.github.waiting')}
              </span>
            </div>
            <div className="flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancel}
                className="text-xs font-body text-muted-foreground"
              >
                {t('settings.github.cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {forceReauthorize && (
              <p className="text-xs font-body text-muted-foreground">
                {t('settings.github.reauthorizeDescription')}
              </p>
            )}
            <Button
              type="button"
              onClick={handleStartDeviceFlow}
              size="sm"
              className="w-full gap-1.5 bg-agent text-white hover:bg-agent/90 font-body"
            >
              <Github className="h-3.5 w-3.5" />
              {t('settings.github.connectWithGithub')}
            </Button>

            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[hsl(var(--border))]" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-bg-panel px-2 text-muted-foreground font-body">
                  {t('settings.github.or')}
                </span>
              </div>
            </div>

            <p className="text-xs font-body text-muted-foreground">
              {t('settings.github.enterToken')}
            </p>
            <form onSubmit={handleConnectGithub} className="space-y-3">
              <div className="space-y-2">
                <Input
                  type="password"
                  placeholder="ghp_..."
                  value={githubToken}
                  onChange={(e) => setGithubToken(e.target.value)}
                  className="font-mono text-sm bg-bg-app border-border"
                />
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-body text-agent hover:underline inline-flex items-center gap-1"
                >
                  {t('settings.github.generateToken')}
                </a>
              </div>
              <Button
                type="submit"
                disabled={githubConnecting || !githubToken.trim()}
                size="sm"
                variant="outline"
                className="gap-1.5 font-body"
              >
                {githubConnecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Github className="h-3.5 w-3.5" />
                )}
                {t('settings.github.connectToken')}
              </Button>
            </form>

            {githubError && (
              <p role="alert" className="text-sm font-body text-error">
                {githubError}
              </p>
            )}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs font-body text-muted-foreground"
              onClick={refetch}
            >
              <RefreshCw className="h-3 w-3" />
              {t('settings.github.checkStatus')}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
