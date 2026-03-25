import { Key, Loader2, ArrowLeft, Rocket, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusRow } from './shared';

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

interface LlmStepProps {
  status: SetupStatus;
  llmProvider: string;
  llmApiKey: string;
  llmSaving: boolean;
  llmError: string;
  completing: boolean;
  onSetLlmProvider: (provider: string) => void;
  onSetLlmApiKey: (key: string) => void;
  onSaveApiKey: (e: React.FormEvent) => Promise<void>;
  onComplete: () => Promise<void>;
  onBack: () => void;
}

export function LlmStep({
  status,
  llmProvider,
  llmApiKey,
  llmSaving,
  llmError,
  completing,
  onSetLlmProvider,
  onSetLlmApiKey,
  onSaveApiKey,
  onComplete,
  onBack,
}: LlmStepProps) {
  return (
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
            {'Required — AI analyzes build failures and auto-fixes them'}
          </p>
        </div>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-3">
          <p className="text-sm font-body text-muted-ol">
            An LLM API key is required for OpenLander to analyze build failures and automatically
            fix them. This is the core feature that sets OpenLander apart.
          </p>

          <form onSubmit={onSaveApiKey} className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-body text-muted-ol">Provider</p>
              <select
                value={llmProvider}
                onChange={(e) => onSetLlmProvider(e.target.value)}
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
                onChange={(e) => onSetLlmApiKey(e.target.value)}
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
              Test & Save
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
          <Button type="button" variant="outline" onClick={onBack} className="gap-1.5 font-body">
            <ArrowLeft className="h-3.5 w-3.5" />
            {'Back'}
          </Button>
          <Button
            onClick={onComplete}
            disabled={!status.docker.ok || !status.llm?.ok || completing}
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
  );
}
