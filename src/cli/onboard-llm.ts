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

  // Step 2: Enter API key (skip for Ollama)
  if (provider !== 'ollama') {
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

  // Step 3: Select model (with default)
  const defaultModel = MODEL_DEFAULTS[provider];
  const model = await input({
    message: 'Model (press Enter for default)',
    default: defaultModel,
  });

  // Step 4: Save to config
  updateConfig({
    llm: {
      provider,
      apiKey: provider === 'ollama' ? '' : apiKey.trim(),
      model: model.trim() || defaultModel,
    },
  });

  console.log();
  console.log(pc.green(`  ✓ Saved ${provider} with model ${model.trim() || defaultModel}`));
}
