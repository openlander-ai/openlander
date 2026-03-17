import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function readSource(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

describe('deploy-flow unification integration evidence', () => {
  it('keeps QuestionBridge timeout safety for pending ask sessions', () => {
    const source = readSource('src/agent/question-bridge.ts');

    expect(source).toContain('const QUESTION_SESSION_TIMEOUT_MS = 5 * 60 * 1000;');
    expect(source).toContain('Session timed out — user did not respond within 5 minutes');
    expect(source).toContain('this.pendingTimeout = timerApi.setTimeout(() => {');
    expect(source).toContain('this.clearPendingTimeout();');
  });

  it('keeps scan_project tool and scan-first prompt guidance aligned', () => {
    const toolsSource = readSource('src/agent/tools.ts');
    const promptsSource = readSource('src/agent/prompts.ts');

    expect(toolsSource).toContain('scan_project: tool({');
    expect(toolsSource).toContain('isMonorepo: dockerfiles.length > 1 || composeFiles.length > 0');
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

  it('keeps both web entry points routed to unified deploy endpoint assumptions', () => {
    const deployDialog = readSource('web/src/components/sidebar/DeployDialog.tsx');
    const newProjectFlow = readSource('web/src/pages/NewProjectFlow.tsx');
    const apiClient = readSource('web/src/lib/api.ts');

    expect(deployDialog).toContain("import { deployProject } from '@/lib/api';");
    expect(newProjectFlow).toContain("import { deployProject } from '@/lib/api';");
    expect(apiClient).toContain("const res = await fetch('/api/projects/deploy', {");
  });
});
