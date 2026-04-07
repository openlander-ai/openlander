import { useState } from 'react';
import { Loader2, Save, Eye, EyeOff, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button.js';
import { Input } from '@/components/ui/input.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select.js';
import { cn } from '@/lib/utils.js';
import { useLanguage } from '@/i18n/context.js';
import { PROVIDER_DEFS, getDefaultModel } from './ai-settings-constants.js';

interface TestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

interface AddProviderFormProps {
  onSubmit: (data: { provider: string; apiKey: string; defaultModel: string }) => Promise<void>;
  onCancel: () => void;
  onTestNew: (data: { provider: string; apiKey: string; defaultModel: string }) => Promise<void>;
  isTestingNew: boolean;
  testResult?: TestResult;
}

export function AddProviderForm({
  onSubmit,
  onCancel,
  onTestNew,
  isTestingNew,
  testResult,
}: AddProviderFormProps) {
  const { t } = useLanguage();

  const [provider, setProvider] = useState('gemini');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState(getDefaultModel('gemini'));
  const [showApiKey, setShowApiKey] = useState(false);
  const [adding, setAdding] = useState(false);

  const activeProviderDef = PROVIDER_DEFS.find((p) => p.id === provider);
  const keyRequired = provider !== 'ollama';
  const canSubmit = !adding && (!keyRequired || apiKey.trim().length > 0);

  const handleProviderChange = (val: string) => {
    setProvider(val);
    setApiKey('');
    setDefaultModel(getDefaultModel(val));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdding(true);
    try {
      await onSubmit({ provider, apiKey, defaultModel });
      setProvider('gemini');
      setApiKey('');
      setDefaultModel(getDefaultModel('gemini'));
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-bg-subtle/40 p-5 space-y-5 relative overflow-hidden ring-1 ring-black/5 shadow-sm">
      <div className="absolute top-0 left-0 w-1 h-full bg-agent" />
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-primary-ol">
          {t('llmSettings.addProvider') || 'Add Provider'}
        </h3>
        <Button variant="ghost" size="sm" onClick={onCancel} className="h-8 text-xs text-muted-ol">
          {t('llmSettings.cancel') || 'Cancel'}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <p className="text-xs font-body text-muted-ol">
              {t('llmSettings.provider') || 'Provider'}
            </p>
            <Select value={provider} onValueChange={handleProviderChange}>
              <SelectTrigger className="w-full bg-bg-app border-border text-primary-ol">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDER_DEFS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    <span className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', p.color)} />
                      {p.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <p className="text-xs font-body text-muted-ol">
              {t('llmSettings.defaultModel') || 'Default Model'}
            </p>
            <Select value={defaultModel} onValueChange={setDefaultModel}>
              <SelectTrigger className="w-full bg-bg-app border-border text-primary-ol font-mono">
                <SelectValue placeholder="Select model" />
              </SelectTrigger>
              <SelectContent>
                {(activeProviderDef?.models ?? []).map((model) => (
                  <SelectItem key={model} value={model} className="font-mono text-sm">
                    {model}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs font-body text-muted-ol">{t('llmSettings.apiKey') || 'API Key'}</p>
          <div className="relative">
            <Input
              type={showApiKey ? 'text' : 'password'}
              placeholder="sk-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="pr-10 font-mono text-sm bg-bg-app border-border"
              required={keyRequired}
            />
            <button
              type="button"
              onClick={() => setShowApiKey((prev) => !prev)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-ol hover:text-primary-ol flex items-center justify-center p-1 rounded-sm focus:outline-none focus:ring-1 focus:ring-agent"
            >
              {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          <Button
            type="submit"
            disabled={!canSubmit}
            size="sm"
            className="gap-1.5 font-body bg-agent text-white hover:bg-agent/90"
          >
            {adding ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {t('llmSettings.addProvider') || 'Save Provider'}
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isTestingNew || (!apiKey.trim() && keyRequired)}
            onClick={() => onTestNew({ provider, apiKey, defaultModel })}
            className="gap-1.5 font-body text-xs"
          >
            {isTestingNew ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Zap className="h-3.5 w-3.5" />
            )}
            {t('llmSettings.testConnection') || 'Test'}
          </Button>
        </div>

        {testResult && (
          <div
            className={cn(
              'rounded-md px-3 py-2 text-xs font-body mt-2',
              testResult.ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
            )}
          >
            {testResult.ok
              ? (t('llmSettings.testSuccess') || 'Success!').replace(
                  '{ms}',
                  testResult.latencyMs?.toString() || '0',
                )
              : testResult.error || t('llmSettings.testFail') || 'Failed'}
          </div>
        )}
      </form>
    </div>
  );
}
