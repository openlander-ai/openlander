import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildContextSnapshot, buildIncidentBriefing } from '../../src/llm/context-assembler.js';
import type { ContextScope } from '../../src/llm/context-assembler.js';
import type { Database, ProjectRow, RuntimeIncidentRow } from '../../src/db/index.js';

/**
 * Golden test for context-assembler extraction.
 * Verifies that buildContextSnapshot produces deterministic output
 * with known database state.
 */
describe('context-assembler', () => {
  let mockDb: Partial<Database>;

  beforeEach(() => {
    // Create a mock database with known state
    mockDb = {
      listProjects: () => [
        {
          id: 'proj-1',
          name: 'frontend',
          status: 'running',
          assigned_port: 10001,
          public_url: null,
        } as ProjectRow,
        {
          id: 'proj-2',
          name: 'backend',
          status: 'error',
          assigned_port: 10002,
          public_url: null,
        } as ProjectRow,
      ],
      getGlobalSecrets: () => [
        {
          id: 'sec-1',
          key: 'DATABASE_URL',
          encrypted_value: 'secret',
          iv: 'iv1',
          description: null,
          created_at: null,
          updated_at: null,
        },
        {
          id: 'sec-2',
          key: 'API_KEY',
          encrypted_value: 'secret',
          iv: 'iv2',
          description: null,
          created_at: null,
          updated_at: null,
        },
      ],
      getProject: (id: string) => {
        const projects: Record<string, ProjectRow> = {
          'proj-1': {
            id: 'proj-1',
            name: 'frontend',
            status: 'running',
            assigned_port: 10001,
            public_url: null,
          } as ProjectRow,
          'proj-2': {
            id: 'proj-2',
            name: 'backend',
            status: 'error',
            assigned_port: 10002,
            public_url: null,
          } as ProjectRow,
        };
        return projects[id] || null;
      },
      getDeployLogs: () => [],
      getEnvVars: () => ({}),
      getTopDeploymentPatterns: () => [],
    };
  });

  describe('buildContextSnapshot', () => {
    it('should include project count in output', async () => {
      const snapshot = await buildContextSnapshot(mockDb as Database);
      expect(snapshot).toContain('Projects deployed: 2');
    });

    it('should include project names in output', async () => {
      const snapshot = await buildContextSnapshot(mockDb as Database);
      expect(snapshot).toContain('frontend');
      expect(snapshot).toContain('backend');
    });

    it('should include project statuses', async () => {
      const snapshot = await buildContextSnapshot(mockDb as Database);
      expect(snapshot).toContain('running');
      expect(snapshot).toContain('error');
    });

    it('should include port information', async () => {
      const snapshot = await buildContextSnapshot(mockDb as Database);
      expect(snapshot).toContain('10001');
      expect(snapshot).toContain('10002');
    });

    it('should include global secrets summary', async () => {
      const snapshot = await buildContextSnapshot(mockDb as Database);
      expect(snapshot).toContain('Global secrets');
      expect(snapshot).toContain('DATABASE_URL');
      expect(snapshot).toContain('API_KEY');
    });

    it('should include server state header', async () => {
      const snapshot = await buildContextSnapshot(mockDb as Database);
      expect(snapshot).toContain('## Current Server State');
    });

    it('should include resource information', async () => {
      const snapshot = await buildContextSnapshot(mockDb as Database);
      expect(snapshot).toContain('Resources:');
      expect(snapshot).toContain('CPU');
      expect(snapshot).toContain('Memory');
      expect(snapshot).toContain('Disk');
    });

    it('should return a non-empty string', async () => {
      const snapshot = await buildContextSnapshot(mockDb as Database);
      expect(snapshot.length).toBeGreaterThan(0);
    });

    it('should handle empty projects list', async () => {
      mockDb.listProjects = () => [];
      const snapshot = await buildContextSnapshot(mockDb as Database);
      expect(snapshot).toContain('no projects deployed yet');
    });

    it('should handle no global secrets', async () => {
      mockDb.getGlobalSecrets = () => [];
      const snapshot = await buildContextSnapshot(mockDb as Database);
      expect(snapshot).not.toContain('Global secrets');
    });
  });

  describe('buildIncidentBriefing', () => {
    it('should return empty string for no incidents', () => {
      const briefing = buildIncidentBriefing([], mockDb as Database);
      expect(briefing).toBe('');
    });

    it('should include incident header for incidents', () => {
      const incidents: RuntimeIncidentRow[] = [
        {
          id: 'inc-1',
          project_id: 'proj-1',
          category: 'crash',
          error_snippet: 'Out of memory',
          restart_count: 2,
          created_at: '2025-01-01T00:00:00Z',
        } as RuntimeIncidentRow,
      ];
      const briefing = buildIncidentBriefing(incidents, mockDb as Database);
      expect(briefing).toContain('⚠️ Active incidents:');
    });

    it('should include project name in incident briefing', () => {
      const incidents: RuntimeIncidentRow[] = [
        {
          id: 'inc-1',
          project_id: 'proj-1',
          category: 'crash',
          error_snippet: 'Out of memory',
          restart_count: 2,
          created_at: '2025-01-01T00:00:00Z',
        } as RuntimeIncidentRow,
      ];
      const briefing = buildIncidentBriefing(incidents, mockDb as Database);
      expect(briefing).toContain('frontend');
    });

    it('should include incident category', () => {
      const incidents: RuntimeIncidentRow[] = [
        {
          id: 'inc-1',
          project_id: 'proj-1',
          category: 'crash',
          error_snippet: 'Out of memory',
          restart_count: 2,
          created_at: '2025-01-01T00:00:00Z',
        } as RuntimeIncidentRow,
      ];
      const briefing = buildIncidentBriefing(incidents, mockDb as Database);
      expect(briefing).toContain('crash');
    });

    it('should include error snippet in briefing', () => {
      const incidents: RuntimeIncidentRow[] = [
        {
          id: 'inc-1',
          project_id: 'proj-1',
          category: 'crash',
          error_snippet: 'Out of memory',
          restart_count: 2,
          created_at: '2025-01-01T00:00:00Z',
        } as RuntimeIncidentRow,
      ];
      const briefing = buildIncidentBriefing(incidents, mockDb as Database);
      expect(briefing).toContain('Out of memory');
    });

    it('should handle null error snippet', () => {
      const incidents: RuntimeIncidentRow[] = [
        {
          id: 'inc-1',
          project_id: 'proj-1',
          category: 'crash',
          error_snippet: null,
          restart_count: 1,
          created_at: '2025-01-01T00:00:00Z',
        } as RuntimeIncidentRow,
      ];
      const briefing = buildIncidentBriefing(incidents, mockDb as Database);
      expect(briefing).toContain('n/a');
    });

    it('should count restart attempts', () => {
      const incidents: RuntimeIncidentRow[] = [
        {
          id: 'inc-1',
          project_id: 'proj-1',
          category: 'crash',
          error_snippet: 'Error',
          restart_count: 5,
          created_at: '2025-01-01T00:00:00Z',
        } as RuntimeIncidentRow,
      ];
      const briefing = buildIncidentBriefing(incidents, mockDb as Database);
      expect(briefing).toContain('5x crashes');
    });
  });

  describe('buildContextSnapshot with ContextScope', () => {
    let scopedDb: Partial<Database>;

    beforeEach(() => {
      scopedDb = {
        listProjects: () => [
          {
            id: 'proj-1',
            name: 'frontend',
            status: 'running',
            assigned_port: 10001,
            public_url: 'https://frontend.example.com',
          } as ProjectRow,
          {
            id: 'proj-2',
            name: 'backend',
            status: 'error',
            assigned_port: 10002,
            public_url: null,
          } as ProjectRow,
          {
            id: 'proj-3',
            name: 'worker',
            status: 'stopped',
            assigned_port: null,
            public_url: null,
          } as ProjectRow,
        ],
        getGlobalSecrets: () => [],
        getProject: (id: string) => {
          const projects: Record<string, ProjectRow> = {
            'proj-1': {
              id: 'proj-1',
              name: 'frontend',
              status: 'running',
              assigned_port: 10001,
              public_url: 'https://frontend.example.com',
            } as ProjectRow,
            'proj-2': {
              id: 'proj-2',
              name: 'backend',
              status: 'error',
              assigned_port: 10002,
              public_url: null,
            } as ProjectRow,
          };
          return projects[id] ?? null;
        },
        getDeployLogs: (_projectId: string, _limit?: number) => [],
        getEnvVars: () => ({}),
        getTopDeploymentPatterns: () => [],
      };
    });

    it('should behave identically with no scope (backward compat)', async () => {
      const withoutScope = await buildContextSnapshot(scopedDb as Database);
      const withGlobalScope = await buildContextSnapshot(scopedDb as Database, undefined, {
        type: 'global',
      });
      const normalize = (snapshot: string): string =>
        snapshot.replace(/Resources:.*$/m, 'Resources: <dynamic>');
      expect(normalize(withoutScope)).toBe(normalize(withGlobalScope));
    });

    it('should behave identically with explicit global scope', async () => {
      const noScope = await buildContextSnapshot(scopedDb as Database);
      const globalScope: ContextScope = { type: 'global' };
      const withScope = await buildContextSnapshot(scopedDb as Database, undefined, globalScope);
      const normalize = (snapshot: string): string =>
        snapshot.replace(/Resources:.*$/m, 'Resources: <dynamic>');
      expect(normalize(noScope)).toBe(normalize(withScope));
    });

    it('should show full details for focal project in project scope', async () => {
      const scope: ContextScope = { type: 'project', projectId: 'proj-1' };
      const snapshot = await buildContextSnapshot(scopedDb as Database, undefined, scope);
      expect(snapshot).toContain('frontend (running)');
      expect(snapshot).toContain('[ol-frontend]');
      expect(snapshot).toContain('https://frontend.example.com');
    });

    it('should show summary for non-focal projects in project scope', async () => {
      const scope: ContextScope = { type: 'project', projectId: 'proj-1' };
      const snapshot = await buildContextSnapshot(scopedDb as Database, undefined, scope);
      expect(snapshot).toContain('backend (error)');
      expect(snapshot).not.toContain('[ol-backend]');
      expect(snapshot).not.toContain('10002');
    });

    it('should still show all project count in project scope', async () => {
      const scope: ContextScope = { type: 'project', projectId: 'proj-1' };
      const snapshot = await buildContextSnapshot(scopedDb as Database, undefined, scope);
      expect(snapshot).toContain('Projects deployed: 3');
    });

    it('should include recovery context section for recovery scope with failed logs', async () => {
      scopedDb.getDeployLogs = (projectId: string, _limit?: number) => {
        if (projectId === 'proj-2') {
          return [
            {
              id: 'log-1',
              project_id: 'proj-2',
              status: 'failed',
              build_log: 'Step 5: [error] Cannot find module express',
              created_at: '2025-01-15T10:00:00Z',
              duration_ms: 15000,
            } as unknown as import('../../src/db/index.js').DeployLogRow,
            {
              id: 'log-2',
              project_id: 'proj-2',
              status: 'success',
              build_log: null,
              created_at: '2025-01-14T09:00:00Z',
              duration_ms: 30000,
            } as unknown as import('../../src/db/index.js').DeployLogRow,
          ];
        }
        return [];
      };

      const scope: ContextScope = { type: 'recovery', projectId: 'proj-2' };
      const snapshot = await buildContextSnapshot(scopedDb as Database, undefined, scope);
      expect(snapshot).toContain('## Recovery Context');
      expect(snapshot).toContain('Cannot find module express');
    });

    it('should not include recovery section when no failed logs exist', async () => {
      scopedDb.getDeployLogs = () => [
        {
          id: 'log-1',
          project_id: 'proj-2',
          status: 'success',
          build_log: null,
          created_at: '2025-01-14T09:00:00Z',
          duration_ms: 30000,
        } as unknown as import('../../src/db/index.js').DeployLogRow,
      ];

      const scope: ContextScope = { type: 'recovery', projectId: 'proj-2' };
      const snapshot = await buildContextSnapshot(scopedDb as Database, undefined, scope);
      expect(snapshot).not.toContain('## Recovery Context');
    });

    it('should include known patterns in recovery scope even without failed logs', async () => {
      scopedDb.getDeployLogs = () => [];
      scopedDb.getTopDeploymentPatterns = () => [
        {
          id: 'pattern-1',
          project_id: 'proj-2',
          pattern_type: 'build',
          error_signature: 'OOM killed during build',
          fix_action: JSON.stringify({
            strategy: 'recipe',
            recipe: 'Increase memory limit to 4GB',
          }),
          success_count: 3,
          failure_count: 0,
          last_seen_at: '2025-01-15T10:00:00Z',
          created_at: '2025-01-15T10:00:00Z',
          updated_at: '2025-01-15T10:00:00Z',
        } as unknown as import('../../src/db/schema.drizzle.js').DeploymentPatternRow,
      ];

      const scope: ContextScope = { type: 'recovery', projectId: 'proj-2' };
      const snapshot = await buildContextSnapshot(scopedDb as Database, undefined, scope);

      expect(snapshot).toContain('## Recovery Context');
      expect(snapshot).toContain('## Known Patterns for This Project');
      expect(snapshot).toContain('Pattern: OOM killed during build (seen 3 times, fixed 3 times)');
      expect(snapshot).toContain('Fix: Increase memory limit to 4GB');
    });

    it('recovery scope should also show scoped project lines', async () => {
      const scope: ContextScope = { type: 'recovery', projectId: 'proj-2' };
      const snapshot = await buildContextSnapshot(scopedDb as Database, undefined, scope);
      expect(snapshot).toContain('backend (error)');
      expect(snapshot).toContain('frontend (running)');
      expect(snapshot).not.toContain('[ol-frontend]');
    });

    it('should handle project scope with unknown projectId gracefully', async () => {
      const scope: ContextScope = { type: 'project', projectId: 'nonexistent' };
      const snapshot = await buildContextSnapshot(scopedDb as Database, undefined, scope);
      expect(snapshot).toContain('Projects deployed: 3');
      expect(snapshot).toContain('frontend (running)');
      expect(snapshot).toContain('backend (error)');
    });
  });

  describe('buildContextSnapshot — pattern injection', () => {
    it('injects deployment patterns for project scope', async () => {
      const mockPatterns = [
        {
          id: 'p1',
          project_id: 'proj1',
          pattern_type: 'build',
          error_signature: 'Module not found: react',
          fix_action: JSON.stringify({ recipe: 'npm install react' }),
          success_count: 5,
          failure_count: 1,
          last_seen_at: '2026-01-01',
          created_at: '2026-01-01',
          updated_at: '2026-01-01',
        } as unknown as import('../../src/db/schema.drizzle.js').DeploymentPatternRow,
      ];
      const mockDb = {
        listProjects: () => [
          {
            id: 'proj1',
            name: 'test-project',
            status: 'running',
            assigned_port: 10001,
            public_url: null,
          } as ProjectRow,
        ],
        getGlobalSecrets: () => [],
        getProject: (id: string) => {
          if (id === 'proj1') {
            return {
              id: 'proj1',
              name: 'test-project',
              status: 'running',
              assigned_port: 10001,
              public_url: null,
            } as ProjectRow;
          }
          return null;
        },
        getDeployLogs: () => [],
        getEnvVars: () => ({}),
        getTopDeploymentPatterns: vi.fn().mockReturnValue(mockPatterns),
      };
      const result = await buildContextSnapshot(mockDb as any, undefined, {
        type: 'project',
        projectId: 'proj1',
      });
      expect(result).toContain('## Known Deployment Patterns');
      expect(result).toContain('Module not found: react');
    });

    it('omits pattern section when no patterns exist', async () => {
      const mockDb = {
        listProjects: () => [
          {
            id: 'proj1',
            name: 'test-project',
            status: 'running',
            assigned_port: 10001,
            public_url: null,
          } as ProjectRow,
        ],
        getGlobalSecrets: () => [],
        getProject: (id: string) => {
          if (id === 'proj1') {
            return {
              id: 'proj1',
              name: 'test-project',
              status: 'running',
              assigned_port: 10001,
              public_url: null,
            } as ProjectRow;
          }
          return null;
        },
        getDeployLogs: () => [],
        getEnvVars: () => ({}),
        getTopDeploymentPatterns: vi.fn().mockReturnValue([]),
      };
      const result = await buildContextSnapshot(mockDb as any, undefined, {
        type: 'project',
        projectId: 'proj1',
      });
      expect(result).not.toContain('## Known Deployment Patterns');
    });

    it('does NOT load patterns for global scope', async () => {
      const getTopDeploymentPatterns = vi.fn().mockReturnValue([]);
      const mockDb = {
        listProjects: () => [
          {
            id: 'proj1',
            name: 'test-project',
            status: 'running',
            assigned_port: 10001,
            public_url: null,
          } as ProjectRow,
        ],
        getGlobalSecrets: () => [],
        getProject: () => null,
        getDeployLogs: () => [],
        getEnvVars: () => ({}),
        getTopDeploymentPatterns,
      };
      await buildContextSnapshot(mockDb as any, undefined, undefined);
      expect(getTopDeploymentPatterns).not.toHaveBeenCalled();
    });

    it('injects recipe summary in global scope', async () => {
      const mockDb = {
        listProjects: () => [
          {
            id: 'proj1',
            name: 'test-project',
            status: 'running',
            assigned_port: 10001,
            public_url: null,
          } as ProjectRow,
        ],
        getGlobalSecrets: () => [],
        getProject: () => null,
        getDeployLogs: () => [],
        getEnvVars: () => ({}),
        getTopDeploymentPatterns: vi.fn().mockReturnValue([]),
      };
      const result = await buildContextSnapshot(mockDb as any);
      expect(result).toContain('Known fix categories');
    });

    it('enforces 800 char limit on pattern section', async () => {
      const longPatterns = Array.from({ length: 10 }, (_, i) => ({
        id: `p${i}`,
        project_id: 'proj1',
        pattern_type: 'build',
        error_signature: `Error ${'x'.repeat(100)} ${i}`,
        fix_action: JSON.stringify({ recipe: `fix ${'y'.repeat(100)} ${i}` }),
        success_count: i,
        failure_count: 1,
        last_seen_at: '2026-01-01',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      })) as unknown as import('../../src/db/schema.drizzle.js').DeploymentPatternRow[];
      const mockDb = {
        listProjects: () => [
          {
            id: 'proj1',
            name: 'test-project',
            status: 'running',
            assigned_port: 10001,
            public_url: null,
          } as ProjectRow,
        ],
        getGlobalSecrets: () => [],
        getProject: (id: string) => {
          if (id === 'proj1') {
            return {
              id: 'proj1',
              name: 'test-project',
              status: 'running',
              assigned_port: 10001,
              public_url: null,
            } as ProjectRow;
          }
          return null;
        },
        getDeployLogs: () => [],
        getEnvVars: () => ({}),
        getTopDeploymentPatterns: vi.fn().mockReturnValue(longPatterns),
      };
      const result = await buildContextSnapshot(mockDb as any, undefined, {
        type: 'project',
        projectId: 'proj1',
      });
      const patternSection =
        result.split('\n\n').find((s) => s.includes('## Known Deployment Patterns')) ?? '';
      expect(patternSection.length).toBeLessThanOrEqual(820);
    });
  });
});
