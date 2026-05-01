import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('deploy-flow unification integration evidence', () => {
  it('keeps QuestionBridge timeout safety for pending ask sessions', () => {
    const source = readSource('src/lib/question-bridge.ts');

    expect(source).toContain('const QUESTION_SESSION_TIMEOUT_MS = 5 * 60 * 1000;');
    expect(source).toContain('Session timed out — user did not respond within 5 minutes');
    // 1.0 GA refactor: pending entries are tracked per requestId so concurrent
    // agent streams cannot trample each other. Each entry still arms a
    // timeout via timerApi.setTimeout and clears it via clearPendingTimeout.
    expect(source).toContain('entry.timeout = timerApi.setTimeout(() => {');
    expect(source).toContain('this.clearPendingTimeout(entry);');
  });

  it('keeps scan_project adapter wiring and scan-first prompt guidance aligned', () => {
    const toolsSource = readSource('src/tools/index.ts');
    const gitToolDefsSource = readSource('src/tools/defs/git.ts');
    const promptsSource = readSource('src/llm/prompts.ts');

    expect(toolsSource).toContain("import { toAiSdkTools } from './adapters/ai-sdk.js';");
    expect(toolsSource).toContain('...gitToolDefs,');
    expect(toolsSource).toContain('return toAiSdkTools(agentToolDefs, ctx, questionBridge);');
    expect(gitToolDefsSource).toContain("name: 'scan_project'");
    expect(gitToolDefsSource).toContain("targets: ['agent']");
    expect(gitToolDefsSource).toContain(
      'isMonorepo: dockerfiles.length > 1 || composeFiles.length > 0',
    );
    expect(promptsSource).toContain('## Deploy Planning Mode');
    expect(promptsSource).toContain('Call scan_project before any deploy call.');
    expect(promptsSource).toContain(
      'ask_user_question to let the user choose which app/service(s) to deploy.',
    );
  });

  it('keeps agent-driven deploy route without timeout fallback while preserving no-agent path', () => {
    const source = readSource('src/web/api/deploy-stream-routes.ts');

    expect(source).toContain('if (!ctx.agent) {');
    expect(source).toContain('const result = await ctx.pipeline.deploy({');
    expect(source).not.toContain('setTimeout(() =>');
    expect(source).not.toContain('agent_completed_without_deploy_project');
  });

  it('keeps the typed deployProject helper pointed at the unified deploy endpoint', () => {
    // v5: NewProjectFlow.tsx was retired — humans now hit AgentGuideDialog
    // from /projects, and /api/projects/deploy is reached via MCP tools or
    // direct API. The assertion below pins what's left of the original
    // contract: the typed helper still POSTs to the unified endpoint, so
    // any future web caller (or test fixture) routes there.
    const apiClient = readSource('web/src/lib/api/projects.ts');
    expect(apiClient).toContain("return apiPost<DeployResult>('/api/projects/deploy', body);");
  });
});
