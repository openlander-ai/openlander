/**
 * LLM Provider CLI Onboarding
 *
 * Interactive CLI flow for setting up LLM provider during first run.
 * Uses @inquirer/prompts for user interaction.
 */

import { select, input, password } from '@inquirer/prompts';
import pc from 'picocolors';
import { updateConfig } from '../config/index.js';
import type { OpenLanderConfig } from '../config/index.js';

type LlmProvider = OpenLanderConfig['llm']['provider'];

const LLM_PROVIDERS: Array<{ label: string; value: LlmProvider }> = [
  { label: 'OpenRouter (free, no credit card)', value: 'openrouter' },
  { label: 'Gemini (free tier available)', value: 'gemini' },
  { label: 'Anthropic (Claude)', value: 'anthropic' },
  { label: 'OpenAI (GPT)', value: 'openai' },
  { label: 'xAI (Grok)', value: 'xai' },
  { label: 'DeepSeek', value: 'deepseek' },
  { label: 'Mistral AI', value: 'mistral' },
  { label: 'Groq (fast inference)', value: 'groq' },
  { label: 'Together AI (open-source)', value: 'togetherai' },
  { label: 'Ollama (local)', value: 'ollama' },
];

const MODEL_DEFAULTS: Record<LlmProvider, string> = {
  openrouter: 'openrouter/free',
  gemini: 'gemini-2.0-flash',
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o-mini',
  xai: 'grok-3-mini-fast',
  deepseek: 'deepseek-chat',
  mistral: 'mistral-small-latest',
  groq: 'llama-3.3-70b-versatile',
  togetherai: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
  ollama: 'llama3.2',
};

/**
 * Run the LLM provider setup flow.
 * Prompts user to select provider, enter API key (if needed), and select model.
 */
export async function setupLlm(): Promise<void> {
  console.log();
  console.log(pc.dim('  ━━━ [2/3] AI Provider ━━━━━━━━━━━━━━━━━━━━━━━━'));
  console.log();

  // Step 1: Select provider
  const provider = await select({
    message: 'Choose your AI provider',
    choices: LLM_PROVIDERS.map((p) => ({ name: p.label, value: p.value })),
    default: 'openrouter',
  });

  let apiKey = '';
  let usedOAuth = false;

  // Step 2: Authenticate (OAuth or API key)
  if (provider === 'openrouter') {
    const authMethod = await select({
      message: 'How would you like to authenticate?',
      choices: [
        { name: 'Login via browser (OAuth)', value: 'oauth' },
        { name: 'Enter API key manually', value: 'manual' },
      ],
      default: 'oauth',
    });

    if (authMethod === 'oauth') {
      try {
        const { openRouterOAuth } = await import('./openrouter-oauth.js');
        apiKey = await openRouterOAuth();
        usedOAuth = true;
        console.log(pc.green('  ✓ Connected to OpenRouter via OAuth'));
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.log(pc.yellow('  ⚠ OAuth failed. Falling back to manual API key entry.'));
        console.log(pc.dim(`    Reason: ${errorMessage}`));
      }
    }
  }

  // Step 3: Enter API key manually (if OAuth wasn't used or failed)
  if (!usedOAuth && provider !== 'ollama') {
    apiKey = await password({
      message: `Enter your ${provider} API key`,
      mask: '*',
    });

    while (!apiKey.trim()) {
      console.log(pc.red('  API key is required. Please try again.'));
      apiKey = await password({
        message: `Enter your ${provider} API key`,
        mask: '*',
      });
    }
  }

  // Step 4: Select model (with default)
  const defaultModel = MODEL_DEFAULTS[provider];
  const model = await input({
    message: 'Model (press Enter for default)',
    default: defaultModel,
  });

  // Step 5: Save to config
  const resolvedApiKey = apiKey.trim();
  const resolvedAuthToken = usedOAuth ? resolvedApiKey : '';

  updateConfig({
    llm: {
      provider,
      apiKey: provider === 'ollama' || usedOAuth ? '' : resolvedApiKey,
      authToken: resolvedAuthToken,
      model: model.trim() || defaultModel,
    },
  });

  console.log();
  console.log(pc.green(`  ✓ Saved ${provider} with model ${model.trim() || defaultModel}`));
}
