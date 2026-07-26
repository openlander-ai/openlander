import { CheckCircle2, XCircle, Copy, Check } from 'lucide-react';
import { useCopy } from '@/hooks/use-copy';
import { useLanguage } from '@/i18n/context';

export function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="shrink-0">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <XCircle className="h-4 w-4 text-error" />
        )}
      </div>
      <span className="text-sm font-body text-foreground">{label}</span>
      <span className="text-xs font-body text-muted-foreground ml-auto">{detail}</span>
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const { copy, isCopied } = useCopy();
  const { t } = useLanguage();
  const handleCopy = () => {
    void copy(text);
  };
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-bg-subtle hover:bg-bg-subtle/80 text-muted-foreground hover:text-foreground/80 transition-colors"
      title={t('setupHelp.copyTitle')}
    >
      {isCopied() ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
      {isCopied() ? t('setupHelp.copied') : t('setupHelp.copy')}
    </button>
  );
}

const DOCKER_LINUX_CMD = 'curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER';
const DOCKER_MAC_CMD = 'brew install --cask docker';
const DOCKER_START_LINUX = 'sudo systemctl start docker';
const DOCKER_START_MAC = 'open -a Docker';
const DOCKER_PERM_CMD = 'sudo usermod -aG docker $USER && newgrp docker';
export function CommandBlock({ label, cmd }: { label: string; cmd: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-panel p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-body font-medium text-foreground/80">{label}</span>
        <CopyButton text={cmd} />
      </div>
      <code className="block text-xs bg-bg-app rounded p-2 font-mono break-all text-foreground/80">
        {cmd}
      </code>
    </div>
  );
}

export function AgentHint({ prompt }: { prompt: string }) {
  const { t } = useLanguage();

  return (
    <div className="rounded-md border border-dashed border-agent/20 bg-agent/5 p-3">
      <p className="text-sm font-body text-muted-foreground">
        <strong className="text-foreground/80">{t('setupHelp.agentQuestion')}</strong>{' '}
        {t('setupHelp.agentInstruction')}
      </p>
      <div className="flex items-center justify-between mt-1">
        <code className="text-xs font-mono text-agent">{prompt}</code>
        <CopyButton text={prompt} />
      </div>
    </div>
  );
}

export function DockerFixGuide({ state }: { state?: string }) {
  const { t } = useLanguage();

  if (state === 'permission_denied') {
    return (
      <div className="space-y-2 text-sm">
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-body font-medium text-foreground">
              {t('setupHelp.dockerGroupFix')}
            </span>
            <CopyButton text={DOCKER_PERM_CMD} />
          </div>
          <code className="block text-xs bg-bg-app rounded p-2 font-mono break-all text-foreground/80">
            {DOCKER_PERM_CMD}
          </code>
          <p className="text-sm font-body text-muted-foreground mt-1">
            {t('setupHelp.dockerGroupRelogin')}
          </p>
        </div>
        <AgentHint prompt={t('setupHelp.agentPrompt.fixDockerPermission')} />
      </div>
    );
  }

  if (state === 'not_running') {
    return (
      <div className="space-y-2 text-sm">
        <CommandBlock label="Linux / WSL2" cmd={DOCKER_START_LINUX} />
        <CommandBlock label="macOS" cmd={DOCKER_START_MAC} />
        <AgentHint prompt={t('setupHelp.agentPrompt.startDocker')} />
      </div>
    );
  }

  return (
    <div className="space-y-2 text-sm">
      <CommandBlock label="Linux / WSL2" cmd={DOCKER_LINUX_CMD} />
      <CommandBlock label="macOS" cmd={DOCKER_MAC_CMD} />
      <AgentHint prompt={t('setupHelp.agentPrompt.installDocker')} />
    </div>
  );
}
