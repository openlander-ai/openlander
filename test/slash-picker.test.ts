import { describe, it, expect } from 'vitest';
import { getMatchCount, getMatchAt } from '../src/tui/components/SlashCommandPicker.js';
import { getAllCommands } from '../src/tui/commands/registry.js';

// Total number of commands in the registry
const TOTAL_COMMAND_COUNT = getAllCommands().length;

describe('getMatchCount', () => {
  it('returns total command count for "/" (empty prefix matches all)', () => {
    // '/' -> slice(1) = '' -> split(' ')[0] = '' -> filterCommands('') = all
    expect(getMatchCount('/')).toBe(TOTAL_COMMAND_COUNT);
  });

  it('returns correct count for "/h" prefix (help)', () => {
    // Only 'help' starts with 'h'
    expect(getMatchCount('/h')).toBe(1);
  });

  it('returns correct count for "/st" prefix (stop, start, status)', () => {
    // 'stop', 'start', 'status' start with 'st'
    expect(getMatchCount('/st')).toBe(3);
  });

  it('returns 0 for "/zzz" (no matches)', () => {
    expect(getMatchCount('/zzz')).toBe(0);
  });

  it('returns correct count for "/de" (deploy)', () => {
    expect(getMatchCount('/de')).toBe(1);
  });

  it('returns correct count for "/s" prefix (stop, start, status, system, ssh)', () => {
    expect(getMatchCount('/s')).toBe(5);
  });

  it('returns correct count for "/do" (domain, domains)', () => {
    expect(getMatchCount('/do')).toBe(2);
  });

  it('returns correct count for "/re" (remove, redeploy, restart)', () => {
    expect(getMatchCount('/re')).toBe(3);
  });

  it('handles input with space by extracting prefix before space', () => {
    // '/help arg' -> slice(1) = 'help arg' -> split(' ')[0] = 'help'
    expect(getMatchCount('/help arg')).toBe(1);
  });

  it('is case insensitive', () => {
    // filterCommands lowercases the prefix
    expect(getMatchCount('/H')).toBe(1); // matches 'help'
    expect(getMatchCount('/DE')).toBe(1); // matches 'deploy'
    expect(getMatchCount('/ST')).toBe(3); // matches stop, start, status
  });
});

describe('getMatchAt', () => {
  it('returns first command name for "/" at index 0', () => {
    // Commands are in insertion order from registry.ts
    // First command is 'help'
    const result = getMatchAt('/', 0);
    expect(result).toBe('help');
  });

  it('returns correct command for "/h" at index 0', () => {
    expect(getMatchAt('/h', 0)).toBe('help');
  });

  it('returns correct commands for "/st" prefix', () => {
    // In insertion order: stop, start, status
    expect(getMatchAt('/st', 0)).toBe('stop');
    expect(getMatchAt('/st', 1)).toBe('start');
    expect(getMatchAt('/st', 2)).toBe('status');
  });

  it('returns null for out of bounds index', () => {
    expect(getMatchAt('/', 999)).toBeNull();
    expect(getMatchAt('/', -1)).toBeNull();
    expect(getMatchAt('/h', 10)).toBeNull();
  });

  it('returns null for no matches', () => {
    expect(getMatchAt('/zzz', 0)).toBeNull();
    expect(getMatchAt('/xyz', 0)).toBeNull();
  });

  it('returns null for valid prefix but out of bounds', () => {
    // '/de' only has 'deploy' at index 0
    expect(getMatchAt('/de', 0)).toBe('deploy');
    expect(getMatchAt('/de', 1)).toBeNull();
  });

  it('returns correct commands for "/s" prefix', () => {
    // In insertion order: stop, start, status, system, ssh
    expect(getMatchAt('/s', 0)).toBe('stop');
    expect(getMatchAt('/s', 1)).toBe('start');
    expect(getMatchAt('/s', 2)).toBe('status');
    expect(getMatchAt('/s', 3)).toBe('system');
    expect(getMatchAt('/s', 4)).toBe('ssh');
    expect(getMatchAt('/s', 5)).toBeNull();
  });

  it('returns correct commands for "/do" prefix', () => {
    // 'domain' comes before 'domains' in insertion order
    expect(getMatchAt('/do', 0)).toBe('domain');
    expect(getMatchAt('/do', 1)).toBe('domains');
    expect(getMatchAt('/do', 2)).toBeNull();
  });

  it('handles input with space by extracting prefix before space', () => {
    // '/stop arg' should still match 'stop'
    expect(getMatchAt('/stop arg', 0)).toBe('stop');
  });

  it('is case insensitive', () => {
    expect(getMatchAt('/H', 0)).toBe('help');
    expect(getMatchAt('/ST', 0)).toBe('stop');
    expect(getMatchAt('/ST', 1)).toBe('start');
  });

  it('can iterate through all commands with "/"', () => {
    const commands = getAllCommands();
    for (let i = 0; i < commands.length; i++) {
      const name = getMatchAt('/', i);
      expect(name).toBe(commands[i].name);
    }
    // One past the end should be null
    expect(getMatchAt('/', commands.length)).toBeNull();
  });
});
