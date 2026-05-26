import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Guards the 0.1 invariant that built-in AI Ops / recovery / web-agent paths
 * stay cold-storage. The in-memory ApprovalGate is a dormant compatibility
 * shell (live approvals flow through actionRuns); these producers are the only
 * things that would create pending ApprovalGate state. If a future change wires
 * any of them live, this test fails on purpose — forcing a deliberate review
 * that includes the deferred T1 follow-up (back ApprovalGate with actionRuns
 * before re-enabling, see src/pipeline/approval-gate.ts).
 */
function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

describe('AI-ops cold-storage invariant (0.1)', () => {
  const appSource = readWorkspaceFile('src/app.ts');

  it('documents the V0.2_REENABLE cold-storage intent', () => {
    expect(appSource).toContain('V0.2_REENABLE');
    expect(appSource).toContain('must stay off');
  });

  it('constructs the recovery coordinator but never starts it', () => {
    expect(appSource).toContain('new RecoveryCoordinator(');
    // The only mention of coordinator.start() must be the explanatory comment,
    // never an actual call statement — with or without args (e.g.
    // `coordinator.start({ opsAgent })`), optionally awaited/voided. Anchored to
    // line start so the mid-line mention inside the V0.2_REENABLE comment is fine.
    expect(appSource).not.toMatch(/^\s*(?:await\s+|void\s+)?coordinator\.start\s*\(/m);
  });

  it('does not construct OpsAgent in the app composition', () => {
    expect(appSource).not.toContain('new OpsAgent(');
  });

  it('does not wire automatic recovery in the app composition', () => {
    expect(appSource).not.toContain('setupAutoRecovery(');
  });

  it('keeps the LLM / web-agent path disabled (no live ApprovalGate producer)', () => {
    expect(appSource).toContain('const model: LanguageModel | null = null;');
    expect(appSource).not.toContain('new AgentPool(');
  });
});
