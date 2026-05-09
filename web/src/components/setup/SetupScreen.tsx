import { useState, useEffect } from 'react';
import { useSetup } from '@/hooks/use-setup';
import { startTraefik, completeSetup, connectGithub, disconnectGithub } from '@/lib/api';
import { Loader2, Check } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { useCopy } from '@/hooks/use-copy';
import { useGithubDeviceFlow } from '@/hooks/use-github-device-flow';
import { LanguageStep } from './LanguageStep';
import { InfraStep } from './InfraStep';
import { GithubStep } from './GithubStep';
import { McpGuideStep } from './McpGuideStep';

const STORAGE_KEY = 'openlander-setup-step';
const MAX_STEP = 3;

function getStoredStep(): number {
  // PasswordStep was removed in v0.1 cleanup — steps are now Language /
  // Infra / GitHub / MCP. Clamp legacy localStorage values into the new
  // 0..3 range. Old step 1 (PasswordStep) folds back to step 0 so the
  // user sees a clear restart of the post-auth flow rather than landing
  // mid-flow on Infra; old steps 2..4 shift one earlier into Infra,
  // GitHub, MCP. Graceful enough not to need a one-shot migration for
  // v0.1.
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (Number.isNaN(parsed)) return 0;
      if (parsed <= 0) return 0;
      // Old step 1 (PasswordStep) → fold into 0 (Language) so the user
      // sees a clear restart of the post-auth flow rather than a sudden
      // jump into Infra they may not have seen yet.
      if (parsed === 1) return 0;
      // Old steps 2..4 → new 1..3 (one position earlier).
      return Math.min(parsed - 1, MAX_STEP);
    }
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
  const { language, setLanguage } = useLanguage();
  const { copy, isCopied } = useCopy();
  const [step, setStep] = useState(getStoredStep);
  const [startingTraefik, setStartingTraefik] = useState(false);

  // GitHub Form State
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
  } = useGithubDeviceFlow({ onComplete: refetch });

  // Persist step on change
  useEffect(() => {
    storeStep(step);
  }, [step]);

  const goNext = () => setStep((s) => Math.min(s + 1, MAX_STEP));
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

  const handleDisconnectGithub = async () => {
    setGithubDisconnecting(true);
    setGithubError('');
    try {
      await disconnectGithub();
      resetDeviceFlow();
      setGithubToken('');
      await refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect GitHub';
      setGithubError(message);
    } finally {
      setGithubDisconnecting(false);
    }
  };

  const handleCopyCode = async () => {
    if (!deviceFlow?.userCode) return;
    await copy(deviceFlow.userCode, 'code');
  };

  const handleComplete = async () => {
    try {
      await completeSetup();
      clearStoredStep();
      onComplete();
    } catch (err) {
      console.error(err);
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
        {/* Step indicators — Language / Infra / GitHub / MCP. PasswordStep
            is owned by AuthScreen (web/src/pages/LoginPage.tsx) since v0.1,
            so the wizard no longer prompts for a password here. */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[0, 1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono transition-all duration-300 ${
                  s < step ? 'bg-agent text-white' : ''
                } ${s === step ? 'bg-agent/20 text-agent border border-agent/50' : ''} ${
                  s > step ? 'bg-bg-subtle text-muted-foreground border border-border' : ''
                }`}
              >
                {s < step ? <Check className="h-4 w-4" /> : s + 1}
              </div>
              {s < MAX_STEP && (
                <div
                  className={`w-12 h-px transition-colors ${s < step ? 'bg-agent' : 'bg-border'}`}
                />
              )}
            </div>
          ))}
        </div>

        {/* Step 0: Language */}
        {step === 0 && (
          <LanguageStep language={language} setLanguage={setLanguage} onNext={goNext} />
        )}

        {/* Step 1: Infrastructure */}
        {step === 1 && (
          <InfraStep
            status={status}
            refetch={refetch}
            startingTraefik={startingTraefik}
            onStartTraefik={handleStartTraefik}
            onNext={goNext}
          />
        )}

        {/* Step 2: GitHub */}
        {step === 2 && (
          <GithubStep
            status={status}
            deviceFlow={deviceFlow}
            githubToken={githubToken}
            githubConnecting={githubConnecting}
            githubDisconnecting={githubDisconnecting}
            githubError={githubError}
            copiedCode={isCopied('code')}
            onSetGithubToken={setGithubToken}
            onConnectGithub={handleConnectGithub}
            onDisconnectGithub={handleDisconnectGithub}
            onStartDeviceFlow={handleStartDeviceFlow}
            onCopyCode={handleCopyCode}
            onCancelDeviceFlow={handleCancelDeviceFlow}
            onNext={goNext}
            onBack={goBack}
          />
        )}

        {/* Step 3: MCP Guide */}
        {step === 3 && <McpGuideStep onNext={handleComplete} onBack={goBack} />}
      </div>
    </div>
  );
}
