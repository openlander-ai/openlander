export type BuildTier = 1 | 2 | 2.5 | 3;

export interface BuildRecoveryResult {
  tier: BuildTier;
  category: string;
  message: string;
  autoFixable: boolean;
  suggestible: boolean;
  errorSummary: string;
  suggestedAction?: string;
}

export interface BuildContext {
  projectId: string;
  projectName: string;
  imageTag: string;
  clonePath: string;
  buildLog: string;
  failedStep: 'clone' | 'dockerfile' | 'build' | 'run' | 'runtime';
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
    patterns: [
      /failed to compute cache key/i,
      /error getting credentials/i,
      /COPY failed/i,
      /lease.*does not exist/i,
      /failed.*commit.*on ref.*lease/i,
      /buildkit.*lease/i,
    ],
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
      /network sandbox/i,
      /failed to create endpoint/i,
      /network not found/i,
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
  {
    category: 'runtime-wrong-cmd',
    tier: 1,
    autoFixable: true,
    suggestible: false,
    message: 'Container crashed due to incorrect start command in Dockerfile.',
    patterns: [
      /"next start" does not work with "output: export"/i,
      /next start.*output.*export/i,
      /Cannot find module.*next/i,
    ],
  },
  {
    category: 'runtime-permission',
    tier: 1,
    autoFixable: true,
    suggestible: false,
    message: 'Container crashed due to file permission issue.',
    patterns: [/permission denied.*nginx\.pid/i, /EACCES.*permission denied/i],
  },
  {
    category: 'runtime-crash',
    tier: 2,
    autoFixable: false,
    suggestible: true,
    message: 'Container crashed at runtime after successful build.',
    suggestedAction:
      'Check container logs for the root cause. The application may have a startup error.',
    patterns: [
      /Container crashed after start/i,
      /Container is in restart loop/i,
      /Container exited with code/i,
    ],
  },
  {
    category: 'dockerfile-content',
    tier: 2.5 as BuildTier,
    autoFixable: true,
    suggestible: false,
    message: 'Dockerfile content appears invalid or incompatible with project requirements.',
    patterns: [
      /version.*not supported/i,
      /python version.*not found/i,
      /golang version.*not found/i,
      /unexpected token.*dockerfile/i,
      /failed to solve.*process.*dockerfile/i,
      /error building image.*dockerfile/i,
      /base image.*not found/i,
      /requires.*>=\s*\d+/i,
      /engine.*incompatible/i,
    ],
  },
];

export class BuildRecovery {
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
