import { useState } from 'react';
import { Check, Key, Loader2, Save } from 'lucide-react';
import { configureLLM, type SetupStatus } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface LlmSettingsTabProps {
  status: SetupStatus | null;
  refetch: () => Promise<void>;
}

export function LlmSettingsTab({ status, refetch }: LlmSettingsTabProps) {
  const [llmProvider, setLlmProvider] = useState(status?.llm?.provider || 'gemini');
  const [llmApiKey, setLlmApiKey] = useState('');
  const [llmSaving, setLlmSaving] = useState(false);
  const [llmSaved, setLlmSaved] = useState(false);
  const [llmMessage, setLlmMessage] = useState('');
  const [llmError, setLlmError] = useState('');

  const handleSaveApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setLlmSaving(true);
    setLlmMessage('');
    setLlmError('');
    try {
      await configureLLM(llmProvider, llmApiKey.trim());
      await refetch();
      setLlmMessage('API Key saved successfully');
      setLlmApiKey('');
      setLlmSaved(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save API Key';
      setLlmError(message);
    } finally {
      setLlmSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <Key className="h-4 w-4 text-secondary-ol" />
        <h2 className="font-display text-lg font-semibold text-primary-ol">
          {'AI Model Configuration'}
        </h2>
      </div>

      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-3">
        <p className="text-sm font-body text-secondary-ol">
          Provide an LLM API key to enable smart auto-recovery. Without it, programmatic recovery
          recipes are used.
        </p>

        <form onSubmit={handleSaveApiKey} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <p className="text-xs font-body text-muted-ol">Provider</p>
              <select
                value={llmProvider}
                onChange={(e) => {
                  setLlmProvider(e.target.value);
                  setLlmSaved(false);
                }}
                className="w-full rounded-md border border-border bg-bg-app px-3 py-2 text-sm font-mono"
              >
                <option value="gemini">Google Gemini</option>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="openrouter">OpenRouter</option>
                <option value="ollama">Ollama (Local)</option>
              </select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
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
                onChange={(e) => {
                  setLlmApiKey(e.target.value);
                  setLlmSaved(false);
                }}
                disabled={llmProvider === 'ollama'}
                className="font-mono text-sm bg-bg-app border-border"
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={llmSaving || llmSaved || (llmProvider !== 'ollama' && !llmApiKey.trim())}
            size="sm"
            className={cn(
              'gap-1.5 font-body',
              llmSaved
                ? 'bg-success/10 text-success border border-success/30 hover:bg-success/10'
                : 'bg-agent text-bg-app hover:bg-agent/90',
            )}
          >
            {llmSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : llmSaved ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {llmSaved ? 'Saved' : 'Save API Key'}
          </Button>
          {llmMessage && <p className="text-xs font-body text-success">{llmMessage}</p>}
          {llmError && <p className="text-xs font-body text-error">{llmError}</p>}
        </form>
      </div>
    </section>
  );
}
