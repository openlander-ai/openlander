import { useState, useEffect } from 'react';
import { useSetup } from '@/hooks/use-setup';
import {
  startTraefik,
  completeSetup,
  connectGithub,
  disconnectGithub,
  startGithubDeviceFlow,
  pollGithubDeviceFlow,
  configureLLM,
} from '@/lib/api';
import { Loader2, Check } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { useCopy } from '@/hooks/use-copy';
import { LanguageStep } from './LanguageStep';
import { InfraStep } from './InfraStep';
import { GithubStep } from './GithubStep';
import { LlmStep } from './LlmStep';
import { PasswordStep } from './PasswordStep';
import { McpGuideStep } from './McpGuideStep';

const STORAGE_KEY = 'openlander-setup-step';

function getStoredStep(): number {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return Math.min(parseInt(stored, 10), 5);
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
  const [githubError, setGithubError] = useState('');
  // Device Flow state
  const [deviceFlow, setDeviceFlow] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
  } | null>(null);
  const [deviceFlowPolling, setDeviceFlowPolling] = useState(false);

  // LLM Form State
  const [llmProvider, setLlmProvider] = useState(status?.llm?.provider || 'gemini');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmError, setLlmError] = useState('');

  // Persist step on change
  useEffect(() => {
    storeStep(step);
  }, [step]);

  const goNext = () => setStep((s) => Math.min(s + 1, 5));
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
      setDeviceFlow(null);
      setDeviceFlowPolling(false);
      setGithubToken('');
      await refetch();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to disconnect GitHub';
      setGithubError(message);
    } finally {
      setGithubDisconnecting(false);
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
    await copy(deviceFlow.userCode, 'code');
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
        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {[0, 1, 2, 3, 4, 5].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-mono transition-all duration-300 ${
                  s < step ? 'bg-agent text-white' : ''
                } ${s === step ? 'bg-agent/20 text-agent border border-agent/50' : ''} ${
                  s > step ? 'bg-bg-subtle text-muted-ol border border-border' : ''
                }`}
              >
                {s < step ? <Check className="h-4 w-4" /> : s + 1}
              </div>
              {s < 5 && (
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

        {/* Step 1: Password */}
        {step === 1 && <PasswordStep onNext={goNext} onBack={goBack} />}

        {/* Step 2: Infrastructure */}
        {step === 2 && (
          <InfraStep
            status={status}
            refetch={refetch}
            startingTraefik={startingTraefik}
            onStartTraefik={handleStartTraefik}
            onNext={goNext}
          />
        )}

        {/* Step 3: LLM API Key */}
        {step === 3 && (
          <LlmStep
            status={status}
            llmProvider={llmProvider}
            llmApiKey={llmApiKey}
            llmSaving={llmSaving}
            llmError={llmError}
            completing={false}
            onSetLlmProvider={setLlmProvider}
            onSetLlmApiKey={setLlmApiKey}
            onSaveApiKey={handleSaveApiKey}
            onComplete={async () => goNext()}
            onBack={goBack}
          />
        )}

        {/* Step 4: GitHub */}
        {step === 4 && (
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

        {/* Step 5: MCP Guide */}
        {step === 5 && <McpGuideStep onNext={handleComplete} onBack={goBack} />}
      </div>
    </div>
  );
}
