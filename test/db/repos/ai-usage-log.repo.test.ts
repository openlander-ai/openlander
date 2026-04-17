import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { createDrizzleDatabase } from '../../../src/db/drizzle.js';
import { AiUsageLogRepo } from '../../../src/db/repos/ai-usage-log.repo.js';
import type { AiUsageLogRow } from '../../../src/db/types.js';

describe('AiUsageLogRepo', () => {
  let repo: AiUsageLogRepo;
  let sqlite: ReturnType<typeof createDrizzleDatabase>['sqlite'];

  beforeEach(() => {
    const db = createDrizzleDatabase(':memory:');
    sqlite = db.sqlite;
    repo = new AiUsageLogRepo(db.db, db.sqlite);
    migrate(db.db as Parameters<typeof migrate>[0], { migrationsFolder: './drizzle' });
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('create', () => {
    it('creates a new AI usage log entry with generated UUID and timestamp', () => {
      const data: Omit<AiUsageLogRow, 'id' | 'created_at'> = {
        project_id: 'proj-1',
        session_id: 'sess-1',
        action_type: 'web_agent',
        model_name: 'gpt-4',
        provider: 'openai',
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_usd: 0.003,
        tools_called: '["tool1", "tool2"]',
        result: 'success',
        error_message: null,
        error_type: null,
        duration_ms: 1000,
        user_id: 'user-1',
        tenant_id: 'tenant-1',
        source: 'web',
      };

      const id = repo.create(data);

      expect(id).toBeTruthy();
      expect(id).toMatch(/^[0-9a-f-]{36}$/);

      const logs = repo.findByProjectId('proj-1');
      expect(logs).toHaveLength(1);
      expect(logs[0].id).toBe(id);
      expect(logs[0].action_type).toBe('web_agent');
      expect(logs[0].model_name).toBe('gpt-4');
      expect(logs[0].input_tokens).toBe(100);
      expect(logs[0].created_at).toBeTruthy();
    });

    it('handles nullable fields correctly', () => {
      const data: Omit<AiUsageLogRow, 'id' | 'created_at'> = {
        project_id: 'proj-nullable',
        session_id: null,
        action_type: 'auto_recovery',
        model_name: 'claude-3',
        provider: 'anthropic',
        input_tokens: 200,
        output_tokens: 100,
        total_tokens: 300,
        cost_usd: null,
        tools_called: '[]',
        result: 'failure',
        error_message: null,
        error_type: null,
        duration_ms: 2000,
        user_id: null,
        tenant_id: null,
        source: null,
      };

      const id = repo.create(data);
      const logs = repo.findByProjectId('proj-nullable');

      expect(logs).toHaveLength(1);
      expect(logs[0].cost_usd).toBeNull();
      expect(logs[0].user_id).toBeNull();
      expect(logs[0].session_id).toBeNull();
      expect(logs[0].source).toBeNull();
    });
  });

  describe('findByProjectId', () => {
    it('returns all logs for a project ordered by created_at descending', () => {
      const projectId = 'proj-1';

      repo.create({
        project_id: projectId,
        session_id: null,
        action_type: 'web_agent',
        model_name: 'gpt-4',
        provider: 'openai',
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_usd: 0.003,
        tools_called: '[]',
        result: 'success',
        error_message: null,
        error_type: null,
        duration_ms: 1000,
        user_id: null,
        tenant_id: null,
        source: 'web',
      });

      repo.create({
        project_id: projectId,
        session_id: null,
        action_type: 'auto_recovery',
        model_name: 'claude-3',
        provider: 'anthropic',
        input_tokens: 200,
        output_tokens: 100,
        total_tokens: 300,
        cost_usd: 0.005,
        tools_called: '[]',
        result: 'success',
        error_message: null,
        error_type: null,
        duration_ms: 2000,
        user_id: null,
        tenant_id: null,
        source: 'mcp',
      });

      const logs = repo.findByProjectId(projectId);

      expect(logs).toHaveLength(2);
      expect(logs.map((l) => l.action_type)).toContain('web_agent');
      expect(logs.map((l) => l.action_type)).toContain('auto_recovery');
    });

    it('returns empty array for non-existent project', () => {
      const logs = repo.findByProjectId('non-existent');
      expect(logs).toHaveLength(0);
    });
  });

  describe('findByDateRange', () => {
    it('returns logs within the specified date range', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      repo.create({
        project_id: 'proj-1',
        session_id: null,
        action_type: 'web_agent',
        model_name: 'gpt-4',
        provider: 'openai',
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_usd: 0.003,
        tools_called: '[]',
        result: 'success',
        error_message: null,
        error_type: null,
        duration_ms: 1000,
        user_id: null,
        tenant_id: null,
        source: 'web',
      });

      const logs = repo.findByDateRange(yesterday, tomorrow);

      expect(logs).toHaveLength(1);
      expect(logs[0].action_type).toBe('web_agent');
    });

    it('returns empty array when no logs in date range', () => {
      const past = new Date('2020-01-01');
      const pastEnd = new Date('2020-01-02');

      repo.create({
        project_id: 'proj-1',
        session_id: null,
        action_type: 'web_agent',
        model_name: 'gpt-4',
        provider: 'openai',
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_usd: 0.003,
        tools_called: '[]',
        result: 'success',
        error_message: null,
        error_type: null,
        duration_ms: 1000,
        user_id: null,
        tenant_id: null,
        source: 'web',
      });

      const logs = repo.findByDateRange(past, pastEnd);

      expect(logs).toHaveLength(0);
    });
  });

  describe('getTokenSummary', () => {
    it('returns token summary for a specific project', () => {
      const projectId = 'proj-1';

      repo.create({
        project_id: projectId,
        session_id: null,
        action_type: 'web_agent',
        model_name: 'gpt-4',
        provider: 'openai',
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_usd: 0.003,
        tools_called: '[]',
        result: 'success',
        error_message: null,
        error_type: null,
        duration_ms: 1000,
        user_id: null,
        tenant_id: null,
        source: 'web',
      });

      repo.create({
        project_id: projectId,
        session_id: null,
        action_type: 'auto_recovery',
        model_name: 'claude-3',
        provider: 'anthropic',
        input_tokens: 200,
        output_tokens: 100,
        total_tokens: 300,
        cost_usd: 0.005,
        tools_called: '[]',
        result: 'success',
        error_message: null,
        error_type: null,
        duration_ms: 2000,
        user_id: null,
        tenant_id: null,
        source: 'mcp',
      });

      const summary = repo.getTokenSummary(projectId);

      expect(summary.totalInputTokens).toBe(300);
      expect(summary.totalOutputTokens).toBe(150);
      expect(summary.totalCostUsd).toBeCloseTo(0.008, 5);
    });

    it('returns global token summary when no projectId provided', () => {
      repo.create({
        project_id: 'proj-1',
        session_id: null,
        action_type: 'web_agent',
        model_name: 'gpt-4',
        provider: 'openai',
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_usd: 0.003,
        tools_called: '[]',
        result: 'success',
        error_message: null,
        error_type: null,
        duration_ms: 1000,
        user_id: null,
        tenant_id: null,
        source: 'web',
      });

      repo.create({
        project_id: 'proj-2',
        session_id: null,
        action_type: 'auto_recovery',
        model_name: 'claude-3',
        provider: 'anthropic',
        input_tokens: 200,
        output_tokens: 100,
        total_tokens: 300,
        cost_usd: 0.005,
        tools_called: '[]',
        result: 'success',
        error_message: null,
        error_type: null,
        duration_ms: 2000,
        user_id: null,
        tenant_id: null,
        source: 'mcp',
      });

      const summary = repo.getTokenSummary();

      expect(summary.totalInputTokens).toBe(300);
      expect(summary.totalOutputTokens).toBe(150);
      expect(summary.totalCostUsd).toBeCloseTo(0.008, 5);
    });

    it('returns zero summary when no logs exist', () => {
      const summary = repo.getTokenSummary('proj-1');

      expect(summary.totalInputTokens).toBe(0);
      expect(summary.totalOutputTokens).toBe(0);
      expect(summary.totalCostUsd).toBeNull();
    });

    it('handles null cost_usd values in summary', () => {
      repo.create({
        project_id: 'proj-1',
        session_id: null,
        action_type: 'web_agent',
        model_name: 'unknown-model',
        provider: 'unknown',
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        cost_usd: null,
        tools_called: '[]',
        result: 'success',
        error_message: null,
        error_type: null,
        duration_ms: 1000,
        user_id: null,
        tenant_id: null,
        source: 'web',
      });

      const summary = repo.getTokenSummary('proj-1');

      expect(summary.totalInputTokens).toBe(100);
      expect(summary.totalOutputTokens).toBe(50);
      expect(summary.totalCostUsd).toBeNull();
    });
  });
});
