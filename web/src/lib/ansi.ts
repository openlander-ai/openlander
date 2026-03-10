import AnsiToHtml from 'ansi-to-html';

const converter = new AnsiToHtml({
  fg: '#d4d4d4',
  bg: 'transparent',
  newline: false,
  escapeXML: true,
});

export function parseAnsiLine(line: string): string {
  return converter.toHtml(line);
}

export function stripAnsi(line: string): string {
  // eslint-disable-next-line no-control-regex
  return line.replace(/\x1B\[[0-9;]*[mGKHF]/g, '');
}
