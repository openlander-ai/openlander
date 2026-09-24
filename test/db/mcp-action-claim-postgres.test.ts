import postgres from 'postgres';
import { describe, expect, it } from 'vitest';
import { Database } from '../../src/db/index.js';
import {
  getOperationPermissionSnapshot,
  saveOperationPermissionOverride,
} from '../../src/security/operation-permissions.js';

const url = process.env.OPENLANDER_DATABASE_URL ?? process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite('MCP continuation on Postgres', () => {
  it('claims execution once across concurrent connections and persists narrow grants', async () => {
    const adminUrl = new URL(url!);
    adminUrl.pathname = '/postgres';
    const admin = postgres(adminUrl.toString(), { max: 1 });
    const name = `ol_mcp_claim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    let db: Database | undefined;
    try {
      await admin.unsafe(`CREATE DATABASE "${name}"`);
      const testUrl = new URL(url!);
      testUrl.pathname = `/${name}`;
      db = await Database.connect(testUrl.toString());
      const id = await db.createPendingMcpApproval({
        projectId: 'a',
        toolName: 'stop_app',
        plan: '{}',
      });
      const claims = await Promise.all(
        Array.from({ length: 30 }, () => db!.claimMcpActionExecution(id, true)),
      );
      expect(claims.filter(Boolean)).toHaveLength(1);
      // A late web rejection/approval cannot overwrite the claimed execution.
      await db.updateActionRunApproval(id, 'rejected', 'destructive_mcp');
      await db.updateActionRunApproval(id, 'approved', 'destructive_mcp');
      expect(await db.getActionRun(id)).toMatchObject({
        status: 'running',
        approval_status: 'approved',
      });
      await db.updateActionRunStatus(id, 'succeeded');
      expect(await db.claimMcpActionExecution(id, true)).toBe(false);
      const rejected = await db.createPendingMcpApproval({
        projectId: 'a',
        toolName: 'delete_app',
        plan: '{}',
      });
      await db.updateActionRunApproval(rejected, 'rejected', 'destructive_mcp');
      expect(await db.claimMcpActionExecution(rejected, true)).toBe(false);

      await saveOperationPermissionOverride(
        db,
        { projectId: 'a' },
        { destructive_actions: 'block', database_access: 'block', app_lifecycle: 'allow' },
      );
      await db.close();
      db = await Database.connect(testUrl.toString());
      expect((await getOperationPermissionSnapshot(db, { projectId: 'a' })).effective).toEqual({
        app_lifecycle: 'allow',
        destructive_actions: 'block',
        database_access: 'block',
      });
      expect(await db.claimMcpActionExecution(id, true)).toBe(false);
    } finally {
      await db?.close();
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    }
  }, 30_000);
});
