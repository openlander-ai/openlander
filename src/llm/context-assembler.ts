/**
 * Context snapshot builder for the OpenLander agent.
 *
 * Assembles dynamic application state (projects, server resources, deployment history)
 * into a prompt section that the LLM sees at the start of each conversation turn.
 *
 * This module is pure — no side effects, only queries and formatting.
 */

import { getSystemStats } from '../monitor/stats.js';
import type { ProjectRow, DeployLogRow, RuntimeIncidentRow, Database } from '../db/index.js';
import type { Docker } from '../pipeline/docker.js';
import { scanUsedPorts } from '../pipeline/port.js';
import { detectReverseProxy } from '../pipeline/traefik.js';
import { getPolicy } from '../config/index.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('context-assembler');

/**
 * Build a context snapshot from live application state.
 * Lightweight — only queries DB + OS stats. No LLM calls.
 *
 * @param db - Database instance for project data
 * @param docker - Optional Docker instance for server context (containers, ports, proxy)
 */
export async function buildContextSnapshot(db: Database, docker?: Docker): Promise<string> {
  const projects = db.listProjects();
  const stats = getSystemStats();

  // Scale project listing based on count to prevent context distraction.
  // 0: show "no projects" message
  // 1-5: show full details per project
  // 6+: show summary counts + only running/error projects
  const MAX_DETAILED_PROJECTS = 5;
  let projectLines: string;

  if (projects.length === 0) {
    projectLines = '(no projects deployed yet)';
  } else if (projects.length <= MAX_DETAILED_PROJECTS) {
    projectLines = projects.map((p: ProjectRow) => formatProjectLine(p)).join('\n');
  } else {
    const running = projects.filter((p) => p.status === 'running');
    const errored = projects.filter((p) => p.status === 'error');
    const stopped = projects.filter((p) => p.status === 'stopped');
    const important = [...running, ...errored];
    projectLines = [
      `${String(running.length)} running, ${String(errored.length)} error, ${String(stopped.length)} stopped — use list_projects for full details`,
      ...important.map((p: ProjectRow) => formatProjectLine(p)),
    ].join('\n');
  }

  // Build server context if Docker is available
  const serverContext = await buildServerContext(db, docker);

  // Build deployment rules from server context
  const deploymentRules = buildDeploymentRules(serverContext);

  const parts: string[] = [
    `## Current Server State (auto-injected)
Projects deployed: ${String(projects.length)}
${projectLines}`,
    `Resources: CPU ${String(stats.cpu.usagePercent)}% · Memory ${String(stats.memory.usedMB)}/${String(stats.memory.totalMB)}MB (${String(stats.memory.usagePercent)}%) · Disk ${String(stats.disk.usagePercent)}%${stats.memory.usagePercent > 85 ? '\n⚠️ Memory usage is high — suggest cleaning up unused projects.' : ''}${stats.disk.usagePercent > 90 ? '\n⚠️ Disk usage is critical.' : ''}`,
  ];

  // Add server context if available
  if (serverContext) {
    parts.push(formatServerContext(serverContext));
  }

  // Add deployment rules if we have conflict info
  if (deploymentRules) {
    parts.push(deploymentRules);
  }

  // v0.0.11: Add deployment history for smart defaults context
  const deployHistory = buildDeploymentHistory(db, projects);
  if (deployHistory) {
    parts.push(deployHistory);
  }

  // v0.0.10: Add global secrets summary
  const globalSecrets = db.getGlobalSecrets();
  if (globalSecrets.length > 0) {
    const secretKeys = globalSecrets.map((s) => s.key).join(', ');
    parts.push(
      `Global secrets (${String(globalSecrets.length)}): ${secretKeys}\nThese are automatically injected into all deploys. Project env vars override them.`,
    );
  }

  return parts.join('\n\n');
}

/**
 * Build incident briefing from runtime incidents.
 * Shows active crashes and errors per project.
 */
export function buildIncidentBriefing(incidents: RuntimeIncidentRow[], db: Database): string {
  if (incidents.length === 0) return '';

  const incidentsByProject = new Map<string, RuntimeIncidentRow[]>();
  for (const incident of incidents) {
    const projectIncidents = incidentsByProject.get(incident.project_id);
    if (projectIncidents) {
      projectIncidents.push(incident);
      continue;
    }
    incidentsByProject.set(incident.project_id, [incident]);
  }

  const lines: string[] = ['⚠️ Active incidents:'];

  for (const [projectId, projectIncidents] of incidentsByProject) {
    if (projectIncidents.length === 0) continue;

    const project = db.getProject(projectId);
    const projectName = project ? project.name : projectId;

    const categories = Array.from(new Set(projectIncidents.map((incident) => incident.category)));
    const categorySummary = categories.join(', ');
    const restartCountSum = projectIncidents.reduce(
      (sum, incident) => sum + (incident.restart_count ?? 0),
      0,
    );
    const crashCount = restartCountSum > 0 ? restartCountSum : projectIncidents.length;
    const latestIncident = projectIncidents[0];
    if (!latestIncident) continue;
    const errorSnippet = formatIncidentErrorSnippet(latestIncident.error_snippet);

    lines.push(
      `- ${projectName}: ${categorySummary} (${String(crashCount)}x crashes). Last error: ${errorSnippet}`,
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatProjectLine(p: ProjectRow): string {
  const statusIcon =
    p.status === 'running'
      ? '🟢'
      : p.status === 'error'
        ? '🔴'
        : p.status === 'building'
          ? '🔄'
          : '⚪';

  const url = p.public_url
    ? `🌐 ${p.public_url}`
    : p.assigned_port
      ? `🔒 port ${String(p.assigned_port)}`
      : '';

  return `  ${statusIcon} ${p.name} (${p.status})${url ? ` — ${url}` : ''}`;
}

/**
 * Build deployment history section for the system prompt.
 * Shows last 2 deploy logs per project (max 5 projects) so the LLM
 * can naturally suggest smart defaults during conversation.
 */
function buildDeploymentHistory(db: Database, allProjects: ProjectRow[]): string | null {
  const projectsWithHistory = allProjects.slice(0, 5);
  if (projectsWithHistory.length === 0) return null;

  const sections: string[] = [];

  for (const project of projectsWithHistory) {
    const logs = db.getDeployLogs(project.id, 2);
    if (logs.length === 0) continue;

    const envVars = db.getEnvVars(project.id);
    const envKeys = Object.keys(envVars);

    const logLines = logs.map((l: DeployLogRow) => {
      const duration = l.duration_ms != null ? `${String(Math.round(l.duration_ms / 1000))}s` : '?';
      const time = l.created_at;
      return `    ${l.status === 'success' ? '✅' : '❌'} ${time} (${duration})${l.status === 'failed' && l.build_log ? ' — ' + extractFailureHint(l.build_log) : ''}`;
    });

    const portInfo =
      project.assigned_port != null ? `port ${String(project.assigned_port)}` : 'no port';
    const envInfo = envKeys.length > 0 ? `env: ${envKeys.join(', ')}` : 'no env vars';

    sections.push(`  ${project.name}: ${portInfo}, ${envInfo}\n${logLines.join('\n')}`);
  }

  if (sections.length === 0) return null;

  return `## Deployment History (for smart defaults)\n${sections.join('\n')}`;
}

function extractFailureHint(buildLog: string): string {
  const lastErrorLine = buildLog
    .split('\n')
    .filter((line) => line.includes('[error]'))
    .pop();
  if (lastErrorLine) {
    return lastErrorLine.replace('[error] ', '').slice(0, 80);
  }
  return 'see logs';
}

function formatIncidentErrorSnippet(errorSnippet: string | null): string {
  if (errorSnippet === null || errorSnippet.trim().length === 0) {
    return 'n/a';
  }

  const normalized = errorSnippet.replace(/\s+/g, ' ').trim();
  const MAX_SNIPPET_LENGTH = 120;
  return normalized.length > MAX_SNIPPET_LENGTH
    ? `${normalized.slice(0, MAX_SNIPPET_LENGTH - 3)}...`
    : normalized;
}

// ---------------------------------------------------------------------------
// Server Context Helpers (v0.0.9)
// ---------------------------------------------------------------------------

/** Maximum number of external containers to list before summarizing. */
const MAX_LISTED_EXTERNAL_CONTAINERS = 20;

interface ServerContext {
  /** Total containers on server (managed + external). */
  totalContainers: number;
  /** OpenLander-managed container count. */
  managedCount: number;
  /** External container summaries. */
  externalContainers: ExternalContainerSummary[];
  /** All ports in use across all sources. */
  usedPorts: number[];
  /** Detected reverse proxy info. */
  proxy: ProxyInfo | null;
  /** Container names that could conflict with new deployments. */
  usedNames: string[];
}

interface ExternalContainerSummary {
  name: string;
  image: string;
  ports: number[];
}

interface ProxyInfo {
  type: string;
  version?: string;
  container?: string;
  mode?: string;
}

/**
 * Build server context by querying Docker for containers, ports, and proxy.
 * Returns null if Docker is not available or query fails.
 */
async function buildServerContext(db: Database, docker?: Docker): Promise<ServerContext | null> {
  if (!docker) return null;

  try {
    // Run scans in parallel for efficiency
    const [containers, portScan, proxyDetection] = await Promise.all([
      docker.listAllContainers(),
      scanUsedPorts(db, docker),
      detectReverseProxy(docker),
    ]);

    const managedContainers = containers.filter((c) => c.managedByOpenLander);
    const externalContainers = containers.filter(
      (c) => !c.managedByOpenLander && (c.state === 'running' || c.state === 'restarting'),
    );

    // Collect all used names (lowercase for case-insensitive comparison)
    const usedNames = containers.map((c) => c.name.toLowerCase());

    // Build context object
    const ctx: ServerContext = {
      totalContainers: containers.length,
      managedCount: managedContainers.length,
      externalContainers: summarizeExternalContainers(externalContainers),
      usedPorts: portScan.all,
      proxy:
        proxyDetection.type !== 'none'
          ? {
              type: proxyDetection.type,
              version: proxyDetection.version,
              container: proxyDetection.container,
              mode: proxyDetection.type === 'traefik' ? 'external' : undefined,
            }
          : null,
      usedNames,
    };

    return ctx;
  } catch (error) {
    // Log warning but don't fail the entire snapshot
    log.warn({ error }, 'Failed to build server context, continuing without it');
    return null;
  }
}

/**
 * Summarize external containers, limiting to MAX_LISTED_EXTERNAL_CONTAINERS.
 * When exceeding the limit, show counts by image type.
 */
function summarizeExternalContainers(
  containers: Array<{ name: string; image: string; ports: Array<{ PublicPort?: number }> }>,
): ExternalContainerSummary[] {
  if (containers.length <= MAX_LISTED_EXTERNAL_CONTAINERS) {
    return containers.map((c) => ({
      name: c.name,
      image: c.image,
      ports: c.ports
        .filter((p): p is typeof p & { PublicPort: number } => p.PublicPort !== undefined)
        .map((p) => p.PublicPort),
    }));
  }

  // Summarize by image type when over limit
  const imageCounts = new Map<string, number>();
  for (const c of containers) {
    // Extract base image name (e.g., "nginx" from "nginx:1.25-alpine")
    const baseImage = c.image.split(':')[0] ?? c.image;
    imageCounts.set(baseImage, (imageCounts.get(baseImage) ?? 0) + 1);
  }

  // Format as "nginx: 3, node: 5" etc.
  const summaryParts = Array.from(imageCounts.entries())
    .sort((a, b) => b[1] - a[1]) // Sort by count descending
    .slice(0, 10) // Limit to top 10 types
    .map(([name, count]) => `${name}: ${String(count)}`);

  // Return a synthetic container with the summary
  return [
    {
      name: `(${summaryParts.join(', ')} — total ${String(containers.length)})`,
      image: 'summary',
      ports: [],
    },
  ];
}

/** Format server context as a prompt section. */
function formatServerContext(ctx: ServerContext): string {
  const lines: string[] = ['## Server Context'];

  // Container summary
  lines.push(
    `- Total containers: ${String(ctx.totalContainers)} (${String(ctx.managedCount)} managed by OpenLander, ${String(ctx.totalContainers - ctx.managedCount)} external)`,
  );

  // External containers list
  if (ctx.externalContainers.length > 0) {
    lines.push('- External containers:');
    for (const c of ctx.externalContainers) {
      const portsStr = c.ports.length > 0 ? ` :${c.ports.join(', :')}` : '';
      lines.push(`  - ${c.name}${portsStr}`);
    }
  }

  // Ports summary
  lines.push(`- Ports in use: ${String(ctx.usedPorts.length)} ports`);
  if (ctx.usedPorts.length > 0 && ctx.usedPorts.length <= 15) {
    lines.push(`  (${ctx.usedPorts.sort((a, b) => a - b).join(', ')})`);
  }

  // Reverse proxy
  if (ctx.proxy) {
    const versionStr = ctx.proxy.version ? ` v${ctx.proxy.version}` : '';
    const modeStr = ctx.proxy.mode ? ` (${ctx.proxy.mode} mode)` : '';
    lines.push(`- Reverse proxy: ${ctx.proxy.type}${versionStr}${modeStr}`);
  }

  return lines.join('\n');
}

/** Build deployment rules section from server context. */
function buildDeploymentRules(ctx: ServerContext | null): string | null {
  if (!ctx) return null;

  const rules: string[] = ['## Deployment Rules'];
  let hasRules = false;

  // Forbidden ports (common conflict points)
  const { portRangeStart, portRangeEnd } = getPolicy('production');
  const forbiddenPorts = ctx.usedPorts
    .filter((p) => p < portRangeStart || p > portRangeEnd)
    .slice(0, 20);

  if (forbiddenPorts.length > 0) {
    rules.push(`- Do NOT use ports: ${forbiddenPorts.sort((a, b) => a - b).join(', ')}`);
    hasRules = true;
  }

  rules.push(`- Use allocated ports from range ${String(portRangeStart)}-${String(portRangeEnd)}`);

  // Container name conflicts
  const conflictNames = ctx.usedNames
    .filter((n) => !n.startsWith('ol-') && !n.startsWith('openlander-'))
    .slice(0, 20);

  if (conflictNames.length > 0) {
    rules.push(
      `- Container names must not conflict with: ${conflictNames.slice(0, 10).join(', ')}${conflictNames.length > 10 ? ', ...' : ''}`,
    );
    hasRules = true;
  }

  return hasRules ? rules.join('\n') : null;
}
