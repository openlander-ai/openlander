import { Key, Loader2, ArrowLeft, Rocket, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { StatusRow } from './shared';
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
  const { t } = useLanguage();

  return (
    <div className="animate-in fade-in slide-in-from-right-4 duration-300">
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <div className="mx-auto w-16 h-16 rounded-2xl bg-agent/10 flex items-center justify-center">
            <Key className="h-8 w-8 text-agent" />
          </div>
          <h2 className="font-display text-2xl font-bold text-primary-ol tracking-tight">
            {t('setup.llmStep.title')}
          </h2>
          <p className="text-sm font-body text-secondary-ol">{t('setup.llmStep.subtitle')}</p>
        </div>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-3">
          <p className="text-sm font-body text-muted-ol">{t('setup.llmStep.description')}</p>

          <form onSubmit={onSaveApiKey} className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-body text-muted-ol">{t('setup.llmStep.provider')}</p>
              <Select value={llmProvider} onValueChange={onSetLlmProvider}>
                <SelectTrigger className="w-full bg-bg-app border-border font-mono text-sm">
                  <SelectValue placeholder="Choose provider..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gemini">Google Gemini</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="openrouter">OpenRouter</SelectItem>
                  <SelectItem value="ollama">Ollama (Local)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-body text-muted-ol">{t('setup.llmStep.apiKeyLabel')}</p>
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
              {t('setup.llmStep.testAndSave')}
            </Button>
            {llmError && <p className="text-sm font-body text-error">{llmError}</p>}
          </form>
        </div>

        {/* Summary */}
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-2">
          <p className="text-xs font-body text-muted-ol uppercase tracking-wider">
            {t('setup.llmStep.setupSummary')}
          </p>
          <StatusRow
            ok={status.docker.ok}
            label={t('setup.llmStep.docker')}
            detail={status.docker.ok ? t('setup.infra.running') : t('setup.llmStep.error')}
          />
          <StatusRow
            ok={status.traefik.ok}
            label={t('setup.llmStep.traefik')}
            detail={status.traefik.ok ? t('setup.infra.running') : t('setup.infra.stopped')}
          />
          <StatusRow
            ok={status.github?.ok || false}
            label={t('setup.llmStep.github')}
            detail={status.github?.ok ? t('setup.llmStep.connected') : t('setup.llmStep.skipped')}
          />
          <StatusRow
            ok={status.llm?.ok || false}
            label={t('setup.llmStep.title')}
            detail={status.llm?.ok ? t('setup.llmStep.configured') : t('setup.llmStep.skipped')}
          />
        </div>

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onBack} className="gap-1.5 font-body">
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('setup.common.back')}
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
            {t('setup.llmStep.startDeploying')}
          </Button>
        </div>
      </div>
    </div>
  );
}
