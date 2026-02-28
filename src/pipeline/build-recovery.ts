import { createModuleLogger } from '../lib/logger.js';
import type { Docker } from './docker.js';
import type { Database } from '../db/index.js';
import type { EventBus } from '../events/index.js';
import { allocatePort } from './port.js';

const log = createModuleLogger('build-recovery');

export type BuildTier = 1 | 2 | 3;

export interface BuildRecoveryResult {
  tier: BuildTier;
  category: string;
  message: string;
  autoFixable: boolean;
  suggestible: boolean;
  errorSummary: string;
  suggestedAction?: string;
}

export interface Tier1FixResult {
  fixed: boolean;
  action: string;
  retryNeeded: boolean;
}

export interface BuildContext {
  projectId: string;
  projectName: string;
  imageTag: string;
  clonePath: string;
  buildLog: string;
  failedStep: 'clone' | 'dockerfile' | 'build' | 'run';
}

interface CategoryDefinition {
  category: string;
  tier: BuildTier;
  autoFixable: boolean;
  suggestible: boolean;
  message: string;
  suggestedAction?: string;
  patterns: RegExp[];
}

const CATEGORY_DEFINITIONS: CategoryDefinition[] = [
  {
    category: 'port-conflict',
    tier: 1,
    autoFixable: true,
    suggestible: false,
    message: 'Port conflict detected while starting container.',
    patterns: [/bind:\s+address already in use/i, /port is already allocated/i],
  },
  {
    category: 'cache-corrupt',
    tier: 1,
    autoFixable: true,
    suggestible: false,
    message: 'Docker cache issue detected during build.',
    patterns: [/failed to compute cache key/i, /error getting credentials/i, /COPY failed/i],
  },
  {
    category: 'disk-full',
    tier: 1,
    autoFixable: true,
    suggestible: false,
    message: 'Disk exhaustion detected on Docker host.',
    patterns: [/no space left on device/i, /ENOSPC/i],
  },
  {
    category: 'network-error',
    tier: 1,
    autoFixable: true,
    suggestible: false,
    message: 'Transient network failure detected during build.',
    patterns: [
      /Could not resolve host/i,
      /connection timed out/i,
      /TLS handshake timeout/i,
      /fetch failed/i,
    ],
  },
  {
    category: 'base-image',
    tier: 2,
    autoFixable: false,
    suggestible: true,
    message: 'Base image reference appears invalid.',
    suggestedAction: 'Update the base image tag to an existing manifest and redeploy.',
    patterns: [/no matching manifest for/i, /manifest unknown/i],
  },
  {
    category: 'missing-dependency',
    tier: 2,
    autoFixable: false,
    suggestible: true,
    message: 'Application dependency is missing.',
    suggestedAction: 'Install or declare the missing dependency, then rebuild.',
    patterns: [/Module not found/i, /ModuleNotFoundError/i, /ImportError/i],
  },
  {
    category: 'env-missing',
    tier: 2,
    autoFixable: false,
    suggestible: true,
    message: 'Required runtime configuration is missing.',
    suggestedAction: 'Provide required environment variables or config values before deploy.',
    patterns: [/required environment variable/i, /Missing required config/i],
  },
  {
    category: 'compile-error',
    tier: 3,
    autoFixable: false,
    suggestible: false,
    message: 'Compilation failed in application source code.',
    patterns: [/error TS\d+/i, /SyntaxError/i, /error\[E\d+/i],
  },
  {
    category: 'test-failure',
    tier: 3,
    autoFixable: false,
    suggestible: false,
    message: 'Tests failed during build pipeline.',
    patterns: [/\bFAIL\b/i, /tests failed/i, /AssertionError/i],
  },
];

export class BuildRecovery {
  constructor(
    private readonly docker: Docker,
    private readonly db: Database,
    private readonly events: EventBus,
  ) {}

  classify(buildLog: string, _context: BuildContext): BuildRecoveryResult {
    for (const definition of CATEGORY_DEFINITIONS) {
      if (definition.patterns.some((pattern) => pattern.test(buildLog))) {
        const result: BuildRecoveryResult = {
          tier: definition.tier,
          category: definition.category,
          message: definition.message,
          autoFixable: definition.autoFixable,
          suggestible: definition.suggestible,
          errorSummary: this.extractErrorSummary(buildLog),
          suggestedAction: definition.suggestedAction,
        };

        return result;
      }
    }

    return {
      tier: 3,
      category: 'source-error',
      message: 'Unclassified build failure in application source.',
      autoFixable: false,
      suggestible: false,
      errorSummary: this.extractErrorSummary(buildLog),
    };
  }

  async attemptTier1Fix(
    result: BuildRecoveryResult,
    context: BuildContext,
  ): Promise<Tier1FixResult> {
    if (!result.autoFixable || result.tier !== 1) {
      return {
        fixed: false,
        action: 'No automatic fix available for this failure tier.',
        retryNeeded: false,
      };
    }

    try {
      if (result.category === 'port-conflict') {
        const fallbackPort = await allocatePort(this.db, this.docker, 11000, 11999);
        this.db.updateProject(context.projectId, { assignedPort: fallbackPort });

        const action = `Allocated fallback port ${String(fallbackPort)} for retry.`;
        await this.events.emit('build:autofix', {
          projectId: context.projectId,
          action,
          category: result.category,
        });

        return { fixed: true, action, retryNeeded: true };
      }

      if (result.category === 'cache-corrupt') {
        const action = 'Enabled no-cache rebuild mode for next retry.';
        await this.events.emit('build:autofix', {
          projectId: context.projectId,
          action,
          category: result.category,
        });
        return { fixed: true, action, retryNeeded: true };
      }

      if (result.category === 'disk-full') {
        const dockerClient = this.docker.getClient();
        await dockerClient.pruneContainers();
        await dockerClient.pruneImages();

        const action = 'Pruned Docker containers/images to recover disk space.';
        await this.events.emit('build:autofix', {
          projectId: context.projectId,
          action,
          category: result.category,
        });

        return { fixed: true, action, retryNeeded: true };
      }

      if (result.category === 'network-error') {
        await new Promise((resolve) => setTimeout(resolve, 3000));

        const action = 'Waited 3 seconds to recover from transient network failure.';
        await this.events.emit('build:autofix', {
          projectId: context.projectId,
          action,
          category: result.category,
        });

        return { fixed: true, action, retryNeeded: true };
      }
    } catch (error) {
      log.warn(
        {
          err: error,
          projectId: context.projectId,
          category: result.category,
        },
        'Tier 1 auto-fix failed',
      );

      return {
        fixed: false,
        action: `Tier 1 auto-fix failed: ${error instanceof Error ? error.message : String(error)}`,
        retryNeeded: false,
      };
    }

    return {
      fixed: false,
      action: `No Tier 1 fix handler registered for category ${result.category}.`,
      retryNeeded: false,
    };
  }

  extractErrorSummary(buildLog: string, maxLines = 15): string {
    const errorLinePattern =
      /(error|failed|fatal|exception|assertion|ENOENT|ENOSPC|SyntaxError|TypeError)/i;
    const noisePattern =
      /(downloaded|downloading|extracting|transferring|=> CACHED|[=+>\-\s\d]{8,}|\d+\/\d+)/i;

    const summaryLines = buildLog
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => errorLinePattern.test(line))
      .filter((line) => !noisePattern.test(line))
      .slice(-maxLines);

    if (summaryLines.length === 0) {
      return 'No concise error lines found in build output.';
    }

    return summaryLines.join('\n');
  }
}
