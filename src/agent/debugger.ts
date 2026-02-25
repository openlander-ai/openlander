import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LLMClient, ChatMessage } from '../llm/index.js';
import { matchRecipe } from './recipes.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('debugger');

export interface BuildDiagnosis {
  /** One-line summary of the error */
  summary: string;
  /** Root cause analysis */
  rootCause: string;
  /** Suggested fixes, ordered by likelihood */
  suggestedFixes: Array<{
    description: string;
    /** If applicable, the file and line to change */
    location?: string;
    /** Confidence: high, medium, low */
    confidence: 'high' | 'medium' | 'low';
  }>;
  /** Raw LLM response for display */
  rawAnalysis: string;
}

const MAX_BUILD_LOG_CHARS = 3000;

const systemPrompt = `You are a Docker build error analyst. You receive Docker build logs and diagnose failures.

RULES:
1. Focus on the ACTUAL error, not warnings
2. Consider common causes: missing dependencies, wrong base image, permission issues, network errors
3. Be specific about the fix — mention exact package names, Dockerfile lines, etc.
4. If the error is in the user's application code (not Docker), say so

RESPONSE FORMAT (you MUST respond in this exact JSON format):
{
  "summary": "one-line error summary",
  "rootCause": "detailed explanation of why this failed",
  "suggestedFixes": [
    { "description": "what to do", "location": "Dockerfile:line_number or file_path", "confidence": "high|medium|low" }
  ]
}`;

const VALID_CONFIDENCE = new Set(['high', 'medium', 'low']);

function truncateBuildLog(buildLog: string): string {
  if (buildLog.length <= MAX_BUILD_LOG_CHARS) {
    return buildLog;
  }

  return buildLog.slice(-MAX_BUILD_LOG_CHARS);
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function parseDiagnosis(content: string): BuildDiagnosis {
  const parsed: unknown = JSON.parse(extractJsonObject(content));
  const root = typeof parsed === 'object' && parsed !== null
    ? (parsed as Record<string, unknown>)
    : null;

  if (!root) {
    throw new Error('LLM response is not a JSON object');
  }

  const summary = typeof root['summary'] === 'string' ? root['summary'] : 'Build failed';
  const rootCause = typeof root['rootCause'] === 'string' ? root['rootCause'] : 'No root cause provided';

  const rawFixes = Array.isArray(root['suggestedFixes']) ? (root['suggestedFixes'] as unknown[]) : [];
  const suggestedFixes: BuildDiagnosis['suggestedFixes'] = [];

  for (const item of rawFixes) {
    if (typeof item !== 'object' || item === null) {
      continue;
    }

    const fix = item as Record<string, unknown>;
    const description = typeof fix['description'] === 'string' ? fix['description'] : '';
    if (!description) {
      continue;
    }

    const location = typeof fix['location'] === 'string' ? fix['location'] : undefined;
    const confidenceValue = typeof fix['confidence'] === 'string' ? fix['confidence'] : 'medium';
    const confidence = VALID_CONFIDENCE.has(confidenceValue)
      ? (confidenceValue as 'high' | 'medium' | 'low')
      : 'medium';

    suggestedFixes.push({
      description,
      location,
      confidence,
    });
  }

  return {
    summary,
    rootCause,
    suggestedFixes,
    rawAnalysis: content,
  };
}

export function readDockerfile(repoPath: string): string | null {
  const dockerfilePath = join(repoPath, 'Dockerfile');
  if (!existsSync(dockerfilePath)) {
    return null;
  }

  return readFileSync(dockerfilePath, 'utf8');
}

export class BuildDebugger {
  constructor(private readonly llm: LLMClient) {}

  /**
   * Analyze a build failure and return diagnosis.
   *
   * This uses the LLM to analyze build logs, Dockerfile content,
   * and any available context to diagnose the failure and suggest fixes.
   */
  async diagnose(context: {
    /** The build error log (last 3000 chars) */
    buildLog: string;
    /** Dockerfile content if available */
    dockerfile?: string;
    /** Project name for context */
    projectName: string;
    /** Image tag that failed to build */
    imageTag: string;
    /** Which step failed: clone, dockerfile, build, run */
    failedStep: string;
  }): Promise<BuildDiagnosis> {
    const buildLog = truncateBuildLog(context.buildLog);

    // Fast path: check known error patterns before making an LLM call.
    const recipe = matchRecipe(context.buildLog);
    if (recipe) {
      return {
        summary: recipe.title,
        rootCause: recipe.diagnosis,
        suggestedFixes: [{ description: recipe.fix, confidence: 'high' }],
        rawAnalysis: `[Matched recipe: ${recipe.title}]`,
      };
    }

    const dockerfile = context.dockerfile ?? 'Not available';
    const userPrompt = `Project: ${context.projectName}
Image: ${context.imageTag}
Failed Step: ${context.failedStep}

--- Dockerfile ---
${dockerfile}

--- Build Log (last 3000 chars) ---
${buildLog}

Diagnose this build failure. Respond ONLY with the JSON format specified.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await this.llm.chat(messages);

    try {
      return parseDiagnosis(response.content);
    } catch (err) {
      log.debug({ err }, 'Failed to parse LLM diagnosis response');
      return {
        summary: 'Build failed (could not parse LLM response)',
        rootCause: response.content,
        suggestedFixes: [],
        rawAnalysis: response.content,
      };
    }
  }
}
