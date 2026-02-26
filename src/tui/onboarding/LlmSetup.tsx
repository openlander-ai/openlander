import { createSignal, createEffect, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import TextInput from '../components/IMETextInput.js';

import type { ScreenProps } from './index.js';
import { updateConfig } from '../../config/index.js';
import type { OpenLanderConfig } from '../../config/index.js';

type LlmStep = 'provider' | 'api_key' | 'model' | 'saving';

type LlmProvider = OpenLanderConfig['llm']['provider'];

const LLM_PROVIDERS: Array<{ label: string; value: LlmProvider }> = [
  { label: 'OpenRouter (free, no credit card)', value: 'openrouter' },
  { label: 'Gemini (free tier available)', value: 'gemini' },
  { label: 'Anthropic (Claude)', value: 'anthropic' },
  { label: 'OpenAI (GPT)', value: 'openai' },
  { label: 'Ollama (local)', value: 'ollama' },
];

const MODEL_DEFAULTS: Record<LlmProvider, string> = {
  openrouter: 'google/gemini-2.0-flash-exp:free',
  gemini: 'gemini-2.0-flash',
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini',
  ollama: 'llama3.2',
};

/**
 * LlmSetup screen - select AI provider and enter API key.
 */
export function LlmSetup({ ctx: _ctx, onNext }: ScreenProps): JSX.Element {
  const [step, setStep] = createSignal<LlmStep>('provider');
  const [provider, setProvider] = createSignal<LlmProvider | null>(null);
  const [apiKey, setApiKey] = createSignal('');
  const [model, setModel] = createSignal('');
  const [error, setError] = createSignal<string | null>(null);
  const [providerIndex, setProviderIndex] = createSignal(0);

  const handleProviderSelect = (selectedProvider: LlmProvider) => {
    setProvider(selectedProvider);
    setModel(MODEL_DEFAULTS[selectedProvider]);

    if (selectedProvider === 'ollama') {
      // Ollama doesn't need API key - save and proceed
      setStep('saving');
    } else {
      setStep('api_key');
    }
  };

  const handleApiKeySubmit = () => {
    if (!apiKey().trim()) {
      setError('API key is required');
      return;
    }
    setError(null);
    setStep('model');
  };

  const handleModelSubmit = () => {
    setStep('saving');
  };

  // Handle saving when step changes to 'saving'
  createEffect(() => {
    if (step() === 'saving' && provider()) {
      const p = provider()!;
      updateConfig({
        llm: {
          provider: p,
          apiKey: p === 'ollama' ? '' : apiKey().trim(),
          model: model().trim() || MODEL_DEFAULTS[p],
        },
      });
      // Auto-advance after brief delay
      const timer = setTimeout(() => {
        onNext();
      }, 500);
      onCleanup(() => clearTimeout(timer));
    }
  });

  useKeyboard((evt) => {
    const s = step();

    // Provider selection navigation
    if (s === 'provider') {
      if (evt.key === 'up') {
        setProviderIndex((i) => Math.max(0, i - 1));
      } else if (evt.key === 'down') {
        setProviderIndex((i) => Math.min(LLM_PROVIDERS.length - 1, i + 1));
      } else if (evt.key === 'return') {
        handleProviderSelect(LLM_PROVIDERS[providerIndex()]!.value);
      }
      return;
    }

    if (evt.key === 'return') {
      if (s === 'api_key') {
        handleApiKeySubmit();
      } else if (s === 'model') {
        handleModelSubmit();
      }
    }
  });

  const renderContent = (): JSX.Element => {
    switch (step()) {
      case 'provider':
        return (
          <box flexDirection="column" alignItems="center">
            <box marginBottom={1}>
              <text dim={true}>Choose your AI provider:</text>
            </box>
            <box flexDirection="column">
              {LLM_PROVIDERS.map((item, i) => (
                <box>
                  <text
                    color={providerIndex() === i ? 'cyan' : undefined}
                    bold={providerIndex() === i}
                  >
                    {providerIndex() === i ? '❯ ' : '  '}
                    {item.label}
                  </text>
                </box>
              ))}
            </box>
          </box>
        );

      case 'api_key':
        return (
          <box flexDirection="column" alignItems="center">
            <box marginBottom={1}>
              <text dim={true}>Enter your {provider()} API key:</text>
            </box>
            {error() && (
              <box marginBottom={1}>
                <text color="red">❌ {error()}</text>
              </box>
            )}
            <box>
              <text color="cyan">Key: </text>
              <TextInput
                value={apiKey()}
                onChange={setApiKey}
                onSubmit={handleApiKeySubmit}
                mask="*"
              />
            </box>
            <box marginTop={1}>
              <text dim={true}>Press Enter to continue</text>
            </box>
          </box>
        );

      case 'model':
        return (
          <box flexDirection="column" alignItems="center">
            <box marginBottom={1}>
              <text dim={true}>Model (press Enter for default):</text>
            </box>
            <box>
              <text color="cyan">Model: </text>
              <TextInput value={model()} onChange={setModel} onSubmit={handleModelSubmit} />
            </box>
            <box marginTop={1}>
              <text dim={true}>Default: {provider() ? MODEL_DEFAULTS[provider()!] : ''}</text>
            </box>
          </box>
        );

      case 'saving':
        return (
          <box flexDirection="column" alignItems="center">
            <box>
              <text color="green">
                ✅ {provider() === 'ollama' ? 'Ollama' : provider()} configured
              </text>
            </box>
            <box marginTop={1}>
              <text dim={true}>Continuing...</text>
            </box>
          </box>
        );

      default:
        return <box />;
    }
  };

  return (
    <box flexDirection="column" alignItems="center" justifyContent="center" height={20} padding={2}>
      <box
        flexDirection="column"
        alignItems="center"
        border="round"
        borderColor="cyan"
        paddingX={4}
        paddingY={2}
        width={60}
      >
        <box marginBottom={1}>
          <text bold={true} color="cyan">
            [3/5] AI Provider
          </text>
        </box>

        <box marginTop={2}>{renderContent()}</box>
      </box>
    </box>
  );
}
