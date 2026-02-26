import { describe, it, expect } from 'vitest';
import {
  getAllCommands,
  findCommand,
  filterCommands,
  parseSlashCommand,
  isSlashPrefix,
  getProjectCompletions,
  type SlashCommand,
} from '../src/tui/commands/registry.js';

// Total number of commands in the registry (counted from source)
const TOTAL_COMMAND_COUNT = 27;

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

    expect(findCommand('deploy')).toBeDefined();
    expect(findCommand('deploy')?.name).toBe('deploy');

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
    expect(findCommand('DEPLOY')).toBeUndefined();
    expect(findCommand('Deploy')).toBeUndefined();
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
    const names = filtered.map((c) => c.name);
    // Commands starting with 's': stop, start, status, system, ssh
    expect(names).toContain('stop');
    expect(names).toContain('start');
    expect(names).toContain('status');
    expect(names).toContain('system');
    expect(names).toContain('ssh');
    expect(filtered.length).toBe(5);
  });

  it('filters commands starting with "de"', () => {
    const filtered = filterCommands('de');
    const names = filtered.map((c) => c.name);
    expect(names).toContain('deploy');
    expect(filtered.length).toBe(1);
  });

  it('filters commands starting with "st"', () => {
    const filtered = filterCommands('st');
    const names = filtered.map((c) => c.name);
    expect(names).toContain('stop');
    expect(names).toContain('start');
    expect(names).toContain('status');
    expect(filtered.length).toBe(3);
  });

  it('is case insensitive (lowercases prefix)', () => {
    const upper = filterCommands('DE');
    const lower = filterCommands('de');
    expect(upper.length).toBe(lower.length);
    expect(upper.map((c) => c.name)).toEqual(lower.map((c) => c.name));

    const mixed = filterCommands('De');
    expect(mixed.length).toBe(1);
    expect(mixed[0].name).toBe('deploy');
  });

  it('no matches returns empty array', () => {
    expect(filterCommands('zzz')).toEqual([]);
    expect(filterCommands('xyz')).toEqual([]);
    expect(filterCommands('notfound')).toEqual([]);
  });

  it('returns commands in insertion order (not alphabetical)', () => {
    const filtered = filterCommands('st');
    const names = filtered.map((c) => c.name);
    // In insertion order: stop (line 54), start (line 61), status (line 82)
    expect(names).toEqual(['stop', 'start', 'status']);
  });
});

describe('parseSlashCommand', () => {
  it('returns null for non-slash input', () => {
    expect(parseSlashCommand('hello')).toBeNull();
    expect(parseSlashCommand('')).toBeNull();
    expect(parseSlashCommand('deploy')).toBeNull();
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
    const result = parseSlashCommand('/deploy my-repo');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('deploy');
    expect(result!.args).toBe('my-repo');
    expect(result!.positional).toEqual(['my-repo']);
    expect(result!.flags).toEqual({});
  });

  it('parses command with long flag and value', () => {
    const result = parseSlashCommand('/deploy my-repo --name myapp');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('deploy');
    expect(result!.flags).toEqual({ name: 'myapp' });
    expect(result!.positional).toEqual(['my-repo']);
    expect(result!.args).toBe('my-repo --name myapp');
  });

  it('parses command with boolean flag', () => {
    const result = parseSlashCommand('/deploy my-repo --force');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('deploy');
    expect(result!.flags).toEqual({ force: true });
    expect(result!.positional).toEqual(['my-repo']);
  });

  it('parses command with short flag', () => {
    const result = parseSlashCommand('/logs my-project -n 50');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('logs');
    expect(result!.flags).toEqual({ n: '50' });
    expect(result!.positional).toEqual(['my-project']);
  });

  it('parses short flag without value (boolean)', () => {
    const result = parseSlashCommand('/deploy my-repo -f');
    expect(result).not.toBeNull();
    expect(result!.flags).toEqual({ f: true });
  });

  it('parses command with quoted args', () => {
    const result = parseSlashCommand('/deploy "my repo with spaces"');
    expect(result).not.toBeNull();
    expect(result!.positional).toEqual(['my repo with spaces']);
    expect(result!.args).toBe('my repo with spaces');
  });

  it('parses command with single quoted args', () => {
    const result = parseSlashCommand("/deploy 'my repo with spaces'");
    expect(result).not.toBeNull();
    expect(result!.positional).toEqual(['my repo with spaces']);
  });

  it('parses mixed args with flags', () => {
    const result = parseSlashCommand('/env my-project --remove KEY --redeploy');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('env');
    expect(result!.flags).toEqual({ remove: 'KEY', redeploy: true });
    expect(result!.positional).toEqual(['my-project']);
  });

  it('treats -- alone as positional (edge case)', () => {
    const result = parseSlashCommand('/deploy my-repo --');
    expect(result).not.toBeNull();
    expect(result!.positional).toContain('my-repo');
    expect(result!.positional).toContain('--');
  });

  it('parses multiple positional args', () => {
    const result = parseSlashCommand('/domain my-project example.com');
    expect(result).not.toBeNull();
    expect(result!.command.name).toBe('domain');
    expect(result!.positional).toEqual(['my-project', 'example.com']);
    expect(result!.args).toBe('my-project example.com');
  });

  it('handles flags at the beginning', () => {
    const result = parseSlashCommand('/deploy --name myapp repo-url');
    expect(result).not.toBeNull();
    expect(result!.flags).toEqual({ name: 'myapp' });
    expect(result!.positional).toEqual(['repo-url']);
  });

  it('handles multiple flags', () => {
    const result = parseSlashCommand('/deploy repo --name app --env prod --force');
    expect(result).not.toBeNull();
    expect(result!.flags).toEqual({ name: 'app', env: 'prod', force: true });
  });

  it('short flag followed by another short flag', () => {
    const result = parseSlashCommand('/deploy -f -v');
    expect(result).not.toBeNull();
    expect(result!.flags).toEqual({ f: true, v: true });
  });

  it('handles value starting with dash after flag', () => {
    const result = parseSlashCommand('/deploy --name -myapp');
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
    expect(isSlashPrefix('/deploy')).toBe(true);
  });

  it('returns false when input has space', () => {
    expect(isSlashPrefix('/help arg')).toBe(false);
    expect(isSlashPrefix('/deploy repo')).toBe(false);
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

  describe('/deploy', () => {
    it('with repo-url returns agent message', () => {
      const handler = getHandler('deploy');
      const result = handler('my-repo') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Deploy my-repo');
    });

    it('with no args returns "Deploy" (trimmed)', () => {
      const handler = getHandler('deploy');
      const result = handler('') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Deploy');
    });

    it('with multiple args preserves them', () => {
      const handler = getHandler('deploy');
      const result = handler('my-repo --name myapp') as { action: string; message: string };
      expect(result.message).toBe('Deploy my-repo --name myapp');
    });
  });

  describe('/logs', () => {
    it('with project returns agent message with project', () => {
      const handler = getHandler('logs');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Show logs for my-project');
    });

    it('with no args shows most recent project message', () => {
      const handler = getHandler('logs');
      const result = handler('') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Show logs for the most recent project');
    });
  });

  describe('/stop', () => {
    it('with project returns agent message', () => {
      const handler = getHandler('stop');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Stop my-project');
    });

    it('with no args returns "Stop" (trimmed)', () => {
      const handler = getHandler('stop');
      const result = handler('') as { action: string; message: string };
      expect(result.message).toBe('Stop');
    });
  });

  describe('/start', () => {
    it('with project returns agent message', () => {
      const handler = getHandler('start');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Start my-project');
    });

    it('with no args returns "Start" (trimmed)', () => {
      const handler = getHandler('start');
      const result = handler('') as { action: string; message: string };
      expect(result.message).toBe('Start');
    });
  });

  describe('/restart', () => {
    it('with project returns agent message', () => {
      const handler = getHandler('restart');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Restart my-project');
    });

    it('with no args returns "Restart" (trimmed)', () => {
      const handler = getHandler('restart');
      const result = handler('') as { action: string; message: string };
      expect(result.message).toBe('Restart');
    });
  });

  describe('/remove', () => {
    it('with project returns agent message', () => {
      const handler = getHandler('remove');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Remove my-project');
    });

    it('with no args returns "Remove" (trimmed)', () => {
      const handler = getHandler('remove');
      const result = handler('') as { action: string; message: string };
      expect(result.message).toBe('Remove');
    });
  });

  describe('/status', () => {
    it('with no args shows system status', () => {
      const handler = getHandler('status');
      const result = handler('') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Show system status');
    });

    it('with project shows status for that project', () => {
      const handler = getHandler('status');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Show status for my-project');
    });
  });

  describe('/projects', () => {
    it('returns toggle-sidebar action', () => {
      const handler = getHandler('projects');
      const result = handler('') as { action: string };
      expect(result.action).toBe('toggle-sidebar');
    });
  });

  describe('/redeploy', () => {
    it('with project returns agent message', () => {
      const handler = getHandler('redeploy');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Redeploy my-project');
    });

    it('with no args returns "Redeploy" (trimmed)', () => {
      const handler = getHandler('redeploy');
      const result = handler('') as { action: string; message: string };
      expect(result.message).toBe('Redeploy');
    });
  });

  describe('/public', () => {
    it('with project returns message with project and public', () => {
      const handler = getHandler('public');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('my-project');
      expect(result.message).toContain('public');
    });

    it('trims the message', () => {
      const handler = getHandler('public');
      const result = handler('') as { action: string; message: string };
      expect(result.message).toBe('Make  public'); // Note: double space trimmed by .trim() at end
    });
  });

  describe('/expose', () => {
    it('with project returns message containing TryCloudflare', () => {
      const handler = getHandler('expose');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('my-project');
      expect(result.message).toContain('TryCloudflare');
    });
  });

  describe('/unexpose', () => {
    it('with project returns message containing Unexpose', () => {
      const handler = getHandler('unexpose');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('Unexpose');
      expect(result.message).toContain('my-project');
    });
  });

  describe('/domain', () => {
    it('with project and domain returns domain info', () => {
      const handler = getHandler('domain');
      const result = handler('my-project example.com') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('domain');
      expect(result.message).toContain('my-project');
      expect(result.message).toContain('example.com');
    });
  });

  describe('/domains', () => {
    it('returns message about listing domain mappings', () => {
      const handler = getHandler('domains');
      const result = handler('') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('List all domain mappings');
    });
  });

  describe('/env', () => {
    it('with project returns message about environment variables', () => {
      const handler = getHandler('env');
      const result = handler('my-project') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('environment variables');
      expect(result.message).toContain('my-project');
    });
  });

  describe('/system', () => {
    it('returns message about system resource info', () => {
      const handler = getHandler('system');
      const result = handler('') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Show detailed system resource info');
    });
  });

  describe('/cleanup', () => {
    it('returns message containing cleanup', () => {
      const handler = getHandler('cleanup');
      const result = handler('') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('cleanup');
    });
  });

  describe('/config', () => {
    it('with no args shows current configuration', () => {
      const handler = getHandler('config');
      const result = handler('') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Show current configuration');
    });

    it('with args shows modify config message', () => {
      const handler = getHandler('config');
      const result = handler('some-setting') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('Modify config');
      expect(result.message).toContain('some-setting');
    });
  });

  describe('/git', () => {
    it('with no args shows Git authentication status', () => {
      const handler = getHandler('git');
      const result = handler('') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Show Git authentication status and configured providers');
    });

    it('with ssh-keygen returns Generate message', () => {
      const handler = getHandler('git');
      const result = handler('ssh-keygen') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('Generate');
      expect(result.message).toContain('SSH key');
    });

    it('with ssh-keygen and options preserves options', () => {
      const handler = getHandler('git');
      const result = handler('ssh-keygen --email test@example.com') as {
        action: string;
        message: string;
      };
      expect(result.message).toContain('test@example.com');
      expect(result.message).not.toContain('ssh-keygen'); // stripped prefix
    });

    it('with ssh-add returns Add message', () => {
      const handler = getHandler('git');
      const result = handler('ssh-add') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('Add SSH key');
    });

    it('with provider returns Configure message', () => {
      const handler = getHandler('git');
      const result = handler('provider') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('Configure Git provider');
    });

    it('with other args returns Git operation message', () => {
      const handler = getHandler('git');
      const result = handler('some-other-thing') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Git operation: some-other-thing');
    });

    it('is case insensitive for subcommands', () => {
      const handler = getHandler('git');
      const result = handler('SSH-KEYGEN') as { action: string; message: string };
      expect(result.message).toContain('Generate');
    });
  });

  describe('/ssh', () => {
    it('with no args shows SSH key status', () => {
      const handler = getHandler('ssh');
      const result = handler('') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('Show SSH key status');
    });

    it('with keygen returns Generate message', () => {
      const handler = getHandler('ssh');
      const result = handler('keygen') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('Generate');
    });

    it('with generate returns same as keygen', () => {
      const handler = getHandler('ssh');
      const result = handler('generate') as { action: string; message: string };
      expect(result.message).toContain('Generate');
    });

    it('with add returns Add SSH key message', () => {
      const handler = getHandler('ssh');
      const result = handler('add') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('Add SSH key');
    });

    it('with list returns List message', () => {
      const handler = getHandler('ssh');
      const result = handler('list') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toContain('List');
    });

    it('with ls returns same as list', () => {
      const handler = getHandler('ssh');
      const result = handler('ls') as { action: string; message: string };
      expect(result.message).toContain('List');
    });

    it('with other args returns SSH operation message', () => {
      const handler = getHandler('ssh');
      const result = handler('other') as { action: string; message: string };
      expect(result.action).toBe('agent');
      expect(result.message).toBe('SSH operation: other');
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
