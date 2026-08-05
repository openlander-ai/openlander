import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const CONTROL_ENTRY = join(process.cwd(), 'openlanderctl');

describe('openlanderctl Docker administrator CLI', () => {
  it('is valid Bash and documents password recovery', () => {
    const syntax = spawnSync('bash', ['-n', CONTROL_ENTRY], { encoding: 'utf8' });
    const help = spawnSync('bash', [CONTROL_ENTRY, '--help'], { encoding: 'utf8' });

    expect(syntax.status).toBe(0);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('openlanderctl admin reset-password');
    expect(help.stdout).toMatch(/without placing it in shell history or environment variables/i);
  });

  it('refuses non-interactive password reset and never accepts a password argument', () => {
    const nonInteractive = spawnSync('bash', [CONTROL_ENTRY, 'admin', 'reset-password'], {
      encoding: 'utf8',
    });
    const passwordArgument = spawnSync(
      'bash',
      [CONTROL_ENTRY, 'admin', 'reset-password', 'do-not-accept-this'],
      { encoding: 'utf8' },
    );

    expect(nonInteractive.status).toBe(1);
    expect(nonInteractive.stderr).toMatch(/interactive terminal/i);
    expect(passwordArgument.status).toBe(1);
    expect(passwordArgument.stderr).toMatch(/does not accept password arguments/i);
  });

  it('runs the in-container administrator command through Docker Compose', () => {
    const source = readFileSync(CONTROL_ENTRY, 'utf8');

    expect(source).toContain('exec "${compose_command[@]}" exec openlander');
    expect(source).toContain('node dist/cli/index.js admin reset-password');
    expect(source).not.toContain('exec -T openlander');
  });
});
