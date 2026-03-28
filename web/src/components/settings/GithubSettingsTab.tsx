import { useEffect, useState } from 'react';
import { Check, CheckCircle2, Copy, ExternalLink, Github, Loader2, RefreshCw } from 'lucide-react';
import {
  connectGithub,
  disconnectGithub,
  pollGithubDeviceFlow,
  startGithubDeviceFlow,
  type SetupStatus,
} from '@/lib/api';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCopy } from '@/hooks/use-copy';

interface GithubSettingsTabProps {
  status: SetupStatus | null;
  refetch: () => Promise<void>;
}

export function GithubSettingsTab({ status, refetch }: GithubSettingsTabProps) {
  const { t } = useLanguage();
  const { copy, isCopied } = useCopy();
  const [githubToken, setGithubToken] = useState('');
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubDisconnecting, setGithubDisconnecting] = useState(false);
  const [githubError, setGithubError] = useState('');
  const [deviceFlow, setDeviceFlow] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
  } | null>(null);
  const [deviceFlowPolling, setDeviceFlowPolling] = useState(false);

  const handleConnectGithub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubToken.trim()) return;
    setGithubConnecting(true);
    setGithubError('');
    try {
      await connectGithub(githubToken.trim());
      await refetch();
      setGithubToken('');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to connect GitHub';
      setGithubError(message);
    } finally {
      setGithubConnecting(false);
    }
  };

  const handleDisconnectGithub = async () => {
    setGithubDisconnecting(true);
    setGithubError('');
    try {
      await disconnectGithub();
      await refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect GitHub';
      setGithubError(message);
    } finally {
      setGithubDisconnecting(false);
    }
  };

  const handleStartDeviceFlow = async () => {
    setGithubError('');
    try {
      const response = await startGithubDeviceFlow();
      setDeviceFlow({
        userCode: response.user_code,
        verificationUri: response.verification_uri,
        deviceCode: response.device_code,
        interval: response.interval,
      });
      setDeviceFlowPolling(true);
    } catch {
      setGithubError('Failed to start GitHub authorization');
    }
  };

  const handleCopyCode = async () => {
    if (!deviceFlow?.userCode) return;
    await copy(deviceFlow.userCode);
  };

  const handleCancelDeviceFlow = () => {
    setDeviceFlow(null);
    setDeviceFlowPolling(false);
    setGithubError('');
  };

  useEffect(() => {
    if (!deviceFlowPolling || !deviceFlow) return;

    const pollInterval = setInterval(async () => {
      try {
        const result = await pollGithubDeviceFlow(deviceFlow.deviceCode, deviceFlow.interval);

        if (result.status === 'complete') {
          clearInterval(pollInterval);
          setDeviceFlow(null);
          setDeviceFlowPolling(false);
          await refetch();
        } else if (result.status === 'slow_down') {
          setDeviceFlow((prev) =>
            prev ? { ...prev, interval: result.interval ?? prev.interval } : null,
          );
        } else if (
          result.status === 'expired' ||
          result.status === 'denied' ||
          result.status === 'error'
        ) {
          clearInterval(pollInterval);
          setDeviceFlow(null);
          setDeviceFlowPolling(false);
          setGithubError(result.message || `Authorization ${result.status}`);
        }
      } catch {
        return;
      }
    }, deviceFlow.interval * 1000);

    return () => clearInterval(pollInterval);
  }, [deviceFlowPolling, deviceFlow, refetch]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Github className="h-4 w-4 text-secondary-ol" />
        <h2 className="font-display text-lg font-semibold text-primary-ol">
          {'GitHub Connection'}
        </h2>
      </div>

      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 space-y-3">
        <p className="text-sm font-body text-secondary-ol">{t('settings.github.description')}</p>

        {status?.github?.ok ? (
          <div className="flex items-center justify-between p-3 rounded-lg border border-success/20 bg-success/5">
            <div className="flex items-center gap-2 text-success">
              <CheckCircle2 className="w-4 h-4" />
              <span className="text-sm font-medium">
                {'Connected as'} {status.github.username}
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
                'Disconnect'
              )}
            </Button>
          </div>
        ) : deviceFlow ? (
          <div className="space-y-4">
            <div className="text-center space-y-3">
              <p className="text-sm font-body text-secondary-ol">
                {t('settings.github.enterCode')}
              </p>
              <p className="font-mono text-2xl tracking-[0.3em] text-primary-ol font-bold">
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
                {'Open GitHub'}
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
                {isCopied() ? 'Copied' : 'Copy Code'}
              </Button>
            </div>
            <div className="flex items-center justify-center gap-2 text-muted-ol">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs font-body">{t('settings.github.waiting')}</span>
            </div>
            <div className="flex justify-center">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCancelDeviceFlow}
                className="text-xs font-body text-muted-ol"
              >
                {'Cancel'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
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
                <span className="bg-bg-panel px-2 text-muted-ol font-body">{'or'}</span>
              </div>
            </div>

            <p className="text-sm font-body text-muted-ol">{t('settings.github.enterToken')}</p>
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
                {'Connect'}
              </Button>
            </form>

            {githubError && <p className="text-sm font-body text-error">{githubError}</p>}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs font-body text-muted-ol"
              onClick={refetch}
            >
              <RefreshCw className="h-3 w-3" />
              {'Refresh'}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
