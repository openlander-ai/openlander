import { useState } from 'react';
import { Loader2, Save, Eye, EyeOff } from 'lucide-react';
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

interface AddProviderFormProps {
  onSubmit: (data: { provider: string; apiKey: string; defaultModel: string }) => Promise<void>;
  onCancel: () => void;
}

export function AddProviderForm({ onSubmit, onCancel }: AddProviderFormProps) {
  const { t } = useLanguage();

  const [provider, setProvider] = useState('gemini');
  const [apiKey, setApiKey] = useState('');
  const [defaultModel, setDefaultModel] = useState(getDefaultModel('gemini'));
  const [showApiKey, setShowApiKey] = useState(false);
  const [adding, setAdding] = useState(false);

  const keyRequired = true;
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
        <h3 className="text-sm font-medium text-foreground">
          {t('llmSettings.addProvider') || 'Add Provider'}
        </h3>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCancel}
          className="h-8 text-xs text-muted-foreground"
        >
          {t('llmSettings.cancel') || 'Cancel'}
        </Button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <p className="text-xs font-body text-muted-foreground">
            {t('llmSettings.provider') || 'Provider'}
          </p>
          <Select value={provider} onValueChange={handleProviderChange}>
            <SelectTrigger className="w-full bg-bg-app border-border text-foreground">
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
          <p className="text-xs font-body text-muted-foreground">
            {t('llmSettings.apiKey') || 'API Key'}
          </p>
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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground flex items-center justify-center p-1 rounded-sm focus:outline-none focus:ring-1 focus:ring-agent"
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
        </div>
      </form>
    </div>
  );
}
