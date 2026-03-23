import { useState, useCallback, useEffect } from 'react';
import { useSetup } from '@/hooks/use-setup';
import {
  startTraefik,
  completeSetup,
  connectGithub,
  startGithubDeviceFlow,
  pollGithubDeviceFlow,
  configureLLM,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  CheckCircle2,
  XCircle,
  Loader2,
  Network,
  ArrowRight,
  ArrowLeft,
  Terminal,
  Copy,
  Check,
  Github,
  Rocket,
  ExternalLink,
  Globe,
  Key,
  Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';

const STORAGE_KEY = 'openlander-setup-step';

function getStoredStep(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return Math.min(parseInt(stored, 10), 3);
  } catch {
    // localStorage not available
  }
  return 0;
}

function storeStep(step: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, String(step));
  } catch {
    // localStorage not available
  }
}

function clearStoredStep(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // silent
  }
}

export function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const { status, loading, refetch } = useSetup();
  const { t, language, setLanguage } = useLanguage();
  const [step, setStep] = useState(getStoredStep);
  const [startingTraefik, setStartingTraefik] = useState(false);
  const [completing, setCompleting] = useState(false);

  // GitHub Form State
  const [githubToken, setGithubToken] = useState('');
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubError, setGithubError] = useState('');
  // Device Flow state
  const [deviceFlow, setDeviceFlow] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
  } | null>(null);
  const [deviceFlowPolling, setDeviceFlowPolling] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // LLM Form State
  const [llmProvider, setLlmProvider] = useState(status?.llm?.provider || 'gemini');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmError, setLlmError] = useState('');

  // Persist step on change
  useEffect(() => {
    storeStep(step);
  }, [step]);

  const goNext = () => setStep((s) => Math.min(s + 1, 3));
  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const handleStartTraefik = async () => {
    setStartingTraefik(true);
    try {
      await startTraefik();
      await refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setStartingTraefik(false);
    }
  };

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

  // Device Flow handlers
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
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(deviceFlow.userCode);
      } else {
        const ta = document.createElement('textarea');
        ta.value = deviceFlow.userCode;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      window.prompt('Copy this code:', deviceFlow.userCode);
    }
  };

  const handleCancelDeviceFlow = () => {
    setDeviceFlow(null);
    setDeviceFlowPolling(false);
    setGithubError('');
  };

  // Polling effect for Device Flow
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
        // Silently continue polling on network errors
      }
    }, deviceFlow.interval * 1000);

    return () => clearInterval(pollInterval);
  }, [deviceFlowPolling, deviceFlow, refetch]);

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setLlmSaving(true);
    setLlmError('');
    try {
      await configureLLM(llmProvider, llmApiKey.trim());
      await refetch();
      goNext();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save API Key';
      setLlmError(message);
    } finally {
      setLlmSaving(false);
    }
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await completeSetup();
      clearStoredStep();
      onComplete();
    } catch (err) {
      console.error(err);
    } finally {
      setCompleting(false);
    }
  };

  if (loading || !status) {
    return (
      <div className="flex items-center justify-center h-screen bg-bg-app">
        <Loader2 className="w-8 h-8 animate-spin text-agent" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-bg-app p-4">
      {/* Grid background decoration */}
      <div className="fixed inset-0 bg-[linear-gradient(rgba(6,182,212,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(6,182,212,0.03)_1px,transparent_1px)] bg-[size:64px_64px] pointer-events-none" />

      <div className="relative w-full max-w-xl z-10">
        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[0, 1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={cn(
                  'w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono transition-all duration-300',
                  s < step && 'bg-agent text-bg-app',
                  s === step && 'bg-agent/20 text-agent border border-agent/50',
                  s > step && 'bg-bg-subtle text-muted-ol border border-border',
                )}
              >
                {s < step ? <Check className="h-4 w-4" /> : s + 1}
              </div>
              {s < 3 && (
                <div
                  className={cn('w-12 h-px transition-colors', s < step ? 'bg-agent' : 'bg-border')}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 0: Language */}
        {step === 0 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center space-y-6">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-agent/10 flex items-center justify-center">
                <Globe className="h-8 w-8 text-agent" />
              </div>
              <div className="space-y-2">
                <h1 className="font-display text-3xl font-bold text-primary-ol tracking-tight">
                  {'Language 🌐'}
                </h1>
              </div>

              {/* Language selection cards */}
              <div className="grid grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setLanguage('en')}
                  className={cn(
                    'flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all',
                    language === 'en'
                      ? 'border-foreground bg-bg-subtle/50'
                      : 'border-border bg-bg-subtle/30 hover:border-border/80',
                  )}
                >
                  <span className="text-4xl">🇺🇸</span>
                  <span className="text-sm font-body font-medium">{'English'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage('ko')}
                  className={cn(
                    'flex flex-col items-center gap-3 p-6 rounded-xl border-2 transition-all',
                    language === 'ko'
                      ? 'border-foreground bg-bg-subtle/50'
                      : 'border-border bg-bg-subtle/30 hover:border-border/80',
                  )}
                >
                  <span className="text-4xl">🇰🇷</span>
                  <span className="text-sm font-body font-medium">{'한국어'}</span>
                </button>
              </div>

              <Button
                onClick={goNext}
                size="lg"
                className="w-full bg-agent text-bg-app hover:bg-agent/90 font-body gap-2"
              >
                {'Continue'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {/* Step 1: Welcome */}
        {step === 1 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="text-center space-y-6">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-agent/10 flex items-center justify-center">
                <Terminal className="h-8 w-8 text-agent" />
              </div>
              <div className="space-y-2">
                <h1 className="font-display text-3xl font-bold text-primary-ol tracking-tight">
                  {t('setup.welcome.title')}
                </h1>
                <p className="text-lg font-body text-secondary-ol">{t('setup.welcome.subtitle')}</p>
              </div>

              {/* Infrastructure status */}
              <div className="space-y-3 text-left">
                <StatusRow
                  ok={status.docker.ok}
                  label={'Docker Engine'}
                  detail={status.docker.message}
                />
                {!status.docker.ok && (
                  <div className="ml-10 space-y-2">
                    <DockerFixGuide state={status.docker.state} />
                    <Button onClick={refetch} variant="outline" size="sm" className="text-xs">
                      {'Refresh Status'}
                    </Button>
                  </div>
                )}

                <StatusRow
                  ok={status.traefik.ok}
                  label={'Traefik Proxy'}
                  detail={status.traefik.ok ? 'Running' : 'Stopped'}
                />
                {!status.traefik.ok && status.docker.ok && (
                  <div className="ml-10">
                    <Button
                      onClick={handleStartTraefik}
                      disabled={startingTraefik}
                      size="sm"
                      variant="outline"
                      className="text-xs gap-1.5"
                    >
                      {startingTraefik && <Loader2 className="h-3 w-3 animate-spin" />}
                      <Network className="h-3 w-3" />
                      {'Traefik Proxy'}
                    </Button>
                  </div>
                )}
              </div>

              <Button
                onClick={goNext}
                disabled={!status.docker.ok}
                size="lg"
                className="w-full bg-agent text-bg-app hover:bg-agent/90 font-body gap-2"
              >
                {'Get Started'}
                <ArrowRight className="h-4 w-4" />
              </Button>

              {!status.docker.ok && (
                <p className="text-sm font-body text-muted-ol">
                  {t('setup.welcome.dockerRequired')}
                </p>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
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
                  <span className="text-sm font-body font-medium text-primary-ol">
                    {'GitHub Access'}
                  </span>
                  <Badge variant="outline" className="text-xs py-0">
                    Optional
                  </Badge>
                </div>
                <p className="text-sm font-body text-muted-ol">{t('setup.github.description')}</p>

                {status?.github?.ok ? (
                  <div className="flex items-center gap-2 p-3 rounded-lg border border-success/20 bg-success/5 text-success">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm font-medium">
                      Connected as {status.github.username}
                    </span>
                  </div>
                ) : deviceFlow ? (
                  // Device Flow active - show code
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
                        onClick={handleCancelDeviceFlow}
                        className="text-xs font-body text-muted-ol"
                      >
                        {'Cancel'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  // Not connected - show OAuth button + PAT fallback
                  <div className="space-y-3">
                    <Button
                      type="button"
                      onClick={handleStartDeviceFlow}
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
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={goBack}
                  className="gap-1.5 font-body"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {'Back'}
                </Button>
                <Button
                  onClick={goNext}
                  size="lg"
                  className="flex-1 bg-agent text-bg-app hover:bg-agent/90 font-body gap-2"
                >
                  {status?.github?.ok ? 'Continue' : 'Skip for now'}
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: API Key */}
        {step === 3 && (
          <div className="animate-in fade-in slide-in-from-right-4 duration-300">
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="mx-auto w-16 h-16 rounded-2xl bg-agent/10 flex items-center justify-center">
                  <Key className="h-8 w-8 text-agent" />
                </div>
                <h2 className="font-display text-2xl font-bold text-primary-ol tracking-tight">
                  {'API Key'}
                </h2>
                <p className="text-sm font-body text-secondary-ol">
                  {'Optional: Enables smart auto-recovery'}
                </p>
              </div>

              <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-3">
                <p className="text-sm font-body text-muted-ol">
                  Provide an LLM API key to enable smart auto-recovery. Without it, programmatic
                  recovery recipes are used.
                </p>

                <form onSubmit={handleSaveApiKey} className="space-y-3">
                  <div className="space-y-1.5">
                    <p className="text-xs font-body text-muted-ol">Provider</p>
                    <select
                      value={llmProvider}
                      onChange={(e) => setLlmProvider(e.target.value)}
                      className="w-full rounded-md border border-border bg-bg-app px-3 py-2 text-sm font-mono"
                    >
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic</option>
                      <option value="openrouter">OpenRouter</option>
                      <option value="ollama">Ollama (Local)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-xs font-body text-muted-ol">API Key</p>
                    <Input
                      type="password"
                      placeholder={
                        llmProvider === 'ollama'
                          ? 'Not required for Ollama'
                          : status?.llm?.ok
                            ? '••••••••••••'
                            : 'sk-...'
                      }
                      value={llmApiKey}
                      onChange={(e) => setLlmApiKey(e.target.value)}
                      disabled={llmProvider === 'ollama'}
                      className="font-mono text-sm bg-bg-app border-border"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={llmSaving || (llmProvider !== 'ollama' && !llmApiKey.trim())}
                    size="sm"
                    className="w-full gap-1.5 bg-agent text-bg-app hover:bg-agent/90 font-body"
                  >
                    {llmSaving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    Save API Key
                  </Button>
                  {llmError && <p className="text-sm font-body text-error">{llmError}</p>}
                </form>
              </div>

              {/* Summary */}
              <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-2">
                <p className="text-xs font-body text-muted-ol uppercase tracking-wider">
                  {'Setup Summary'}
                </p>
                <StatusRow
                  ok={status.docker.ok}
                  label="Docker"
                  detail={status.docker.ok ? 'Running' : 'Error'}
                />
                <StatusRow
                  ok={status.traefik.ok}
                  label="Traefik"
                  detail={status.traefik.ok ? 'Running' : 'Stopped'}
                />
                <StatusRow
                  ok={status.github?.ok || false}
                  label="GitHub"
                  detail={status.github?.ok ? 'Connected' : 'Skipped'}
                />
                <StatusRow
                  ok={status.llm?.ok || false}
                  label="API Key"
                  detail={status.llm?.ok ? 'Configured' : 'Skipped'}
                />
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={goBack}
                  className="gap-1.5 font-body"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  {'Back'}
                </Button>
                <Button
                  onClick={handleComplete}
                  disabled={!status.docker.ok || completing}
                  size="lg"
                  className="flex-1 bg-agent text-bg-app hover:bg-agent/90 font-body gap-2"
                >
                  {completing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Rocket className="h-4 w-4" />
                  )}
                  {'Start Deploying'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sub-components                                                      */
/* ------------------------------------------------------------------ */

function StatusRow({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="shrink-0">
        {ok ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : (
          <XCircle className="h-4 w-4 text-error" />
        )}
      </div>
      <span className="text-sm font-body text-primary-ol">{label}</span>
      <span className="text-xs font-body text-muted-ol ml-auto">{detail}</span>
    </div>
  );
}

/* Docker Install Guide ------------------------------------------------- */

const DOCKER_LINUX_CMD = 'curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER';
const DOCKER_MAC_CMD = 'brew install --cask docker';
const DOCKER_START_LINUX = 'sudo systemctl start docker';
const DOCKER_START_MAC = 'open -a Docker';
const DOCKER_PERM_CMD = 'sudo usermod -aG docker $USER && newgrp docker';
const DOCKER_AGENT_PROMPT = 'Install Docker on this machine and start the daemon';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt('Copy this command:', text);
    }
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-bg-subtle hover:bg-bg-subtle/80 text-muted-ol hover:text-secondary-ol transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3 h-3 text-success" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function DockerFixGuide({ state }: { state?: string }) {
  if (state === 'permission_denied') {
    return (
      <div className="space-y-2 text-sm">
        <div className="rounded-md border border-warning/30 bg-warning/5 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-body font-medium text-primary-ol">
              Fix: Add user to docker group
            </span>
            <CopyButton text={DOCKER_PERM_CMD} />
          </div>
          <code className="block text-xs bg-bg-app rounded p-2 font-mono break-all text-secondary-ol">
            {DOCKER_PERM_CMD}
          </code>
          <p className="text-sm font-body text-muted-ol mt-1">
            Then log out and back in for the group change to take effect.
          </p>
        </div>
        <AgentHint prompt="Add the current user to the docker group and restart the Docker daemon" />
      </div>
    );
  }

  if (state === 'not_running') {
    return (
      <div className="space-y-2 text-sm">
        <CommandBlock label="Linux / WSL2" cmd={DOCKER_START_LINUX} />
        <CommandBlock label="macOS" cmd={DOCKER_START_MAC} />
        <AgentHint prompt="Start the Docker daemon on this machine" />
      </div>
    );
  }

  // not_installed
  return (
    <div className="space-y-2 text-sm">
      <CommandBlock label="Linux / WSL2" cmd={DOCKER_LINUX_CMD} />
      <CommandBlock label="macOS" cmd={DOCKER_MAC_CMD} />
      <AgentHint prompt={DOCKER_AGENT_PROMPT} />
    </div>
  );
}

function CommandBlock({ label, cmd }: { label: string; cmd: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-subtle/30 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-body font-medium text-secondary-ol">{label}</span>
        <CopyButton text={cmd} />
      </div>
      <code className="block text-xs bg-bg-app rounded p-2 font-mono break-all text-secondary-ol">
        {cmd}
      </code>
    </div>
  );
}

function AgentHint({ prompt }: { prompt: string }) {
  return (
    <div className="rounded-md border border-dashed border-agent/20 bg-agent/5 p-3">
      <p className="text-sm font-body text-muted-ol">
        <strong className="text-secondary-ol">Using an AI coding tool?</strong> Paste this:
      </p>
      <div className="flex items-center justify-between mt-1">
        <code className="text-xs font-mono text-agent">{prompt}</code>
        <CopyButton text={prompt} />
      </div>
    </div>
  );
}
