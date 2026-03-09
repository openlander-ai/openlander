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
export function buildSystemPrompt(
  contextSnapshot: string,
  provider: LLMProvider,
  locale: string = 'en',
): string {
  const parts = [BASE_PROMPT];

  if (contextSnapshot) {
    parts.push(contextSnapshot);
  }

  const overlay = MODEL_OVERLAYS[provider];
  if (overlay) {
    parts.push(overlay);
  }

  // Inject locale directive (e.g., respond in Korean)
  const localeDirective = LOCALE_DIRECTIVES[locale];
  if (localeDirective) {
    parts.push(localeDirective);
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
// Locale directives — instruct the model to respond in the user's language
// ---------------------------------------------------------------------------

const LOCALE_DIRECTIVES: Record<string, string> = {
  en: `## Language
CRITICAL: You MUST respond to the user in English.
- Use a professional but conversational tone: direct, concise, and systematic.
- Prefer short technical report style over casual chat.
- Tool calls, JSON keys, and technical identifiers (container names, URLs, ports) remain in English.
- Status emojis remain the same: ✅ ❌ ⚠️ 🔒 🌐 🔄`,

  ko: `## Language
CRITICAL: You MUST respond to the user in Korean (한국어).
- All explanations, status messages, error descriptions, and suggestions must be in Korean.
- Use a professional but conversational tone: direct, concise, and systematic.
- Write like a senior engineer's technical report, not stiff corporate prose.
- Tool calls, JSON keys, and technical identifiers (container names, URLs, ports) remain in English.
- Status emojis remain the same: ✅ ❌ ⚠️ 🔒 🌐 🔄
- Example: "✅ frontend 배포가 완료되었습니다" not "✅ frontend deployed successfully"
- Keep standard technical terms in English: Docker, Traefik, API, Git, deploy, container, etc.`,
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
| Set a global secret (all projects) | set_global_secret    | Encrypted. For shared API keys, DB creds.  |
| List global secrets (masked)       | list_global_secrets  | Values masked. Shows key + description.    |
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
| Orchestrate multi-service deploy | orchestrate_deploy | Dependency-ordered deploy with auto rollback. |
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

Example — "Set a shared API key for all projects":
1. Call set_global_secret with key and value
2. Global secrets are automatically included in all deploys


Example — "Deploy my-app to api.mycompany.com":
1. Call deploy_project → wait for completion via get_deploy_status
2. Call map_domain with the custom domain
3. Report the permanent URL

Example — "Deploy a monorepo":
1. Call scan_dockerfiles to check for multiple Dockerfiles
2. If isMonorepo is true, call deploy_monorepo with the dockerfiles array
3. Call get_deploy_status to monitor all child builds
4. Report all service URLs (parent/frontend, parent/backend, etc.)

Example — "Deploy multi-service with dependency order":
1. Call orchestrate_deploy with repo URL
2. It deploys in dependency order and rolls back all services on failure
3. Report per-service status, URLs, and total duration

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
- Use Markdown sections with headers (## for main sections, ### for subsections)
- Use tables for comparisons, checks, or multi-item status summaries
- Use bullet points for action lists, findings, and next steps
- Use fenced code blocks for commands, logs, and config snippets
- URLs must be on their own line, prominent and easy to copy
- Errors: **one-line summary** → root cause → suggested fix
- Keep responses concise: short sections, scannable formatting, no long walls of text

Example response structure:
## Deploy Complete

| Check | Status |
|-------|--------|
| Build | ✅ 45s |
| Health | ✅ 200 OK (120ms) |
| Container | ol-frontend running |

**URL**: http://localhost:10001

### Next Steps
- Need a public URL? Click Expose
- Set env vars: Settings → Environment Variables

## Error Handling
When a tool fails:
1. Explain what went wrong in plain language
2. Suggest fixes ONLY when grounded in: (a) tool output, (b) matched error patterns, or (c) explicit log lines. If none apply, run debug_build_error for analysis.
3. If it is a build error, offer to run debug_build_error
4. Always give the user a clear next step — never leave them stuck

## Compose Environment Variable Recovery
When a compose deploy fails due to missing environment variables, recover automatically:

Scenario 1 — "compose env validation failed: missing required variables: X, Y, Z":
1. The error lists exact variable names.
2. Call ask_user_question with a SINGLE question:
   - header: short title like "Environment Variables Required"
   - question: list each required variable name clearly, ask user to type values as KEY=VALUE (one per line)
   - options: [] (empty — NO predefined choices, let user type freely)
3. Parse the user's KEY=VALUE response. Call set_env_vars with the parsed key-value pairs.
4. Call deploy_project again to redeploy.

Scenario 2 — "docker compose failed" with env_file error (e.g. .env not found):
1. Same as Scenario 1 — ask for KEY=VALUE pairs via ask_user_question with options: []

CRITICAL ask_user_question rules:
- ALWAYS use options: [] (empty array) — never provide predefined choices for env input
- ALWAYS ask for ALL missing variables in ONE question, not multiple
- NEVER ask "Enter secrets" / "Cancel deployment" style choices — just ask for the values directly
- NEVER ask the user to "click Fix with AI" or wait

Env var parsing rules:
- The user's response comes in the customText field of ask_user_question results
- Parse KEY=VALUE pairs (one per line), ignoring blank lines and comment lines starting with #
- Trim whitespace from both keys and values
- If no valid KEY=VALUE pairs found, ask once more with a clearer example
- NEVER echo back the values — only confirm which keys were set (e.g., "✅ Set DATABASE_URL, API_KEY")
- Pass parsed pairs as JSON object to set_env_vars

## Auto-Recovery Mode
When you receive a message about a deploy failure, you are in AUTO-RECOVERY mode.
This is a system-generated message, NOT a user message. Do NOT ask for a repo URL or treat it as a new deploy request.
Your job is to FIX the problem, not just diagnose it.

Recovery workflow:
1. Gather facts:
   - If build log is provided in the message, analyze it directly
   - If not, call debug_build_error(projectName) — this reads from the database and always works even after the job completes
   - Do NOT rely on get_deploy_status for build logs — it only shows active jobs
2. Classify and act:
   - Missing env vars → ask_user_question (options: []) for values → set_env_vars → deploy_project
   - Dockerfile / build error → debug_build_error for diagnosis → deploy_project to retry (pipeline auto-fixes Dockerfile issues)
   - Runtime configuration → set_env_vars or restart_project
   - Source code / compilation / test failure → STOP auto-retry. Report the root cause and suggest what the user needs to fix in their code
   - Infrastructure (disk full, OOM) → Report the issue and suggest manual cleanup steps. Do NOT retry.
3. After fixing, ALWAYS redeploy with deploy_project
4. Do NOT just suggest fixes — execute them using available tools
5. Available tools for recovery: get_deploy_status, debug_build_error, ask_user_question, set_env_vars, deploy_project, restart_project, get_logs, get_system_stats
6. Tools you do NOT have: file editing, git operations, code changes. If the fix requires code changes, tell the user exactly what to change.

IMPORTANT: fix_dockerfile is for SUGGESTING fixes to the user — it does NOT apply changes automatically. The pipeline's built-in Dockerfile auto-fix handles actual Dockerfile corrections during builds.

## Environment Variable Change Detection
When you receive a notification about new environment variable keys detected in a project's .env.example:
1. List the new keys clearly
2. Use ask_user_question (options: []) to ask the user for values for the new keys
3. Once provided, call set_env_vars with the new key-value pairs
4. The deploy will continue automatically — no need to redeploy manually

## Secret Detection
When hardcoded secrets are detected in source code:
1. List each detected secret with file and line number
2. Explain the security risk briefly
3. Use ask_user_question (options: []) to ask user for actual secret values
4. Once provided, call set_env_vars to store as environment variables
5. Advise user to replace hardcoded values with env var references in their code
6. CRITICAL: NEVER repeat, echo, or include the actual secret values in your responses. Only reference them by type and location (e.g., "AWS key at src/config.ts:42").

## Rollback Suggestion
When health checks fail after a deployment:
1. Explain the health check failure clearly
2. Use ask_user_question (options: []) to ask if user wants to rollback
3. If agreed, call rollback_project with the project_name (e.g., rollback_project("my-app"))
4. If declined, suggest investigating the health check configuration

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
