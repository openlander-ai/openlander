/**
 * Slash command registry for the OpenLander TUI.
 *
 * Commands follow the pattern: /name [args] [--flags]
 * Results are action descriptors consumed by the Dashboard.
 */

export interface SlashCommand {
  name: string;
  description: string;
  usage?: string;
  handler: (args: string) => SlashCommandResult;
}

export type SlashCommandResult =
  | { action: 'modal'; modal: 'help' | 'model' | 'git' | 'repo' | 'tunnel' | 'env' }
  | { action: 'clear' }
  | { action: 'exit' }
  | { action: 'compact' };

/** Parsed command with separated args, flags, and positional arguments. */
export interface ParsedCommand {
  command: SlashCommand;
  args: string;
  flags: Record<string, string | boolean>;
  positional: string[];
}

const commands: SlashCommand[] = [
  {
    name: 'help',
    description: 'Show available commands',
    handler: () => ({ action: 'modal', modal: 'help' }),
  },
  {
    name: 'model',
    description: 'Switch LLM model',
    handler: () => ({ action: 'modal', modal: 'model' }),
  },
  {
    name: 'git',
    description: 'Manage Git connections (GitHub, GitLab, etc.)',
    handler: () => ({ action: 'modal', modal: 'git' }),
  },
  {
    name: 'repo',
    description: 'Browse repositories and deploy',
    handler: () => ({ action: 'modal', modal: 'repo' }),
  },
  {
    name: 'tunnel',
    description: 'Configure Cloudflare Tunnel',
    handler: () => ({ action: 'modal', modal: 'tunnel' }),
  },
  {
    name: 'env',
    description: 'Manage environment variables',
    handler: () => ({ action: 'modal', modal: 'env' }),
  },
  {
    name: 'compact',
    description: 'Compact chat context (summarize and start fresh)',
    handler: () => ({ action: 'compact' }),
  },
  {
    name: 'clear',
    description: 'Clear chat history',
    handler: () => ({ action: 'clear' }),
  },
  {
    name: 'exit',
    description: 'Exit OpenLander',
    handler: () => ({ action: 'exit' }),
  },
];

/** Get all registered commands. */
export function getAllCommands(): SlashCommand[] {
  return [...commands];
}

/** Find an exact command match by name. */
export function findCommand(name: string): SlashCommand | undefined {
  return commands.find((c) => c.name === name);
}

/** Filter commands whose name starts with a prefix (for autocomplete). */
export function filterCommands(prefix: string): SlashCommand[] {
  const lower = prefix.toLowerCase();
  return commands.filter((c) => c.name.startsWith(lower));
}

/**
 * Parse a slash command string into command + args + flags.
 * Returns null if the input isn't a valid slash command.
 *
 * Supports flags in two formats:
 *   --flag         → { flag: true }
 *   --flag value   → { flag: 'value' }
 *   -n 50          → { n: '50' }
 *
 * Positional arguments are all non-flag args in order.
 */
export function parseSlashCommand(input: string): ParsedCommand | null {
  if (!input.startsWith('/')) return null;

  const trimmed = input.slice(1);
  const tokens = tokenize(trimmed);
  if (tokens.length === 0) return null;

  const name = tokens[0];
  if (!name) return null;
  const command = findCommand(name);
  if (!command) return null;

  // Parse remaining tokens into positional args and flags
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const rawArgs: string[] = [];

  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i];
    if (!token) continue;

    if (token.startsWith('--')) {
      // Long flag: --name or --name value
      const flagName = token.slice(2);
      if (!flagName) {
        // '--' alone, treat as positional
        positional.push(token);
        rawArgs.push(token);
        i++;
        continue;
      }

      const nextToken = tokens[i + 1];
      if (nextToken && !nextToken.startsWith('-')) {
        flags[flagName] = nextToken;
        rawArgs.push(token, nextToken);
        i += 2;
      } else {
        flags[flagName] = true;
        rawArgs.push(token);
        i += 1;
      }
    } else if (token.startsWith('-') && token.length === 2) {
      // Short flag: -n or -n value
      const flagName = token.slice(1);
      const nextToken = tokens[i + 1];
      if (nextToken && !nextToken.startsWith('-')) {
        flags[flagName] = nextToken;
        rawArgs.push(token, nextToken);
        i += 2;
      } else {
        flags[flagName] = true;
        rawArgs.push(token);
        i += 1;
      }
    } else {
      // Positional argument
      positional.push(token);
      rawArgs.push(token);
      i += 1;
    }
  }

  // Reconstruct the raw args string (everything after command name)
  const args = rawArgs.join(' ');

  return { command, args, flags, positional };
}

/**
 * Tokenize a string respecting quoted substrings.
 * "hello world" becomes a single token.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === quoteChar) {
        inQuotes = false;
        // Don't include closing quote in token
      } else {
        if (char) current += char;
      }
    } else if (char === '"' || char === "'") {
      inQuotes = true;
      quoteChar = char;
      // Don't include opening quote in token
    } else if (char === ' ' || char === '\t') {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      if (char) current += char;
    }
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

/** Check if input looks like a partial slash command (starts with /). */
export function isSlashPrefix(input: string): boolean {
  return input.startsWith('/') && !input.includes(' ');
}

/**
 * Get project name completions for autocomplete.
 * Filters projectNames that start with the given prefix (case-insensitive).
 */
export function getProjectCompletions(prefix: string, projectNames: string[]): string[] {
  const lowerPrefix = prefix.toLowerCase();
  return projectNames.filter((name) => name.toLowerCase().startsWith(lowerPrefix));
}
