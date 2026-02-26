import React, { useState, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
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
export function LlmSetup({ ctx: _ctx, onNext }: ScreenProps): React.ReactElement {
  const [step, setStep] = useState<LlmStep>('provider');
  const [provider, setProvider] = useState<LlmProvider | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleProviderSelect = useCallback((item: { value: string }) => {
    const selectedProvider = item.value as LlmProvider;
    setProvider(selectedProvider);
    setModel(MODEL_DEFAULTS[selectedProvider]);

    if (selectedProvider === 'ollama') {
      // Ollama doesn't need API key - save and proceed
      setStep('saving');
    } else {
      setStep('api_key');
    }
  }, []);

  const handleApiKeySubmit = useCallback(() => {
    if (!apiKey.trim()) {
      setError('API key is required');
      return;
    }
    setError(null);
    setStep('model');
  }, [apiKey]);

  const handleModelSubmit = useCallback(() => {
    setStep('saving');
  }, []);

  // Handle saving when step changes to 'saving'
  React.useEffect(() => {
    if (step === 'saving' && provider) {
      updateConfig({
        llm: {
          provider,
          apiKey: provider === 'ollama' ? '' : apiKey.trim(),
          model: model.trim() || MODEL_DEFAULTS[provider],
        },
      });
      // Auto-advance after brief delay
      setTimeout(() => {
        onNext();
      }, 500);
    }
  }, [step, provider, apiKey, model, onNext]);

  useInput((_input, key) => {
    if (key.return) {
      if (step === 'api_key') {
        handleApiKeySubmit();
      } else if (step === 'model') {
        handleModelSubmit();
      }
    }
  });

  const renderContent = () => {
    switch (step) {
      case 'provider':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box marginBottom={1}>
              <Text dimColor>Choose your AI provider:</Text>
            </Box>
            <SelectInput items={LLM_PROVIDERS} onSelect={handleProviderSelect} />
          </Box>
        );

      case 'api_key':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box marginBottom={1}>
              <Text dimColor>Enter your {provider} API key:</Text>
            </Box>
            {error && (
              <Box marginBottom={1}>
                <Text color="red">❌ {error}</Text>
              </Box>
            )}
            <Box>
              <Text color="cyan">Key: </Text>
              <TextInput
                value={apiKey}
                onChange={setApiKey}
                onSubmit={handleApiKeySubmit}
                mask="*"
              />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Press Enter to continue</Text>
            </Box>
          </Box>
        );

      case 'model':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box marginBottom={1}>
              <Text dimColor>Model (press Enter for default):</Text>
            </Box>
            <Box>
              <Text color="cyan">Model: </Text>
              <TextInput value={model} onChange={setModel} onSubmit={handleModelSubmit} />
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Default: {provider ? MODEL_DEFAULTS[provider] : ''}</Text>
            </Box>
          </Box>
        );

      case 'saving':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box>
              <Text color="green">✅ {provider === 'ollama' ? 'Ollama' : provider} configured</Text>
            </Box>
            <Box marginTop={1}>
              <Text dimColor>Continuing...</Text>
            </Box>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={20} padding={2}>
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle="round"
        borderColor="cyan"
        paddingX={4}
        paddingY={2}
        width={60}
      >
        <Box marginBottom={1}>
          <Text bold color="cyan">
            [3/5] AI Provider
          </Text>
        </Box>

        <Box marginTop={2}>{renderContent()}</Box>
      </Box>
    </Box>
  );
}
