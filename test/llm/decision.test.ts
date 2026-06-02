import { describe, expect, it } from 'vitest';
import { DecisionEngine } from '../../src/llm/decision.js';

describe('DecisionEngine', () => {
  const engine = new DecisionEngine();

  it('low riskLevel → ALLOW', () => {
    expect(engine.classify('any_tool', 'low')).toBe('ALLOW');
  });

  it('medium riskLevel → NOTIFY_THEN_ALLOW', () => {
    expect(engine.classify('any_tool', 'medium')).toBe('NOTIFY_THEN_ALLOW');
  });

  it('high riskLevel → REQUIRE_APPROVAL', () => {
    expect(engine.classify('any_tool', 'high')).toBe('REQUIRE_APPROVAL');
  });

  it('rollback_service → REQUIRE_APPROVAL', () => {
    expect(engine.classify('rollback_service')).toBe('REQUIRE_APPROVAL');
  });

  it('rollback_service → REQUIRE_APPROVAL', () => {
    expect(engine.classify('rollback_service')).toBe('REQUIRE_APPROVAL');
  });

  it('archive_service → REQUIRE_APPROVAL', () => {
    expect(engine.classify('archive_service')).toBe('REQUIRE_APPROVAL');
  });

  it('archive_project on running production → REQUIRE_APPROVAL', () => {
    expect(
      engine.classify('archive_project', undefined, {
        archive: { productionRunning: true },
      }),
    ).toBe('REQUIRE_APPROVAL');
  });

  it('archive_project on stopped or non-production target → NOTIFY_THEN_ALLOW', () => {
    expect(
      engine.classify('archive_project', undefined, {
        archive: { productionRunning: false },
      }),
    ).toBe('NOTIFY_THEN_ALLOW');
  });

  it('archive_service on running target → REQUIRE_APPROVAL', () => {
    expect(
      engine.classify('archive_service', undefined, {
        archive: { productionRunning: true },
      }),
    ).toBe('REQUIRE_APPROVAL');
  });

  it('archive_service on stopped target → NOTIFY_THEN_ALLOW', () => {
    expect(
      engine.classify('archive_service', undefined, {
        archive: { productionRunning: false },
      }),
    ).toBe('NOTIFY_THEN_ALLOW');
  });

  it('archive_service without context → REQUIRE_APPROVAL (static default)', () => {
    expect(engine.classify('archive_service')).toBe('REQUIRE_APPROVAL');
  });

  it('remove_service → REQUIRE_APPROVAL', () => {
    expect(engine.classify('remove_service')).toBe('REQUIRE_APPROVAL');
  });

  it('create_database → REQUIRE_APPROVAL', () => {
    expect(engine.classify('create_database')).toBe('REQUIRE_APPROVAL');
  });

  it('get_logs → ALLOW', () => {
    expect(engine.classify('get_logs')).toBe('ALLOW');
  });

  it('list_projects → ALLOW', () => {
    expect(engine.classify('list_projects')).toBe('ALLOW');
  });

  it('get_deploy_status → ALLOW', () => {
    expect(engine.classify('get_deploy_status')).toBe('ALLOW');
  });

  it('get_server_stats → ALLOW', () => {
    expect(engine.classify('get_server_stats')).toBe('ALLOW');
  });

  it('unknown_tool → NOTIFY_THEN_ALLOW', () => {
    expect(engine.classify('unknown_tool')).toBe('NOTIFY_THEN_ALLOW');
  });
});
