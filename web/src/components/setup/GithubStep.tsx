import {
  Rocket,
  Github,
  ExternalLink,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Check,
  Copy,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2 } from 'lucide-react';
import { useLanguage } from '@/i18n/context';

interface SetupStatus {
  docker: {
    ok: boolean;
    message: string;
    state?: string;
  };
  traefik: {
    ok: boolean;
  };
  github?: {
    ok: boolean;
    username?: string;
  };
  llm?: {
    ok: boolean;
    provider?: string;
  };
}

interface DeviceFlow {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
}

interface GithubStepProps {
  status: SetupStatus;
  deviceFlow: DeviceFlow | null;
  githubToken: string;
  githubConnecting: boolean;
  githubDisconnecting: boolean;
  githubError: string;
  copiedCode: boolean;
  onSetGithubToken: (token: string) => void;
  onConnectGithub: (e: React.FormEvent) => Promise<void>;
  onDisconnectGithub: () => Promise<void>;
  onStartDeviceFlow: () => Promise<void>;
  onCopyCode: () => Promise<void>;
  onCancelDeviceFlow: () => void;
  onNext: () => void;
  onBack: () => void;
}

export function GithubStep({
  status,
  deviceFlow,
  githubToken,
  githubConnecting,
  githubDisconnecting,
  githubError,
  copiedCode,
  onSetGithubToken,
  onConnectGithub,
  onDisconnectGithub,
  onStartDeviceFlow,
  onCopyCode,
  onCancelDeviceFlow,
  onNext,
  onBack,
}: GithubStepProps) {
  const { t } = useLanguage();

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-agent/10 flex items-center justify-center">
            <Rocket className="h-8 w-8 text-agent" />
          </div>
          <h2 className="font-display text-2xl font-bold text-primary-ol tracking-tight">
            {t('setup.github.title')}
          </h2>
          <p className="text-sm font-body text-secondary-ol">{t('setup.github.subtitle')}</p>
        </div>

        {/* GitHub connection (optional) */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <Github className="h-4 w-4 text-secondary-ol" />
            <span className="text-sm font-body font-medium text-primary-ol">{'GitHub Access'}</span>
            <Badge variant="outline" className="text-xs py-0">
              Optional
            </Badge>
          </div>
          <p className="text-sm font-body text-muted-ol">{t('setup.github.description')}</p>

          {status?.github?.ok ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2 p-3 rounded-lg border border-success/20 bg-success/5 text-success">
                <div className="flex items-center gap-2 min-w-0">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {t('setup.github.connectedAs', {
                      username: status.github.username ?? 'unknown',
                    })}
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs font-body text-error hover:text-error hover:bg-error/10"
                  onClick={() => void onDisconnectGithub()}
                  disabled={githubDisconnecting}
                >
                  {githubDisconnecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    t('setup.github.switchAccount')
                  )}
                </Button>
              </div>
              {githubError && <p className="text-sm font-body text-error">{githubError}</p>}
            </div>
          ) : deviceFlow ? (
            <DeviceFlowUI
              deviceFlow={deviceFlow}
              copiedCode={copiedCode}
              onCopyCode={onCopyCode}
              onCancelDeviceFlow={onCancelDeviceFlow}
              t={t}
            />
          ) : (
            <GithubConnectionUI
              githubToken={githubToken}
              githubConnecting={githubConnecting}
              githubError={githubError}
              onSetGithubToken={onSetGithubToken}
              onConnectGithub={onConnectGithub}
              onStartDeviceFlow={onStartDeviceFlow}
              t={t}
            />
          )}
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onBack} className="gap-1.5 font-body">
            <ArrowLeft className="h-3.5 w-3.5" />
            {'Back'}
          </Button>
          <Button
            onClick={onNext}
            size="lg"
            className="flex-1 bg-agent text-bg-app hover:bg-agent/90 font-body gap-2"
          >
            {status?.github?.ok ? 'Continue' : 'Skip for now'}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function DeviceFlowUI({
  deviceFlow,
  copiedCode,
  onCopyCode,
  onCancelDeviceFlow,
  t,
}: {
  deviceFlow: DeviceFlow;
  copiedCode: boolean;
  onCopyCode: () => Promise<void>;
  onCancelDeviceFlow: () => void;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-4">
      <div className="text-center space-y-3">
        <p className="text-sm font-body text-secondary-ol">{t('settings.github.enterCode')}</p>
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
          onClick={onCopyCode}
          className="gap-1.5 font-body"
        >
          {copiedCode ? (
            <Check className="h-3.5 w-3.5 text-success" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
          {copiedCode ? 'Copied' : 'Copy Code'}
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
          onClick={onCancelDeviceFlow}
          className="text-xs font-body text-muted-ol"
        >
          {'Cancel'}
        </Button>
      </div>
    </div>
  );
}

function GithubConnectionUI({
  githubToken,
  githubConnecting,
  githubError,
  onSetGithubToken,
  onConnectGithub,
  onStartDeviceFlow,
  t,
}: {
  githubToken: string;
  githubConnecting: boolean;
  githubError: string;
  onSetGithubToken: (token: string) => void;
  onConnectGithub: (e: React.FormEvent) => Promise<void>;
  onStartDeviceFlow: () => Promise<void>;
  t: (key: string) => string;
}) {
  return (
    <div className="space-y-3">
      <Button
        type="button"
        onClick={onStartDeviceFlow}
        size="sm"
        className="w-full gap-1.5 bg-agent text-bg-app hover:bg-agent/90 font-body"
      >
        <Github className="h-3.5 w-3.5" />
        {t('settings.github.connectWithGithub')}
      </Button>

      <div className="relative my-4">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-[hsl(var(--border))]" />
        </div>
        <div className="relative flex justify-center text-xs">
          <span className="bg-bg-subtle/30 px-2 text-muted-ol font-body">{'or'}</span>
        </div>
      </div>

      <form onSubmit={onConnectGithub} className="space-y-3">
        <div className="space-y-2">
          <Input
            type="password"
            placeholder="ghp_..."
            value={githubToken}
            onChange={(e) => onSetGithubToken(e.target.value)}
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
    </div>
  );
}
