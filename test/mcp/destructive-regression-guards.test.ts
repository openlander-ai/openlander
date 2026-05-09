import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readWorkspaceFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), 'utf8');
}

function sliceBetween(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe('destructive MCP safety regression guards', () => {
  it('keeps pending approval reads limited to recent pending rows', () => {
    const source = readWorkspaceFile('src/db/repos/action-run.repo.ts');
    const method = sliceBetween(
      source,
      'async findByApprovalStatus',
      'async findRunning',
    );

    expect(method).toContain("eq(actionRuns.approval_status, 'pending')");
    expect(method).toContain("eq(actionRuns.status, 'pending_approval')");
    expect(method).toContain('gte(');
    expect(method).toContain('actionRuns.approval_requested_at');
    expect(method).toContain('60 * 60 * 1000');
  });

  it('keeps approved destructive MCP approvals failed on startup instead of re-running them', () => {
    const source = readWorkspaceFile('src/db/repos/action-run.repo.ts');
    const method = source.slice(source.indexOf('async markStaleAsFailedOnStartup'));

    expect(method).toContain("eq(actionRuns.status, 'pending_approval')");
    expect(method).toContain("eq(actionRuns.approval_status, 'approved')");
    expect(method).toContain("eq(actionRuns.approval_tool, 'destructive_mcp')");
    expect(method).toContain("error_message: 'server_restart_during_execute'");
  });

  it('keeps service-owned env, domain, and config rows cascading with service deletion', () => {
    const source = readWorkspaceFile('src/db/schema.drizzle.ts');
    const envVarsBlock = sliceBetween(source, 'export const envVars', 'export const deployLogs');
    const domainMappingsBlock = sliceBetween(
      source,
      'export const domainMappings',
      'export const oauthTokens',
    );
    const deployConfigsBlock = sliceBetween(
      source,
      'export const deploy_configs',
      'export const serviceOpsOverrides',
    );
    const serviceOpsBlock = sliceBetween(
      source,
      'export const serviceOpsOverrides',
      '/** Back-compat alias',
    );

    expect(envVarsBlock).toContain(
      "service_id: text('service_id').references(() => services.id, { onDelete: 'cascade' })",
    );
    expect(domainMappingsBlock).toContain(
      ".references(() => services.id, { onDelete: 'cascade' })",
    );
    expect(deployConfigsBlock).toContain(
      ".references(() => services.id, { onDelete: 'cascade' })",
    );
    expect(serviceOpsBlock).toContain(
      ".references(() => services.id, { onDelete: 'cascade' })",
    );
  });
});
