# OpenLander — Project Status

> Last updated: 2025-02-25

## Overview

"레포 URL → 배포 URL" AI 에이전트. npm 글로벌 패키지.

## Codebase Stats

- **LoC**: ~14,000+ (TypeScript)
- **Tests**: 118/118 passing (vitest)
- **Tools**: 23 agent tools, all synced to MCP server
- **Commits**: v0.1 → v0.4 pipeline + agent redesign + parallel/monorepo

## Architecture

```
User (Web Chat / CLI / MCP) → Agent (LLM) → Pipeline (deterministic)
                                  ↓
                        Tools (23) → Docker/Git/Cloudflare
```

## Implemented Layers

### Pipeline (v0.1–v0.4) ✅ Complete

- git clone → docker build → docker run → Traefik → Cloudflare
- Blue-green deploy, rollback, preview environments
- DB provisioning (SQLite/Postgres sidecar)
- Build debugger (LLM + recipe system)
- **Parallel deploy**: Promise.all for multi-tool execution
- **Monorepo**: parent-child project model, cascading stop/remove

### Agent (v0.2 redesign + v0.4 parallel) ✅ Complete

- Agentic loop: LLM → tool → result → LLM (max 10 steps)
- Dynamic system prompt (live server state injected per turn)
- Model overlays: gemini/anthropic/openai/openrouter/ollama
- History sliding window (max 40, keep recent 30)
- Build error recipes (10 patterns, fast-path in debugger)
- 23 tools across v0.1–v0.4 + parallel/monorepo
- Context scaling: summary-based, not raw log dump

### JobManager ✅ Complete

- In-memory deploy phase tracker
- Phases: queued → cloning → building → starting → done | failed
- `get_deploy_status` tool for real-time progress
- Wired into DeployPipeline and AppContext

### Monorepo Support ✅ Complete

- `scan_dockerfiles` tool: clone + walk for Dockerfile paths
- `deploy_monorepo` tool: parent project + parallel child builds
- `deployMonorepo()` in DeployPipeline: Promise.all across services
- Cascading stop/remove from parent to all children
- DB schema: `parent_project_id` + `dockerfile_path` columns
- DB migration: `migrate()` handles existing DBs missing new columns

### MCP Server ✅ Synced (23/23 tools)

- `src/mcp/server.ts` — stdio transport, Zod validation
- All 23 tools exposed with proper schemas

### Web UI ✅ Exists

- Chat-based SSE streaming (`/api/chat`)
- Project dashboard

### CLI ✅ Exists

- `openlander serve`, `openlander deploy`, `openlander mcp`

## Data Model

```typescript
ProjectRow {
  id, name, repo_url, branch, status, visibility,
  assigned_port, container_id, image_tag, previous_image_tag,
  public_url, parent_project_id, dockerfile_path,
  created_at, updated_at
}
```

## Known Issues / Gaps

| #   | Issue                                                             | Priority |
| --- | ----------------------------------------------------------------- | -------- |
| 1   | Deploy is synchronous — blocks until build finishes               | P0       |
| 2   | Destructive actions (remove/stop) have no code-level confirmation | P1       |
| 3   | Error messages are developer-facing, not agent-recovery-facing    | P1       |
| 4   | No behavioral mode detection (deploy vs debug vs explain)         | P1       |
| 5   | History uses simple trim, no compaction/summarization             | P2       |

## Constraints (from instruction.md)

- 멀티 에이전트 구조 만들지 말 것
- AST 파싱/정적 분석기 직접 만들지 말 것
- Dockerfile 없는 레포 지원하지 말 것 (v0.1)
- Docker Compose 패키징 금지 (npm 패키지로 배포)
- 보안/인증/RBAC v0.1에 넣지 말 것
- 실행은 deterministic, LLM은 대화/설명/에러 분석만
- 모노레포까진 무조건 되어야해

## Key Files

```
src/agent/index.ts          — Agent class (agentic loop, history, streaming)
src/agent/prompts.ts        — System prompt builder, model overlays, context snapshot
src/agent/tools.ts          — 23 tool definitions with rich descriptions
src/agent/recipes.ts        — 10 build error recipes
src/agent/debugger.ts       — BuildDebugger (recipe fast-path + LLM)
src/pipeline/deploy.ts      — DeployPipeline (deploy, monorepo, rollback, stop, remove)
src/pipeline/job-manager.ts — JobManager (in-memory phase tracker)
src/mcp/server.ts           — MCP server (23 tools, Zod schemas)
src/app.ts                  — AppContext wiring
src/db/index.ts             — Database (SQLite, migration support)
src/db/schema.ts            — SQL schema definition
src/llm/index.ts            — LLM client interface (5 providers)
```

## Git History (recent)

```
7015e29 fix: DB migration — add columns to existing tables on startup
dadcd4f feat: agent tools, prompts, and MCP for parallel/monorepo
57a58e5 feat: parallel deploy pipeline + monorepo support
8772420 feat: add JobManager for deploy phase tracking
5b4e184 feat: DB schema — parent-child project model for monorepo support
01c07e5 feat: agent layer redesign — agentic loop, dynamic prompts, model overlays, recipes
ecb4a82 fix: Discord Ed25519 verification — SPKI DER key format + replay protection
04fc79b feat: v0.4 — Slack/Discord/Telegram bots, auto-Dockerfile, preview deploys
```
