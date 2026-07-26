import { Terminal, Network, Loader2, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusRow, DockerFixGuide } from './shared';
import { useLanguage } from '@/i18n/context';

interface SetupStatus {
  docker: {
    ok: boolean;
    message: string;
    state?: string;
    groupFixed?: boolean;
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
    provider?: string | null;
  };
}

interface InfraStepProps {
  status: SetupStatus;
  refetch: () => Promise<void>;
  startingTraefik: boolean;
  onStartTraefik: () => Promise<void>;
  onNext: () => void;
}

// InfraStep is the FIRST step of the wizard after onboarding R1
// (LanguageStep retired 2026-05-13). No Back button — there is nowhere
// to go back to. Language is picked from the LoginPage header toggle
// before the user lands here.
export function InfraStep({
  status,
  refetch,
  startingTraefik,
  onStartTraefik,
  onNext,
}: InfraStepProps) {
  const { t } = useLanguage();
  const dockerDetail = status.docker.ok
    ? t('setup.infra.running')
    : status.docker.state === 'not_installed'
      ? t('setup.infra.dockerNotInstalled')
      : status.docker.state === 'not_running'
        ? t('setup.infra.dockerNotRunning')
        : status.docker.state === 'permission_denied' && status.docker.groupFixed
          ? t('setup.infra.dockerPermissionFixed')
          : status.docker.state === 'permission_denied'
            ? t('setup.infra.dockerPermissionDenied')
            : t('setup.infra.dockerUnavailable');

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="text-center space-y-6">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-agent/10 flex items-center justify-center">
          <Terminal className="h-8 w-8 text-agent" />
        </div>
        <div className="space-y-2">
          <h1 className="font-display text-3xl font-bold text-foreground tracking-tight">
            {t('setup.welcome.title')}
          </h1>
          <p className="text-lg font-body text-foreground/80">{t('setup.welcome.subtitle')}</p>
        </div>

        {/* Infrastructure status */}
        <div className="space-y-3 text-left">
          <StatusRow
            ok={status.docker.ok}
            label={t('setup.infra.dockerEngine')}
            detail={dockerDetail}
          />
          {!status.docker.ok && (
            <div className="ml-10 space-y-2">
              <DockerFixGuide state={status.docker.state} />
              <Button onClick={refetch} variant="outline" size="sm" className="text-xs">
                {t('setup.common.refreshStatus')}
              </Button>
            </div>
          )}

          <StatusRow
            ok={status.traefik.ok}
            label={t('setup.infra.traefikProxy')}
            detail={status.traefik.ok ? t('setup.infra.running') : t('setup.infra.stopped')}
          />
          {!status.traefik.ok && status.docker.ok && (
            <div className="ml-10">
              <Button
                onClick={onStartTraefik}
                disabled={startingTraefik}
                size="sm"
                variant="outline"
                className="text-xs gap-1.5"
              >
                {startingTraefik && <Loader2 className="h-3 w-3 animate-spin" />}
                <Network className="h-3 w-3" />
                {t('setup.infra.traefikProxy')}
              </Button>
            </div>
          )}
        </div>

        <Button
          onClick={onNext}
          disabled={!status.docker.ok}
          size="lg"
          className="w-full bg-agent text-white hover:bg-agent/90 font-body gap-2"
        >
          {t('setup.common.getStarted')}
          <ArrowRight className="h-4 w-4" />
        </Button>

        {!status.docker.ok && (
          <p className="text-sm font-body text-muted-foreground">
            {t('setup.welcome.dockerRequired')}
          </p>
        )}
      </div>
    </div>
  );
}
