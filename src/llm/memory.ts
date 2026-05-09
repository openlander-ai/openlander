import type { Database } from '../db/index.js';
import type { DeploymentPatternRow } from '../db/schema.drizzle.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('llm-memory');

const MAX_SIGNATURE_LENGTH = 200;

/** Removes timestamps, absolute paths, hex hashes, and line numbers to produce a stable signature. */
export function normalizeErrorSignature(errorLog: string): string {
  return errorLog
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.\dZ]*/g, '')
    .replace(/\/(?:home|usr|var|tmp|app|workspace)\/[^\s]*/g, '')
    .replace(/\b[0-9a-f]{8,}\b/g, '')
    .replace(/:\d+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SIGNATURE_LENGTH);
}

export async function saveRecoveryPattern(
  db: Database,
  projectId: string,
  errorLog: string,
  fixAction: string,
  success: boolean,
  patternType: string,
): Promise<void> {
  const signature = normalizeErrorSignature(errorLog);
  if (!signature) {
    log.warn({ projectId }, 'Empty error signature, skipping pattern save');
    return;
  }

  const id = await db.upsertDeploymentPattern({
    project_id: projectId,
    pattern_type: patternType,
    error_signature: signature,
    fix_action: fixAction,
  });

  if (success) {
    await db.recordDeploymentPatternSuccess(id);
  } else {
    await db.recordDeploymentPatternFailure(id);
  }

  log.debug(
    { projectId, patternType, success, signatureLength: signature.length },
    'Saved recovery pattern',
  );
}

export async function findMatchingPatterns(
  db: Database,
  projectId: string,
  errorLog: string,
): Promise<DeploymentPatternRow[]> {
  const signature = normalizeErrorSignature(errorLog);
  if (!signature) {
    return [];
  }

  const exact = await db.findDeploymentPatternBySignature(projectId, signature);
  if (exact) {
    return [exact];
  }

  return [];
}
