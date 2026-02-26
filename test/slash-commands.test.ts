import { describe, it, expect } from 'vitest';
import {
  getAllCommands,
  findCommand,
  filterCommands,
  parseSlashCommand,
  isSlashPrefix,
  getProjectCompletions,
} from '../src/tui/commands/registry.js';

// Total number of commands in the registry (counted from source)
const TOTAL_COMMAND_COUNT = 8;

describe('getAllCommands', () => {
  it('returns an array of all commands', () => {
    const commands = getAllCommands();
    expect(Array.isArray(commands)).toBe(true);
    expect(commands.length).toBe(TOTAL_COMMAND_COUNT);
  });

  it('each command has name, description, and handler', () => {
    const commands = getAllCommands();
    for (const cmd of commands) {
      expect(cmd).toHaveProperty('name');
      expect(cmd).toHaveProperty('description');
      expect(cmd).toHaveProperty('handler');
      expect(typeof cmd.name).toBe('string');
      expect(typeof cmd.description).toBe('string');
      expect(typeof cmd.handler).toBe('function');
    }
  });

  it('returns a copy of the commands array (not mutated)', () => {
    const commands1 = getAllCommands();
    const commands2 = getAllCommands();
    expect(commands1).not.toBe(commands2); // Different array references
    expect(commands1.length).toBe(commands2.length);
  });
});

describe('findCommand', () => {
  it('finds existing commands by exact name', () => {
    expect(findCommand('help')).toBeDefined();
    expect(findCommand('help')?.name).toBe('help');

    expect(findCommand('model')).toBeDefined();
    expect(findCommand('model')?.name).toBe('model');

    expect(findCommand('compact')).toBeDefined();
    expect(findCommand('compact')?.name).toBe('compact');

    expect(findCommand('connect')).toBeDefined();
    expect(findCommand('connect')?.name).toBe('connect');

    expect(findCommand('repo')).toBeDefined();
    expect(findCommand('repo')?.name).toBe('repo');

    expect(findCommand('projects')).toBeDefined();
    expect(findCommand('projects')?.name).toBe('projects');
    expect(findCommand('clear')).toBeDefined();
    expect(findCommand('clear')?.name).toBe('clear');

    expect(findCommand('exit')).toBeDefined();
    expect(findCommand('exit')?.name).toBe('exit');
  });

  it('returns undefined for non-existent commands', () => {
    expect(findCommand('nonexistent')).toBeUndefined();
    expect(findCommand('foobar')).toBeUndefined();
    expect(findCommand('cmd123')).toBeUndefined();
  });

  it('is case sensitive', () => {
    expect(findCommand('HELP')).toBeUndefined();
    expect(findCommand('Help')).toBeUndefined();
    expect(findCommand('MODEL')).toBeUndefined();
    expect(findCommand('Model')).toBeUndefined();
  });

  it('returns undefined for empty string', () => {
    expect(findCommand('')).toBeUndefined();
  });

  it('returns the exact command object from registry', () => {
    const helpCmd = findCommand('help');
    const allCommands = getAllCommands();
    const helpFromAll = allCommands.find((c) => c.name === 'help');
    expect(helpCmd).toBe(helpFromAll);
  });
});

describe('filterCommands', () => {
  it('empty prefix returns ALL commands', () => {
    const filtered = filterCommands('');
    expect(filtered.length).toBe(TOTAL_COMMAND_COUNT);
  });

  it('filters commands starting with "s"', () => {
    const filtered = filterCommands('s');
    expect(filtered).toEqual([]);
  });

  it('filters commands starting with "de"', () => {
    const filtered = filterCommands('de');
    expect(filtered).toEqual([]);
  });

  it('filters commands starting with "st"', () => {
    const filtered = filterCommands('st');
    expect(filtered).toEqual([]);
  });

  it('is case insensitive (lowercases prefix)', () => {
    const upper = filterCommands('RE');
    const lower = filterCommands('re');
    expect(upper.length).toBe(lower.length);
    expect(upper.map((c) => c.name)).toEqual(lower.map((c) => c.name));

    const mixed = filterCommands('Re');
    expect(mixed.length).toBe(1);
    expect(mixed[0].name).toBe('repo');
  });

  it('no matches returns empty array', () => {
    expect(filterCommands('zzz')).toEqual([]);
    expect(filterCommands('xyz')).toEqual([]);
    expect(filterCommands('notfound')).toEqual([]);
  });

  it('returns commands in insertion order (not alphabetical)', () => {
    const filtered = filterCommands('c');
    const names = filtered.map((c) => c.name);
    expect(names).toEqual(['compact', 'connect', 'clear']);
  });
});

describe('parseSlashCommand', () => {
  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand('help')).toBeNull();
    expect(parseSlashCommand('  /help')).toBeNull();
  });

  it('returns null for unknown commands', () => {
    expect(parseSlashCommand('/nonexistent')).toBeNull();
    expect(parseSlashCommand('/foo')).toBeNull();
    expect(parseSlashCommand('/HELP')).toBeNull(); // case sensitive
  });

  it('returns null for just slash alone', () => {
    // After tokenize('') returns [], tokens.length === 0 → null
    expect(parseSlashCommand('/')).toBeNull();
  });

  it('parses basic command without args', () => {
    const result = parseSlashCommand('/help');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('help');
    expect(result!.args).toBe('');
    expect(result!.flags).toEqual({});
    expect(result!.positional).toEqual([]);
  });

  it('parses command with positional args', () => {
    const result = parseSlashCommand('/connect my-repo');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('connect');
    expect(result!.args).toBe('my-repo');
    expect(result!.positional).toEqual(['my-repo']);
    expect(result!.flags).toEqual({});
  });

  it('parses command with long flag and value', () => {
    const result = parseSlashCommand('/connect my-repo --name myapp');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('connect');
    expect(result!.flags).toEqual({ name: 'myapp' });
    expect(result!.positional).toEqual(['my-repo']);
    expect(result!.args).toBe('my-repo --name myapp');
  });

  it('parses command with boolean flag', () => {
    const result = parseSlashCommand('/connect my-repo --force');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('connect');
    expect(result!.flags).toEqual({ force: true });
    expect(result!.positional).toEqual(['my-repo']);
  });

  it('parses command with short flag', () => {
    const result = parseSlashCommand('/model my-project -n 50');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('model');
    expect(result!.flags).toEqual({ n: '50' });
    expect(result!.positional).toEqual(['my-project']);
  });

  it('parses short flag without value (boolean)', () => {
    const result = parseSlashCommand('/clear -f');
    expect(result).not.toBeNull();
    expect(result!.flags).toEqual({ f: true });
  });

  it('parses command with quoted args', () => {
    const result = parseSlashCommand('/connect "my repo with spaces"');
    expect(result).not.toBeNull();
    expect(result!.positional).toEqual(['my repo with spaces']);
    expect(result!.args).toBe('my repo with spaces');
  });

  it('parses command with single quoted args', () => {
    const result = parseSlashCommand("/connect 'my repo with spaces'");
    expect(result).not.toBeNull();
    expect(result!.positional).toEqual(['my repo with spaces']);
  });

  it('parses mixed args with flags', () => {
    const result = parseSlashCommand('/repo my-project --remove KEY --redeploy');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('repo');
    expect(result!.flags).toEqual({ remove: 'KEY', redeploy: true });
    expect(result!.positional).toEqual(['my-project']);
  });

  it('treats -- alone as positional (edge case)', () => {
    const result = parseSlashCommand('/connect my-repo --');
    expect(result).not.toBeNull();
    expect(result!.positional).toContain('my-repo');
    expect(result!.positional).toContain('--');
  });

  it('parses multiple positional args', () => {
    const result = parseSlashCommand('/connect my-project example.com');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('connect');
    expect(result!.positional).toEqual(['my-project', 'example.com']);
    expect(result!.args).toBe('my-project example.com');
  });

  it('handles flags at the beginning', () => {
    const result = parseSlashCommand('/connect --name myapp repo-url');
    expect(result).not.toBeNull();
    expect(result!.flags).toEqual({ name: 'myapp' });
    expect(result!.positional).toEqual(['repo-url']);
  });

  it('handles multiple flags', () => {
    const result = parseSlashCommand('/connect repo --name app --env prod --force');
    expect(result).not.toBeNull();
    expect(result!.flags).toEqual({ name: 'app', env: 'prod', force: true });
  });

  it('short flag followed by another short flag', () => {
    const result = parseSlashCommand('/clear -f -v');
    expect(result).not.toBeNull();
    expect(result!.flags).toEqual({ f: true, v: true });
  });

  it('handles value starting with dash after flag', () => {
    const result = parseSlashCommand('/connect --name -myapp');
    // -myapp starts with -, so it won't be consumed as the flag value
    expect(result).not.toBeNull();
    expect(result!.flags).toEqual({ name: true }); // name is boolean, -myapp is separate
    expect(result!.positional).toContain('-myapp');
  });
});

describe('isSlashPrefix', () => {
  it('returns true for slash alone', () => {
    expect(isSlashPrefix('/')).toBe(true);
  });

  it('returns true for slash with single char', () => {
    expect(isSlashPrefix('/h')).toBe(true);
  });

  it('returns true for slash with full command', () => {
    expect(isSlashPrefix('/help')).toBe(true);
    expect(isSlashPrefix('/clear')).toBe(true);
  });

  it('returns false when input has space', () => {
    expect(isSlashPrefix('/help arg')).toBe(false);
    expect(isSlashPrefix('/clear now')).toBe(false);
    expect(isSlashPrefix('/ ')).toBe(false);
  });

  it('returns false for non-slash input', () => {
    expect(isSlashPrefix('help')).toBe(false);
    expect(isSlashPrefix('')).toBe(false);
    expect(isSlashPrefix(' /help')).toBe(false);
  });
});

describe('getProjectCompletions', () => {
  const projects = ['my-app', 'my-service', 'frontend', 'backend', 'My-App-Upper'];

  it('filters correctly by prefix', () => {
    const result = getProjectCompletions('my', projects);
    expect(result).toContain('my-app');
    expect(result).toContain('my-service');
    expect(result).toContain('My-App-Upper');
    expect(result.length).toBe(3);
  });

  it('is case insensitive', () => {
    const result = getProjectCompletions('MY', projects);
    expect(result.length).toBe(3);
    expect(result).toContain('my-app');
    expect(result).toContain('my-service');
    expect(result).toContain('My-App-Upper');
  });

  it('empty prefix returns all', () => {
    const result = getProjectCompletions('', projects);
    expect(result.length).toBe(projects.length);
  });

  it('no matches returns empty array', () => {
    expect(getProjectCompletions('xyz', projects)).toEqual([]);
    expect(getProjectCompletions('nonexistent', projects)).toEqual([]);
  });

  it('handles exact match', () => {
    const result = getProjectCompletions('frontend', projects);
    expect(result).toEqual(['frontend']);
  });

  it('handles empty projects array', () => {
    expect(getProjectCompletions('my', [])).toEqual([]);
  });
});

// =============================================================================
// COMMAND HANDLER TESTS - Test every command's handler directly
// =============================================================================

describe('Command Handlers', () => {
  const getHandler = (name: string): ((args: string) => unknown) => {
    const cmd = findCommand(name);
    if (!cmd) throw new Error(`Command ${name} not found`);
    return cmd.handler;
  };

  describe('/help', () => {
    it('returns modal action with help modal', () => {
      const handler = getHandler('help');
      const result = handler('') as { action: string; modal: string };
      expect(result.action).toBe('modal');
      expect(result.modal).toBe('help');
    });
  });

  describe('/model', () => {
    it('returns modal action with model modal', () => {
      const handler = getHandler('model');
      const result = handler('') as { action: string; modal: string };
      expect(result.action).toBe('modal');
      expect(result.modal).toBe('model');
    });
  });

  describe('/compact', () => {
    it('returns compact action', () => {
      const handler = getHandler('compact');
      const result = handler('') as { action: string };
      expect(result.action).toBe('compact');
    });
  });

  describe('/connect', () => {
    it('returns modal action with connect modal', () => {
      const handler = getHandler('connect');
      const result = handler('') as { action: string; modal: string };
      expect(result.action).toBe('modal');
      expect(result.modal).toBe('connect');
    });
  });

  describe('/repo', () => {
    it('returns modal action with repo modal', () => {
      const handler = getHandler('repo');
      const result = handler('') as { action: string; modal: string };
      expect(result.action).toBe('modal');
      expect(result.modal).toBe('repo');
    });
  });

  describe('/projects', () => {
    it('returns toggle-sidebar action', () => {
      const handler = getHandler('projects');
      const result = handler('') as { action: string };
      expect(result.action).toBe('toggle-sidebar');
    });
  });

  describe('/clear', () => {
    it('returns clear action', () => {
      const handler = getHandler('clear');
      const result = handler('') as { action: string };
      expect(result.action).toBe('clear');
    });
  });

  describe('/exit', () => {
    it('returns exit action', () => {
      const handler = getHandler('exit');
      const result = handler('') as { action: string };
      expect(result.action).toBe('exit');
    });
  });
});
