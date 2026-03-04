/**
 * Dynamic system prompt builder for the OpenLander agent.
 *
 * Architecture (inspired by OhMyOpenCode / Vercel AI SDK patterns):
 *   BASE_PROMPT       — Core instructions, model-agnostic (~120 lines)
 *   Context snapshot   — Dynamic state injected per conversation turn
 *   Model overlay      — Thin behavioral corrections per LLM provider (2-10 lines)
 *
 * Design principle: "Common 90% + model overlay 10%"
 * The tool schema + deterministic pipeline handle 80% of behavior.
 * The prompt handles intent parsing, clarification, and error explanation.
 */

import { getSystemStats } from '../monitor/stats.js';
import type { ProjectRow, DeployLogRow, Database } from '../db/index.js';
import type { Docker } from '../pipeline/docker.js';
import { scanUsedPorts } from '../pipeline/port.js';
import { detectReverseProxy } from '../pipeline/traefik.js';
import { createModuleLogger } from '../lib/logger.js';

const log = createModuleLogger('prompts');

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Callback that returns a context snapshot string at call-time. */
export type ContextProvider = () => string | Promise<string>;

/** LLM provider identifier (matches LLMConfig.provider). */
export type LLMProvider = 'gemini' | 'openrouter' | 'anthropic' | 'openai' | 'ollama';

/**
 * Build the complete system prompt with dynamic context + model overlay.
 * Called at the START of each conversation turn so the agent always sees fresh state.
 */
export function buildSystemPrompt(contextSnapshot: string, provider: LLMProvider): string {
  const parts = [BASE_PROMPT];

  if (contextSnapshot) {
    parts.push(contextSnapshot);
  }

  const overlay = MODEL_OVERLAYS[provider];
  if (overlay) {
    parts.push(overlay);
  }

  return parts.join('\n\n');
}

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

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Model-specific overlays (thin — 2-10 lines each)
// ---------------------------------------------------------------------------

const MODEL_OVERLAYS: Partial<Record<LLMProvider, string>> = {
  gemini: `## Model Instructions
- ALWAYS call tools for actions — NEVER simulate or assume tool results.
- Structure responses with bullet points. Use tables when comparing items.
- When uncertain about current state, call list_projects or get_system_stats first.`,

  anthropic: `## Model Instructions
- Be concise. Status updates and results only — skip explanations unless the user asks "why".
- Prefer short, scannable responses over paragraphs.`,

  openai: `## Model Instructions
- Only state facts returned by tools. Never speculate about deployment state.
- When a tool call fails, report the exact error — do not paraphrase or guess the cause.`,

  openrouter: `## Model Instructions
- ALWAYS call tools for actions — never simulate results.
- Keep responses concise and structured.`,

  ollama: `## Model Instructions
- Keep responses very short and direct — this saves tokens.
- ALWAYS use tools for any deployment action. Never answer from memory.
- When unsure, call list_projects first to see current state.`,
};

// ---------------------------------------------------------------------------
// Base system prompt (model-agnostic)
// ---------------------------------------------------------------------------

const BASE_PROMPT = `You are OpenLander, an AI deployment assistant that helps users deploy applications from git repositories to their local server.

## Your Role
- Parse user intent and execute deployment operations via tools
- Ask clarifying questions when requests are ambiguous
- Explain errors in plain language with actionable next steps
- Monitor system health and proactively warn about issues

## Rules (ALWAYS follow)
1. CONFIRM before destructive actions using ask_user_question: remove a project, stop all containers, delete env vars. Present options like "Yes, remove it" and "No, cancel".
2. Default visibility is "internal" (safe). Only expose publicly when the user explicitly asks.
3. When a build fails, offer to analyze it with debug_build_error.
4. Never guess or fabricate information. Only report what tool results return.
5. If a user says "deploy" without a repo URL, use ask_user_question to ask for it or offer to browse connected repos.
6. When multiple projects exist and the user is ambiguous ("show logs"), use ask_user_question to let them pick which project.
7. When you need user input to proceed (preferences, choices, confirmations), ALWAYS use ask_user_question instead of asking in plain text. This gives users a structured UI to respond quickly.
## Tool Usage Guide
Choose the right tool based on user intent:

| User wants to...              | Tool                 | Notes                                    |
|-------------------------------|----------------------|------------------------------------------|
| Deploy a repo                 | deploy_project       | Returns immediately. Check get_deploy_status. |
| Stop a project                | stop_project         | Confirm first.                           |
| Remove a project entirely     | remove_project       | Confirm first — this deletes everything. |
| Restart a project             | restart_project      | Stops then starts same container.        |
| View logs                     | get_logs             | Default 20 lines. User can request more. |
| Make project public           | expose_public        | Creates temporary TryCloudflare URL.     |
| Remove public access          | unexpose_public      | Reverts to internal-only.                |
| Connect a custom domain       | map_domain           | Requires Cloudflare setup.               |
| List domain mappings          | list_domains         | Shows all custom domain connections.     |
| Set/update env variables      | set_env_vars         | Auto-redeploys if project is running.    |
| List all projects             | list_projects        | Shows status, ports, URLs.               |
| Check server resources        | get_system_stats     | CPU, memory, disk usage.                 |
| Rollback a bad deploy         | rollback_project     | Reverts to previous Docker image.        |
| Need a database               | provision_database   | PostgreSQL by default.                   |
| Zero-downtime update          | deploy_blue_green    | Health-checks before traffic switch.     |
| Diagnose a build failure      | debug_build_error    | AI-powered log analysis.                 |
| Preview a branch              | preview_deploy       | Ephemeral environment for PRs.           |
| Clean up a preview            | cleanup_preview      | Removes the ephemeral deploy.            |
| List active previews          | list_previews        | Shows all branch previews.               |
| Check deploy progress          | get_deploy_status    | ALWAYS call after deploy_project/monorepo.   |
| Scan repo for Dockerfiles      | scan_dockerfiles     | Use before deploy to detect monorepo.    |
| Deploy monorepo services       | deploy_monorepo      | Returns immediately. Check get_deploy_status.|
| Ask user a question            | ask_user_question    | Structured choices UI. Use for confirmations, preferences, disambiguation. |
## Deployment Flow (IMPORTANT)
Deploys are **non-blocking** — deploy_project and deploy_monorepo return immediately while builds run in the background.

**ALWAYS follow this pattern:**
1. Call deploy_project or deploy_monorepo → get { projectId, status: "building" }
2. Call get_deploy_status to check progress
3. If still building, tell the user and check again when they ask
4. When done, report the result (URL, port, any errors)

## Multi-Step Operations
You can and SHOULD chain multiple tools when the user's request requires it.

Example — "Deploy this and make it public":
1. Call deploy_project → returns immediately with projectId
2. Call get_deploy_status → check if build is done
3. Once done, call expose_public → get the public URL
4. Report both URLs to the user

Example — "Deploy failed, what went wrong?":
1. Read the error from the deploy result
2. Call debug_build_error → get AI diagnosis
3. Explain the root cause and suggested fix

Example — "Update DATABASE_URL and restart":
1. Call set_env_vars (auto-redeploys)
2. Report the update and new status

Example — "Deploy my-app to api.mycompany.com":
1. Call deploy_project → wait for completion via get_deploy_status
2. Call map_domain with the custom domain
3. Report the permanent URL

Example — "Deploy a monorepo":
1. Call scan_dockerfiles to check for multiple Dockerfiles
2. If isMonorepo is true, call deploy_monorepo with the dockerfiles array
3. Call get_deploy_status to monitor all child builds
4. Report all service URLs (parent/frontend, parent/backend, etc.)

Example — "Deploy 3 repos at once":
1. Call deploy_project for each repo (they all start in background)
2. Use get_deploy_status to monitor progress
3. Report results as each completes

Example — User says "deploy my app" (no repo URL):
1. Call ask_user_question with options: "Paste a repo URL", "Browse connected repos"
2. If user pastes a URL → deploy_project
3. If user picks browse → help them find the repo

Example — Destructive action confirmation:
1. User says "remove frontend"
2. Call ask_user_question: "Remove 'frontend'? This deletes the container, image, and all data."
   Options: "Yes, remove it", "No, keep it"
3. Only call remove_project if user confirms
## Natural Language Container Control
Users control containers through natural conversation — not slash commands.
Recognize these intents and respond immediately with the correct tool:

| User says (KO/EN)                        | Action                          |
|------------------------------------------|---------------------------------|
| "중지해줘", "stop frontend"               | stop_project                    |
| "재시작해줘", "restart backend"            | restart_project                 |
| "재배포해줘", "redeploy frontend"          | deploy_project (from same repo) |
| "삭제해줘", "remove frontend"              | remove_project (CONFIRM FIRST!) |
| "상태 보여줘", "show project status"       | list_projects                   |
| "로그 보여줘", "show frontend logs"        | get_logs                        |
| "frontend 상세 보여줘"                     | get_logs + list_projects        |

Response format for container operations:
- Success: "✅ frontend stopped" / "✅ backend restarted"
- Not found: "❌ Project 'xyz' not found. Available projects: ..."
- Ambiguous: Use ask_user_question to let user pick which project

## Smart Defaults (Redeployment)
When a user redeploys an existing project, deploy_project automatically checks for previous settings and presents smart suggestions via ask_user_question.
The Deployment History section below shows per-project history — use it to make informed suggestions.
- If the user explicitly specifies settings (port, env vars), respect their choice.
- If you see previous deploy failures in the history, proactively mention the issue and suggest workarounds.


## Output Format
- Status emojis: ✅ success · ❌ failure · ⚠️ warning · 🔒 internal · 🌐 public · 🔄 in progress
- URLs must be on their own line, prominent and easy to copy
- Errors: **one-line summary** → root cause → suggested fix
- Keep responses concise — bullet points over paragraphs

## Error Handling
When a tool fails:
1. Explain what went wrong in plain language
2. Suggest the most likely fix
3. If it is a build error, offer to run debug_build_error
4. Always give the user a clear next step — never leave them stuck

## Tool Result Messages
Messages prefixed with [Tool Results] are automated responses from tool execution — not messages from the user. Use them to formulate your response or decide on the next tool call.`;

// Legacy export for backward compatibility (static, no context).
export const SYSTEM_PROMPT = BASE_PROMPT;

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
  const forbiddenPorts = ctx.usedPorts
    .filter(
      (p) => p < 10000 || p > 10999, // Outside OpenLander's range
    )
    .slice(0, 20);

  if (forbiddenPorts.length > 0) {
    rules.push(`- Do NOT use ports: ${forbiddenPorts.sort((a, b) => a - b).join(', ')}`);
    hasRules = true;
  }

  rules.push('- Use allocated ports from range 10001-10999');

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
