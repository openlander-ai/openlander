import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { BuildDebugger } from '../build-debugger.js';
import type { EventPayload } from '../../events/index.js';
import type {
  BuildContext as RecoveryBuildContext,
  BuildRecoveryResult,
  Tier1FixResult,
} from '../build-recovery.js';

type RecoveryEventName = 'build:inform' | 'build:dockerfile-fixed' | 'build:suggest';

export interface RecoveryEngine {
  classify(buildLog: string, context: RecoveryBuildContext): BuildRecoveryResult;
  attemptTier1Fix(
    result: BuildRecoveryResult,
    context: RecoveryBuildContext,
  ): Promise<Tier1FixResult>;
  extractErrorSummary(buildLog: string, maxLines?: number): string;
}

export interface FailureContext {
  projectId: string;
  projectName: string;
  imageTag: string;
  clonePath: string;
  buildLogWithError: string;
  failedStep: string;
  retryCount: number;
  buildRecovery: RecoveryEngine;
  emit: <T extends RecoveryEventName>(eventName: T, payload: EventPayload[T]) => Promise<void>;
}

export type RecoveryAction =
  | {
      type: 'retry';
      retryCount: number;
      noCacheBuild: boolean;
      logMessage: string;
    }
  | {
      type: 'suggest';
      suggestion: string;
    }
  | {
      type: 'exhausted';
    };

const TIER1_MAX_RETRIES = 2;
const TIER25_MAX_RETRIES = 3;

export class RecoveryOrchestrator {
  constructor(private readonly buildDebugger?: BuildDebugger) {}

  async handleBuildFailure(context: FailureContext): Promise<RecoveryAction> {
    const failedStep: RecoveryBuildContext['failedStep'] =
      context.failedStep === 'clone' ||
      context.failedStep === 'dockerfile' ||
      context.failedStep === 'build' ||
      context.failedStep === 'run' ||
      context.failedStep === 'runtime'
        ? context.failedStep
        : 'build';

    const recoveryContext: RecoveryBuildContext = {
      projectId: context.projectId,
      projectName: context.projectName,
      imageTag: context.imageTag,
      clonePath: context.clonePath,
      buildLog: context.buildLogWithError,
      failedStep,
    };

    const classification = context.buildRecovery.classify(
      context.buildLogWithError,
      recoveryContext,
    );

    if (classification.tier === 1 && classification.autoFixable) {
      if (context.retryCount >= TIER1_MAX_RETRIES) {
        return { type: 'exhausted' };
      }

      const fixResult = await context.buildRecovery.attemptTier1Fix(
        classification,
        recoveryContext,
      );
      if (!fixResult.fixed || !fixResult.retryNeeded) {
        return { type: 'exhausted' };
      }

      return {
        type: 'retry',
        retryCount: context.retryCount + 1,
        noCacheBuild: classification.category === 'cache-corrupt',
        logMessage: `[recovery] Tier 1 auto-fix: ${fixResult.action}`,
      };
    }

    if (classification.tier === 2.5 && classification.autoFixable) {
      if (context.retryCount >= TIER25_MAX_RETRIES) {
        return { type: 'exhausted' };
      }

      if (!this.buildDebugger) {
        await context.emit('build:inform', {
          projectId: context.projectId,
          summary: 'Dockerfile error detected but no LLM configured. Fix Dockerfile manually.',
          tier: 3,
        });
        return { type: 'exhausted' };
      }

      if (!context.clonePath) {
        return { type: 'exhausted' };
      }

      const dockerfilePath = join(context.clonePath, 'Dockerfile');
      const currentDockerfile = existsSync(dockerfilePath)
        ? readFileSync(dockerfilePath, 'utf8')
        : 'Not available';

      const fixResult = await this.buildDebugger.fixDockerfile({
        projectPath: context.clonePath,
        currentDockerfile,
        buildError: context.buildLogWithError,
        projectName: context.projectName,
      });

      writeFileSync(dockerfilePath, `${fixResult.dockerfileContent}\n`, 'utf8');

      await context.emit('build:dockerfile-fixed', {
        projectId: context.projectId,
        changes: fixResult.changes,
        explanation: fixResult.explanation,
        retryCount: context.retryCount + 1,
      });

      return {
        type: 'retry',
        retryCount: context.retryCount + 1,
        noCacheBuild: true,
        logMessage: `[recovery] Fixed Dockerfile:\n${fixResult.changes.map((change) => `  - ${change}`).join('\n')}`,
      };
    }

    if (classification.tier === 2 && classification.suggestible && classification.suggestedAction) {
      await context.emit('build:suggest', {
        projectId: context.projectId,
        suggestion: classification.suggestedAction,
      });
      return {
        type: 'suggest',
        suggestion: classification.suggestedAction,
      };
    }

    if (classification.tier === 3) {
      await context.emit('build:inform', {
        projectId: context.projectId,
        summary: context.buildRecovery.extractErrorSummary(context.buildLogWithError),
        tier: 3,
      });
    }

    return { type: 'exhausted' };
  }
}
