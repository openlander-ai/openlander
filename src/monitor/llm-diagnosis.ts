import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { Database } from '../db/index.js';
import { createModuleLogger } from '../lib/logger.js';
import { logAiUsage, extractUsageFromResult } from '../llm/transparency.js';

const log = createModuleLogger('llm-diagnosis');

const DIAGNOSIS_SYSTEM_PROMPT = `You are a runtime crash diagnosis assistant for Dockerized applications.

Given crash context from OpenLander (category, restart count, stderr snippet), produce:
1) the most likely root cause,
2) concise evidence from the snippet,
3) 2-4 practical next checks/fixes.

Keep the output plain text, concise, and actionable.`;

export async function diagnoseRuntimeCrash(params: {
  db: Database;
  incidentId: string;
  errorSnippet: string;
  category: string;
  restartCount: number;
  projectName?: string;
  aiProvider?: LanguageModel | null;
}): Promise<string | null> {
  try {
    const existing = params.db.getRuntimeIncident(params.incidentId);
    if (!existing) {
      return null;
    }

    if (typeof existing.diagnosis === 'string' && existing.diagnosis.trim().length > 0) {
      return null;
    }

    if (!params.aiProvider) {
      log.info(
        {
          incidentId: params.incidentId,
          category: params.category,
        },
        'Skipping runtime diagnosis — no AI provider configured',
      );
      return null;
    }

    const snippet = params.errorSnippet.trim();
    const prompt = `A container has crashed ${String(params.restartCount)} times.
Project: ${params.projectName || 'unknown'}
Category: ${params.category}
Error: ${snippet.length > 0 ? snippet : '(no stderr snippet available)'}

What's the likely cause and recommended fix?`;

    const diagnosisStartTime = Date.now();
    const response = await generateText({
      model: params.aiProvider,
      messages: [
        { role: 'system', content: DIAGNOSIS_SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    });

    const diagnosis = response.text.trim();
    const durationMs = Date.now() - diagnosisStartTime;
    const usage = extractUsageFromResult(response.usage);

    logAiUsage(params.db, {
      projectId: existing.project_id,
      actionType: 'monitor_alert',
      modelName: '',
      provider: 'unknown',
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
      toolsCalled: [],
      result: diagnosis.length > 0 ? 'success' : 'failure',
      durationMs,
      source: 'monitor',
    });

    if (diagnosis.length === 0) {
      return null;
    }

    const latestIncident = params.db.getRuntimeIncident(params.incidentId);
    if (!latestIncident) {
      return null;
    }
    if (
      typeof latestIncident.diagnosis === 'string' &&
      latestIncident.diagnosis.trim().length > 0
    ) {
      return null;
    }

    params.db.updateRuntimeIncidentDiagnosis(params.incidentId, diagnosis);
    return diagnosis;
  } catch (error) {
    log.warn(
      {
        projectName: params.projectName,
        incidentId: params.incidentId,
        category: params.category,
        restartCount: params.restartCount,
        error,
      },
      'LLM runtime diagnosis failed',
    );
    return null;
  }
}
