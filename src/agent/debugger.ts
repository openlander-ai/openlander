import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { ChatMessage } from '../llm/index.js';
import { matchRecipe } from './recipes.js';
import { createModuleLogger } from '../lib/logger.js';
import { collectProjectContext } from '../pipeline/auto-detect.js';

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
  buildLog?: string;
}

export interface FixDockerfileInput {
  projectPath: string;
  currentDockerfile: string;
  buildError: string;
  projectName: string;
}

export interface FixDockerfileOutput {
  dockerfileContent: string;
  explanation: string;
  changes: string[];
}

const MAX_BUILD_LOG_CHARS = 3000;

const systemPrompt = `You are a Docker build error analyst. You receive Docker build logs and diagnose failures.

RULES:
1. Focus on the ACTUAL error, not warnings
2. Consider common causes: missing dependencies, wrong base image, permission issues, network errors
3. Be specific about the fix — mention exact package names and reference Dockerfile line numbers from the numbered listing provided.
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

function numberLines(text: string): string {
  return text
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(3)}: ${line}`)
    .join('\n');
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
  const root =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;

  if (!root) {
    throw new Error('LLM response is not a JSON object');
  }

  const summary = typeof root['summary'] === 'string' ? root['summary'] : 'Build failed';
  const rootCause =
    typeof root['rootCause'] === 'string' ? root['rootCause'] : 'No root cause provided';

  const rawFixes = Array.isArray(root['suggestedFixes'])
    ? (root['suggestedFixes'] as unknown[])
    : [];
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
  constructor(private readonly model: LanguageModel) {}

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
    diffContext?: string;
  }): Promise<BuildDiagnosis> {
    const buildLog = truncateBuildLog(context.buildLog);

    // Fast path: check known error patterns before making an LLM call.
    const recipe = matchRecipe(buildLog);
    if (recipe) {
      return {
        summary: recipe.title,
        rootCause: recipe.diagnosis,
        suggestedFixes: [{ description: recipe.fix, confidence: 'high' }],
        rawAnalysis: `[Matched recipe: ${recipe.title}]\n\n--- Build Log Context ---\n${buildLog}`,
        buildLog,
      };
    }

    const dockerfile = context.dockerfile ?? 'Not available';
    const userPrompt = `Project: ${context.projectName}
Image: ${context.imageTag}
Failed Step: ${context.failedStep}
${context.diffContext ? `\n--- Recent Changes ---\n${context.diffContext}\n` : ''}

--- Dockerfile (with line numbers) ---
${numberLines(dockerfile)}

--- Build Log (last 3000 chars) ---
${buildLog}

Diagnose this build failure. Respond ONLY with the JSON format specified.`;

    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ];

    const response = await generateText({
      model: this.model,
      messages: messages.map((m) => ({
        role: m.role,
        content: m.content,
      })),
    });

    try {
      return {
        ...parseDiagnosis(response.text),
        buildLog,
      };
    } catch (err) {
      log.debug({ err }, 'Failed to parse LLM diagnosis response');
      return {
        summary: 'Build failed (could not parse LLM response)',
        rootCause: response.text,
        suggestedFixes: [],
        rawAnalysis: response.text,
        buildLog,
      };
    }
  }

  /**
   * Analyze a build failure and generate a fixed Dockerfile using AI.
   *
   * Collects project context (file tree, package manifests, version files),
   * combines with the current Dockerfile and build error, then asks the LLM
   * to produce a corrected Dockerfile.
   */
  async fixDockerfile(input: FixDockerfileInput): Promise<FixDockerfileOutput> {
    const buildLog = truncateBuildLog(input.buildError);
    const context = collectProjectContext(input.projectPath);

    const fixSystemPrompt = `You are an expert DevOps engineer specializing in Dockerfile debugging.
Given the current Dockerfile, build error, and project context, generate a FIXED Dockerfile.

Rules:
1. Output ONLY the new Dockerfile content, no explanation, no markdown fences.
2. Fix the specific error shown in the build log (e.g., wrong Node.js version, missing dependencies).
3. Keep the same structure (multi-stage build, EXPOSE port, etc.) unless it causes the error.
4. After the Dockerfile, on a new line starting with "CHANGES:", summarize what you changed in 1-3 bullet points.`;

    const userPrompt = `Project name: ${input.projectName}
Project path: ${input.projectPath}

Current Dockerfile:
${input.currentDockerfile}

Build error:
${buildLog}

Project context:
${context}`;

    const response = await generateText({
      model: this.model,
      messages: [
        { role: 'system', content: fixSystemPrompt },
        { role: 'user', content: userPrompt },
      ],
    });

    const { dockerfileContent, changes } = this.parseFixResponse(response.text);

    return {
      dockerfileContent,
      explanation: 'Fixed Dockerfile based on build error and project context.',
      changes,
    };
  }

  private parseFixResponse(raw: string): { dockerfileContent: string; changes: string[] } {
    const lines = raw.split('\n');
    const changesLineIndex = lines.findIndex((line) => line.trim().startsWith('CHANGES:'));

    let dockerfileContent = raw;
    const changes: string[] = [];

    if (changesLineIndex !== -1) {
      dockerfileContent = lines.slice(0, changesLineIndex).join('\n').trim();
      const changesText = lines
        .slice(changesLineIndex + 1)
        .join('\n')
        .trim();
      for (const line of changesText.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('-') || trimmed.startsWith('*')) {
          changes.push(trimmed.replace(/^[-*]\s*/, ''));
        }
      }
    }

    // Strip markdown fences if present
    dockerfileContent = dockerfileContent
      .replace(/^```(?:dockerfile|Dockerfile)?\s*\n?/, '')
      .replace(/\n?```\s*$/, '')
      .trim();

    if (changes.length === 0) {
      changes.push('Dockerfile updated based on build error analysis');
    }

    return { dockerfileContent, changes };
  }
}
