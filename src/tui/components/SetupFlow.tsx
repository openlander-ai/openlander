import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';
import type { AppContext } from '../../app.js';
import { updateConfig, saveConfig, loadConfig } from '../../config/index.js';
import type { OpenLanderConfig } from '../../config/index.js';
import { createGitProvider } from '../../git-providers/index.js';

type Step =
  | 'docker'
  | 'llm-provider'
  | 'llm-key'
  | 'llm-model'
  | 'github'
  | 'github-token'
  | 'done';

interface SetupFlowProps {
  ctx: AppContext;
  onComplete: () => void;
}

interface DockerState {
  state: 'checking' | 'running' | 'not_installed' | 'not_running' | 'permission_denied';
  message: string;
}

const LLM_PROVIDERS = [
  { label: 'Gemini (free tier available)', value: 'gemini' },
  { label: 'OpenRouter (free tier, no credit card)', value: 'openrouter' },
  { label: 'Anthropic Claude', value: 'anthropic' },
  { label: 'OpenAI', value: 'openai' },
  { label: 'Ollama (local)', value: 'ollama' },
];

const MODEL_DEFAULTS: Record<string, string> = {
  gemini: 'gemini-2.0-flash',
  openrouter: 'google/gemini-2.0-flash-exp:free',
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini',
  ollama: 'llama3.2',
};

export function SetupFlow({ ctx, onComplete }: SetupFlowProps): React.ReactElement {
  const [step, setStep] = useState<Step>('docker');
  const [docker, setDocker] = useState<DockerState>({
    state: 'checking',
    message: 'Checking Docker...',
  });
  const [llmProvider, setLlmProvider] = useState('');
  const [llmKey, setLlmKey] = useState('');
  const [llmModel, setLlmModel] = useState('');
  const [githubToken, setGithubToken] = useState('');
  const [validating, setValidating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Docker check
  useEffect(() => {
    if (step !== 'docker') return;
    void (async () => {
      try {
        const status = await ctx.docker.status();
        if (status.state === 'running') {
          setDocker({ state: 'running', message: 'Docker is running.' });
          // Auto-advance after brief pause
          setTimeout(() => setStep('llm-provider'), 800);
        } else if (status.state === 'not_installed') {
          setDocker({ state: 'not_installed', message: 'Docker is not installed.' });
        } else if (status.state === 'not_running') {
          setDocker({
            state: 'not_running',
            message: 'Docker is installed but not running. Start the Docker daemon.',
          });
        } else {
          setDocker({
            state: 'permission_denied',
            message: 'Docker permission denied. Run: sudo usermod -aG docker $USER',
          });
        }
      } catch {
        setDocker({ state: 'not_installed', message: 'Could not detect Docker.' });
      }
    })();
  }, [step, ctx.docker]);

  const handleProviderSelect = useCallback((item: { value: string }) => {
    setLlmProvider(item.value);
    setLlmModel(MODEL_DEFAULTS[item.value] ?? '');
    if (item.value === 'ollama') {
      // Ollama doesn't need API key
      setStep('llm-model');
    } else {
      setStep('llm-key');
    }
  }, []);

  const handleKeySubmit = useCallback((key: string) => {
    if (!key.trim()) return;
    setLlmKey(key.trim());
    setStep('llm-model');
  }, []);

  const handleModelSubmit = useCallback(
    (model: string) => {
      const finalModel = model.trim() || llmModel;
      setLlmModel(finalModel);

      // Save LLM config
      updateConfig({
        llm: {
          provider: llmProvider as OpenLanderConfig['llm']['provider'],
          apiKey: llmKey,
          model: finalModel,
        },
      });

      setStep('github');
    },
    [llmProvider, llmKey, llmModel],
  );

  const handleGithubSkip = useCallback(() => {
    const config = loadConfig();
    saveConfig(config);
    setStep('done');
    setTimeout(() => onComplete(), 500);
  }, [onComplete]);

  const handleGithubSetup = useCallback(() => {
    setStep('github-token');
  }, []);

  const handleGithubTokenSubmit = useCallback(
    (token: string) => {
      if (!token.trim()) {
        handleGithubSkip();
        return;
      }
      setValidating(true);
      setError(null);

      void (async () => {
        try {
          const provider = createGitProvider('github', { token: token.trim(), username: '' });
          const validation = await provider.validateToken();
          if (validation.valid) {
            setGithubToken(token.trim());
            updateConfig({
              gitProviders: {
                github: {
                  token: token.trim(),
                  username: validation.user?.username ?? '',
                },
              },
            });
            const config = loadConfig();
            saveConfig(config);
            setStep('done');
            setTimeout(() => onComplete(), 500);
          } else {
            setError(validation.error ?? 'Invalid token');
            setValidating(false);
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Validation failed');
          setValidating(false);
        }
      })();
    },
    [handleGithubSkip, onComplete],
  );

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="cyan">
        🛬 OpenLander Setup
      </Text>
      <Text dimColor>Let&apos;s get you set up. This takes about 30 seconds.</Text>

      <Box marginTop={1} flexDirection="column">
        {/* Step 1: Docker */}
        <Box>
          <Text
            color={docker.state === 'running' ? 'green' : step === 'docker' ? 'yellow' : 'gray'}
          >
            {docker.state === 'running' ? '✓' : step === 'docker' ? '▸' : '○'}{' '}
          </Text>
          <Text bold={step === 'docker'}>Docker</Text>
          {step === 'docker' && (
            <Box marginLeft={1}>
              {docker.state === 'checking' ? (
                <Box>
                  <Text color="yellow">
                    <Spinner type="dots" />
                  </Text>
                  <Text dimColor> Checking...</Text>
                </Box>
              ) : (
                <Text color={docker.state === 'running' ? 'green' : 'red'}>
                  {' '}
                  — {docker.message}
                </Text>
              )}
            </Box>
          )}
        </Box>

        {/* Step 2: LLM Provider */}
        <Box flexDirection="column">
          <Box>
            <Text
              color={
                llmProvider
                  ? 'green'
                  : step === 'llm-provider' || step === 'llm-key' || step === 'llm-model'
                    ? 'yellow'
                    : 'gray'
              }
            >
              {llmProvider && step !== 'llm-provider' && step !== 'llm-key' && step !== 'llm-model'
                ? '✓'
                : step === 'llm-provider' || step === 'llm-key' || step === 'llm-model'
                  ? '▸'
                  : '○'}{' '}
            </Text>
            <Text bold={step === 'llm-provider' || step === 'llm-key' || step === 'llm-model'}>
              LLM Provider
            </Text>
            {llmProvider && step !== 'llm-provider' && <Text dimColor> — {llmProvider}</Text>}
          </Box>

          {step === 'llm-provider' && (
            <Box marginLeft={2} flexDirection="column">
              <Text dimColor>Choose your AI provider:</Text>
              <SelectInput items={LLM_PROVIDERS} onSelect={handleProviderSelect} />
            </Box>
          )}

          {step === 'llm-key' && (
            <Box marginLeft={2} flexDirection="column">
              <Text dimColor>Enter your {llmProvider} API key:</Text>
              <Box>
                <Text color="cyan">Key: </Text>
                <TextInput
                  value={llmKey}
                  onChange={setLlmKey}
                  onSubmit={handleKeySubmit}
                  mask="*"
                />
              </Box>
            </Box>
          )}

          {step === 'llm-model' && (
            <Box marginLeft={2} flexDirection="column">
              <Text dimColor>Model (press Enter for default: {llmModel}):</Text>
              <Box>
                <Text color="cyan">Model: </Text>
                <TextInput value={llmModel} onChange={setLlmModel} onSubmit={handleModelSubmit} />
              </Box>
            </Box>
          )}
        </Box>

        {/* Step 3: GitHub */}
        <Box flexDirection="column">
          <Box>
            <Text
              color={
                githubToken
                  ? 'green'
                  : step === 'github' || step === 'github-token'
                    ? 'yellow'
                    : 'gray'
              }
            >
              {githubToken ? '✓' : step === 'github' || step === 'github-token' ? '▸' : '○'}{' '}
            </Text>
            <Text bold={step === 'github' || step === 'github-token'}>GitHub (optional)</Text>
            {githubToken && <Text dimColor> — Connected</Text>}
          </Box>

          {step === 'github' && (
            <Box marginLeft={2} flexDirection="column">
              <Text dimColor>Connect GitHub to browse and deploy private repos?</Text>
              <SelectInput
                items={[
                  { label: 'Yes, add token', value: 'yes' },
                  { label: 'Skip for now', value: 'skip' },
                ]}
                onSelect={(item: { value: string }) => {
                  if (item.value === 'yes') handleGithubSetup();
                  else handleGithubSkip();
                }}
              />
            </Box>
          )}

          {step === 'github-token' && (
            <Box marginLeft={2} flexDirection="column">
              <Text dimColor>
                Enter your GitHub Personal Access Token (github.com/settings/tokens):
              </Text>
              {error && <Text color="red">✗ {error}</Text>}
              {validating ? (
                <Box>
                  <Text color="yellow">
                    <Spinner type="dots" />
                  </Text>
                  <Text dimColor> Validating...</Text>
                </Box>
              ) : (
                <Box>
                  <Text color="cyan">Token: </Text>
                  <TextInput
                    value={githubToken}
                    onChange={setGithubToken}
                    onSubmit={handleGithubTokenSubmit}
                    mask="*"
                  />
                </Box>
              )}
            </Box>
          )}
        </Box>

        {/* Done */}
        {step === 'done' && (
          <Box marginTop={1}>
            <Text color="green" bold>
              ✓ Setup complete! Starting dashboard...
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
