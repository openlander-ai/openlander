/**
 * Smart Defaults Generator (v0.0.11 — 11-3).
 *
 * When redeploying a project (same repo URL), generates smart suggestions:
 *   1. Reuse previous port
 *   2. Reuse previous environment variables
 *   3. Skip clone if repo already exists (suggest git pull)
 *   4. Suggest fixes for previous build failures
 *
 * These suggestions are presented to the user via QuestionBridge/InputRequestCard
 * before the deploy proceeds. The user can accept, modify, or skip each suggestion.
 *
 * Architecture:
 *   create_deploy_plan tool → generateSmartDefaults() → QuestionBridge.ask()
 *   → user responds → apply accepted defaults → execute_deploy_plan
 */

import type { Database, ProjectRow, DeployLogRow } from '../db/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('smart-defaults');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SmartDefault {
  /** Display label for the suggestion (1-5 words). */
  label: string;
  /** Longer explanation of the suggestion. */
  description: string;
  /** Which category this default belongs to. */
  category: 'port' | 'env' | 'clone' | 'build-fix';
  /** Machine-readable data for applying this default. */
  data: Record<string, unknown>;
}

export interface SmartDefaultsResult {
  /** True if there are any suggestions to show. */
  hasSuggestions: boolean;
  /** The suggestions to present to the user. */
  suggestions: SmartDefault[];
  /** Previous project match (if any). */
  previousProject?: ProjectRow;
}

interface SmartDefaultsInput {
  repoUrl: string;
  branch?: string;
  name?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of deploy logs to scan for failure patterns. */
const MAX_LOGS_TO_SCAN = 5;

/** Known build failure patterns and their suggested fixes. */
const BUILD_FAILURE_PATTERNS: Array<{
  pattern: RegExp;
  label: string;
  description: string;
  fix: Record<string, unknown>;
}> = [
  {
    pattern: /memory|oom|killed|cannot allocate/i,
    label: 'Add --memory 4g',
    description: 'Previous build failed due to OOM. Recommend adding memory limit.',
    fix: { memoryLimit: '4g' },
  },
  {
    pattern: /ENOSPC|no space left/i,
    label: 'Clean disk and retry',
    description: 'Previous build failed due to low disk. Clean up and retry.',
    fix: { cleanDisk: true },
  },
  {
    pattern: /timeout|timed out/i,
    label: 'Extend build timeout',
    description: 'Previous build timed out. Recommend extending timeout.',
    fix: { extendTimeout: true },
  },
  {
    pattern: /npm ERR!.*ERESOLVE|dependency conflict/i,
    label: 'Use --legacy-peer-deps',
    description: 'Previous build had dependency conflicts. Recommend legacy-peer-deps.',
    fix: { legacyPeerDeps: true },
  },
  {
    pattern: /no cache|cache.*corrupt/i,
    label: 'Build without cache',
    description: 'Previous build had cache issues. Recommend no-cache build.',
    fix: { noCache: true },
  },
];

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Generate smart default suggestions for a deploy request.
 *
 * Looks up previous deployments of the same repo to suggest:
 * - Same port
 * - Same env vars
 * - Git pull instead of fresh clone (if project already exists)
 * - Build failure workarounds
 *
 * @param db - Database instance
 * @param input - The deploy request (repoUrl, branch, name)
 * @returns SmartDefaultsResult with suggestions
 */
export function generateSmartDefaults(
  db: Database,
  input: SmartDefaultsInput,
): SmartDefaultsResult {
  const suggestions: SmartDefault[] = [];

  // Find a previous project with the same repo URL or name
  const previousProject = findPreviousProject(db, input);
  if (!previousProject) {
    return { hasSuggestions: false, suggestions };
  }

  log.info(
    { projectName: previousProject.name, projectId: previousProject.id },
    'Found previous project for smart defaults',
  );

  // 1. Port reuse suggestion
  const portSuggestion = suggestPort(db, previousProject);
  if (portSuggestion) {
    suggestions.push(portSuggestion);
  }

  // 2. Environment variables reuse
  const envSuggestion = suggestEnvVars(db, previousProject);
  if (envSuggestion) {
    suggestions.push(envSuggestion);
  }

  // 3. Git clone reuse (project still exists → git pull instead)
  const cloneSuggestion = suggestCloneReuse(db, previousProject);
  if (cloneSuggestion) {
    suggestions.push(cloneSuggestion);
  }

  // 4. Build failure workarounds
  const buildFixSuggestion = suggestBuildFix(db, previousProject);
  if (buildFixSuggestion) {
    suggestions.push(buildFixSuggestion);
  }

  return {
    hasSuggestions: suggestions.length > 0,
    suggestions,
    previousProject,
  };
}

// ---------------------------------------------------------------------------
// Individual suggestion generators
// ---------------------------------------------------------------------------

/**
 * Find a previous project matching the deploy request.
 * Matches by name first (exact), then by repo URL prefix.
 */
function findPreviousProject(db: Database, input: SmartDefaultsInput): ProjectRow | undefined {
  // Match by name if provided
  if (input.name) {
    const byName = db.getProjectByName(input.name);
    if (byName) return byName;
  }

  // Match by repo URL across all projects
  const allProjects = db.listProjects();
  const normalizedUrl = normalizeUrl(input.repoUrl);

  return allProjects.find((p) => {
    if (!p.repo_url) return false;
    return normalizeUrl(p.repo_url) === normalizedUrl;
  });
}

/** Normalize a repo URL for comparison (strip protocol, .git suffix, trailing slash). */
function normalizeUrl(url: string): string {
  return url
    .replace(/^(https?:\/\/|git@)/, '')
    .replace(/\.git$/, '')
    .replace(/:/, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
}

/** Suggest reusing the previous port assignment. */
function suggestPort(db: Database, project: ProjectRow): SmartDefault | null {
  // PR 4.5: canonical-first read of assigned_port with `??` fallback.
  const deployable = db.getDeployableForProject(project.id);
  const assignedPort = deployable?.assigned_port ?? project.assigned_port;
  if (assignedPort == null) return null;

  return {
    label: `Keep port ${String(assignedPort)}`,
    description: `Reuse the same port as previous deployment`,
    category: 'port',
    data: { port: assignedPort },
  };
}

/** Suggest reusing previous environment variables. */
function suggestEnvVars(db: Database, project: ProjectRow): SmartDefault | null {
  const envVars = db.getEnvVars(project.id);
  const keys = Object.keys(envVars);

  if (keys.length === 0) return null;

  // Mask values for display (show first 3 chars + ***)
  const maskedKeys = keys.map((k) => {
    const val = envVars[k] ?? '';
    const masked = val.length > 3 ? `${val.slice(0, 3)}***` : '***';
    return `${k}=${masked}`;
  });

  return {
    label: `Keep env vars (${String(keys.length)})`,
    description: maskedKeys.join(', '),
    category: 'env',
    data: { envVars },
  };
}

/**
 * Suggest git pull instead of fresh clone if the project already exists.
 * Only applicable when the project is in a non-error state and has a container.
 */
function suggestCloneReuse(db: Database, project: ProjectRow): SmartDefault | null {
  // PR 4.5: canonical-first reads with `??` fallback.
  const deployable = db.getDeployableForProject(project.id);
  const status = deployable?.status ?? project.status;
  const containerId = deployable?.container_id ?? project.container_id;

  // Only suggest reuse if the project exists and has been deployed before
  if (status === 'error') return null;
  if (!containerId && status !== 'stopped') return null;

  return {
    label: 'Run git pull only',
    description: `This repo is already cloned. Pull latest changes only.`,
    category: 'clone',
    data: { reuseProject: true, projectId: project.id },
  };
}

/** Suggest build fixes based on previous failure logs. */
function suggestBuildFix(db: Database, project: ProjectRow): SmartDefault | null {
  const logs = db.getDeployLogs(project.id, MAX_LOGS_TO_SCAN);

  // Find the most recent failed deploy
  const failedLog = logs.find((l: DeployLogRow) => l.status === 'failed');
  if (!failedLog || !failedLog.build_log) return null;

  const buildLog = failedLog.build_log;

  // Match against known failure patterns
  for (const pattern of BUILD_FAILURE_PATTERNS) {
    if (pattern.pattern.test(buildLog)) {
      return {
        label: pattern.label,
        description: pattern.description,
        category: 'build-fix',
        data: pattern.fix,
      };
    }
  }

  return null;
}
