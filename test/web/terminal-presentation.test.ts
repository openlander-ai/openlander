import { describe, expect, it } from 'vitest';
import { translations as ko } from '../../web/src/i18n/ko.js';
import { formatTerminalControlFrame } from '../../web/src/components/deploy-terminal/terminal-presentation.js';

type TranslationTree = Record<string, string | TranslationTree>;

function t(key: string): string {
  const value = key.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[segment];
  }, ko as TranslationTree);
  return typeof value === 'string' ? value : key;
}

describe('terminal control-frame localization', () => {
  it('localizes a coded server error and keeps the diagnostic code', () => {
    const output = formatTerminalControlFrame(
      JSON.stringify({
        type: 'error',
        code: 'CONTAINER_NOT_RUNNING',
        message: 'Container is not running',
      }),
      t,
    );

    expect(output).toContain('컨테이너가 실행 중이 아닙니다');
    expect(output).toContain('CONTAINER_NOT_RUNNING');
    expect(output).not.toContain('Container is not running');
  });

  it('localizes a known legacy message from an older server', () => {
    const output = formatTerminalControlFrame(
      JSON.stringify({ type: 'error', message: 'Terminal idle timeout (30m)' }),
      t,
    );

    expect(output).toContain('30분 동안 입력이 없어');
    expect(output).toContain('TERMINAL_IDLE_TIMEOUT');
  });

  it('does not expose unknown server prose', () => {
    const output = formatTerminalControlFrame(
      JSON.stringify({ type: 'error', message: 'Unexpected internal English detail' }),
      t,
    );

    expect(output).toContain('터미널 요청을 완료하지 못했습니다');
    expect(output).not.toContain('Unexpected internal English detail');
  });

  it('preserves non-control terminal output verbatim', () => {
    expect(formatTerminalControlFrame('npm run build\r\n', t)).toBe('npm run build\r\n');
  });
});
