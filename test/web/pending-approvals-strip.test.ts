import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

function readRepoFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('pending approval strip surface', () => {
  const homeSource = readRepoFile('web/src/pages/Home.tsx');
  const appShellSource = readRepoFile('web/src/components/Shell/AppShell.tsx');
  const componentSource = readRepoFile('web/src/components/Shell/PendingApprovalsStrip.tsx');
  const approvalsApiSource = readRepoFile('web/src/lib/api/approvals.ts');
  const enSource = readRepoFile('web/src/i18n/en.ts');
  const koSource = readRepoFile('web/src/i18n/ko.ts');

  it('mounts the pending approval strip globally in AppShell', () => {
    // The MCP approval hold now gates archive/unarchive for projects and
    // services, so the strip is mounted once in the app shell (reachable
    // from every route) rather than on Home alone.
    expect(appShellSource).toContain('PendingApprovalsStrip');
    expect(appShellSource).toContain('<PendingApprovalsStrip />');
    expect(appShellSource).toContain('empty:hidden');
    expect(homeSource).not.toContain('<PendingApprovalsStrip />');
  });

  it('uses the shared action-run approve/reject route', () => {
    expect(approvalsApiSource).toContain('/api/approvals/pending');
    expect(approvalsApiSource).toContain('/api/action-runs/${encodeURIComponent(id)}/approve');
    expect(approvalsApiSource).toContain('/api/action-runs/${encodeURIComponent(id)}/reject');
    expect(componentSource).toContain('approveActionRun(actionRunId)');
    expect(componentSource).toContain('rejectActionRun(actionRunId)');
    expect(componentSource).toContain('ACTION_RUN_RESOLVED_EVENT');
    expect(componentSource).toContain('new CustomEvent<ActionRunResolvedDetail>');
  });

  it('renders destructive MCP details from approval metadata', () => {
    expect(componentSource).toContain('approval.metadata.details');
    expect(componentSource).toContain('DETAIL_ORDER');
    expect(componentSource).toContain('formatApprovalDetailValue');
    expect(componentSource).toContain("approval.metadata.source === 'mcp'");
  });

  it('keeps the global surface compact until the user reviews details', () => {
    expect(componentSource).toContain('max-w-3xl');
    expect(componentSource).toContain('aria-expanded={expanded}');
    expect(componentSource).toContain("t('approval.pendingStrip.review')");
    expect(componentSource).toContain("t('approval.pendingStrip.hide')");
    expect(componentSource).toContain('visibleApprovals.slice(0, 5)');
    expect(enSource).toContain('summaryMany');
    expect(koSource).toContain('summaryMany');
  });

  it('renders the MCP token identity that requested the destructive action', () => {
    expect(componentSource).toContain('describeApprovalActor');
    expect(componentSource).toContain('approval.metadata.actor');
    expect(componentSource).toContain('approval.pendingStrip.actor');
  });

  it('hides recently resolved cards locally while backend execution catches up', () => {
    expect(componentSource).toContain('RECENTLY_RESOLVED_MS');
    expect(componentSource).toContain('suppressResolvedApproval(actionRunId)');
    expect(componentSource).toContain('recentlyResolved.has(approval.metadata.actionRunId)');
  });

  it('announces new approval cards accessibly and avoids hard-coded black text', () => {
    expect(componentSource).toContain('aria-live="polite"');
    expect(componentSource).toContain('role="region"');
    expect(componentSource).not.toContain('text-black');
  });
});
