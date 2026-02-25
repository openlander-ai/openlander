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
import type { ProjectRow, Database } from '../db/index.js';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Callback that returns a context snapshot string at call-time. */
export type ContextProvider = () => string;

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
 */
export function buildContextSnapshot(db: Database): string {
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

  return `## Current Server State (auto-injected)
Projects deployed: ${String(projects.length)}
${projectLines}

Resources: CPU ${String(stats.cpu.usagePercent)}% · Memory ${String(stats.memory.usedMB)}/${String(stats.memory.totalMB)}MB (${String(stats.memory.usagePercent)}%) · Disk ${String(stats.disk.usagePercent)}%${stats.memory.usagePercent > 85 ? '\n⚠️ Memory usage is high — suggest cleaning up unused projects.' : ''}${stats.disk.usagePercent > 90 ? '\n⚠️ Disk usage is critical.' : ''}`;
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
1. CONFIRM before destructive actions: remove a project, stop all containers, delete env vars.
2. Default visibility is "internal" (safe). Only expose publicly when the user explicitly asks.
3. When a build fails, offer to analyze it with debug_build_error.
4. Never guess or fabricate information. Only report what tool results return.
5. If a user says "deploy" without a repo URL, ask for it.
6. When multiple projects exist and the user is ambiguous ("show logs"), ask which project.

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
