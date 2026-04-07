import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../../src/llm/prompts.js';

describe('buildSystemPrompt', () => {
  const mockContext = '## Current Server State\nProjects: 0';

  it('returns a non-empty string', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(typeof prompt).toBe('string');
    expect(prompt.length).toBeGreaterThan(100);
  });

  it('includes the context snapshot', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Current Server State');
  });

  // Existing sections — MUST PASS
  it('contains Deploy Planning Mode section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Deploy Planning Mode');
  });

  it('contains Error Intelligence Protocol section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Error Intelligence Protocol');
  });

  it('contains Auto-Recovery Mode section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Auto-Recovery Mode');
  });

  it('applies gemini model overlay', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('ALWAYS call tools');
  });

  it('applies anthropic model overlay', () => {
    const prompt = buildSystemPrompt(mockContext, 'anthropic', 'en');
    expect(prompt).toContain('Be concise');
  });

  it('applies openai model overlay', () => {
    const prompt = buildSystemPrompt(mockContext, 'openai', 'en');
    expect(prompt).toContain('Only state facts returned by tools');
  });

  it('applies English locale directive', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('CRITICAL: You MUST respond to the user in English');
  });

  it('applies Korean locale directive', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'ko');
    expect(prompt).toContain('CRITICAL: You MUST respond to the user in Korean');
  });

  it('prompt size is under 50000 chars', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt.length).toBeLessThan(50000);
  });

  it('includes Your Role section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Your Role');
  });

  it('includes Conversational Behavior section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Conversational Behavior');
  });

  it('includes Rules section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Rules');
  });

  it('includes Tool Usage Guide section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Tool Usage Guide');
  });

  // NEW sections — MUST FAIL (TDD red)
  it('contains Project Intelligence section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Project Intelligence');
  });

  it('contains Domain Knowledge section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Domain Knowledge');
  });

  it('contains Behavioral Guidelines section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Behavioral Guidelines');
  });

  it('contains Multi-Step Planning section', () => {
    const prompt = buildSystemPrompt(mockContext, 'gemini', 'en');
    expect(prompt).toContain('## Multi-Step Planning');
  });
});
