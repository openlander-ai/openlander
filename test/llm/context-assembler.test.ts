import { describe, it, expect, beforeEach } from 'vitest';
import { buildContextSnapshot, buildIncidentBriefing } from '../../src/llm/context-assembler.js';
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
});
