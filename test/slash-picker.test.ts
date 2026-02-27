import { describe, it, expect } from 'vitest';
import { getMatchCount, getMatchAt } from '../src/tui/commands/match-utils.js';
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

  it('returns correct count for "/st" prefix (no matches)', () => {
    expect(getMatchCount('/st')).toBe(0);
  });

  it('returns 0 for "/zzz" (no matches)', () => {
    expect(getMatchCount('/zzz')).toBe(0);
  });

  it('returns correct count for "/de" (no matches)', () => {
    expect(getMatchCount('/de')).toBe(0);
  });

  it('returns correct count for "/s" prefix (no matches)', () => {
    expect(getMatchCount('/s')).toBe(0);
  });

  it('returns correct count for "/do" (no matches)', () => {
    expect(getMatchCount('/do')).toBe(0);
  });

  it('returns correct count for "/re" (repo)', () => {
    expect(getMatchCount('/re')).toBe(1);
  });

  it('handles input with space by extracting prefix before space', () => {
    // '/help arg' -> slice(1) = 'help arg' -> split(' ')[0] = 'help'
    expect(getMatchCount('/help arg')).toBe(1);
  });

  it('is case insensitive', () => {
    // filterCommands lowercases the prefix
    expect(getMatchCount('/H')).toBe(1); // matches 'help'
    expect(getMatchCount('/RE')).toBe(1);
    expect(getMatchCount('/ST')).toBe(0);
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

  it('returns null for "/st" prefix (no matches)', () => {
    expect(getMatchAt('/st', 0)).toBeNull();
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
    expect(getMatchAt('/re', 0)).toBe('repo');
    expect(getMatchAt('/re', 1)).toBeNull();
  });

  it('returns null for "/s" prefix', () => {
    expect(getMatchAt('/s', 0)).toBeNull();
  });

  it('returns null for "/do" prefix', () => {
    expect(getMatchAt('/do', 0)).toBeNull();
  });

  it('handles input with space by extracting prefix before space', () => {
    expect(getMatchAt('/help arg', 0)).toBe('help');
  });

  it('is case insensitive', () => {
    expect(getMatchAt('/H', 0)).toBe('help');
    expect(getMatchAt('/RE', 0)).toBe('repo');
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
