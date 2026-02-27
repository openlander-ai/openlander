/**
 * OpenLander block character logo with shadow effects.
 * Renders "OPEN" (muted gray) and "LANDER" (primary orange) using
 * Unicode block characters with shadow markers for depth.
 */
import { For, Show, type JSX } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';

// ── Logo Data ───────────────────────────────────────────────────────────────

const logoData = {
  left: [
    '                   ',
    '█▀▀█ █▀▀█ █▀▀█ █▀▀▄',
    '█__█ █__█ █^^^ █__█',
    '▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀~~▀',
  ],
  right: [
    '                  ▄          ',
    '█    █▀▀█ █▀▀▄ █▀▀█ █▀▀█ █▀▀█',
    '█___ █^^█ █__█ █__█ █^^^ █^^▄',
    '▀▀▀▀ ▀  ▀ ▀~~▀ ▀▀▀▀ ▀▀▀▀ ▀  ▀',
  ],
};

const SHADOW_MARKERS = /[_^~]/;

// ── Color Tinting ───────────────────────────────────────────────────────────

/**
 * Blend two hex colors together.
 * @param bg - Background color (hex)
 * @param fg - Foreground color (hex)
 * @param factor - Blend factor (0 = bg, 1 = fg)
 */
function tint(bg: string, fg: string, factor: number): string {
  const parse = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [
      parseInt(h.substring(0, 2), 16),
      parseInt(h.substring(2, 4), 16),
      parseInt(h.substring(4, 6), 16),
    ];
  };
  const [br, bg2, bb] = parse(bg);
  const [fr, fg2, fb] = parse(fg);
  const blend = (a: number, b: number) => Math.round(a + (b - a) * factor);
  return `#${blend(br, fr).toString(16).padStart(2, '0')}${blend(bg2, fg2).toString(16).padStart(2, '0')}${blend(bb, fb).toString(16).padStart(2, '0')}`;
}

// ── Line Rendering ──────────────────────────────────────────────────────────

/**
 * Parse a logo line and return an array of <text> elements.
 * Handles shadow markers: _ (space with shadow bg), ^ (▀ with shadow bg), ~ (▀ in shadow color).
 * Batches consecutive normal characters into single <text> elements for efficiency.
 */
function renderLine(line: string, fg: string, bold: boolean): JSX.Element[] {
  const elements: JSX.Element[] = [];
  const shadow = tint(theme.background, fg, 0.25);

  let normalChars = '';
  let i = 0;

  const flushNormal = () => {
    if (normalChars.length > 0) {
      elements.push(
        <text fg={fg} bold={bold}>
          {normalChars}
        </text>,
      );
      normalChars = '';
    }
  };

  while (i < line.length) {
    const char = line[i];
    if (!char) break;

    if (SHADOW_MARKERS.test(char)) {
      // Flush any accumulated normal characters first
      flushNormal();

      // Handle shadow markers
      if (char === '_') {
        elements.push(
          <text fg={fg} bg={shadow}>
            {' '}
          </text>,
        );
      } else if (char === '^') {
        elements.push(
          <text fg={fg} bg={shadow}>
            {'▀'}
          </text>,
        );
      } else if (char === '~') {
        elements.push(<text fg={shadow}>{'▀'}</text>);
      }
    } else {
      // Accumulate normal characters
      normalChars += char;
    }
    i++;
  }

  // Flush any remaining normal characters
  flushNormal();

  return elements;
}

// ── Component ───────────────────────────────────────────────────────────────

export function Logo(): JSX.Element {
  const dims = useTerminalDimensions();
  const width = () => dims().width;

  // Minimum width for block logo: 49 chars (left 19 + gap 1 + right 29) + some padding
  const MIN_WIDTH = 55;

  return (
    <Show
      when={width() >= MIN_WIDTH}
      fallback={
        <text fg={theme.primary} bold={true}>
          OpenLander
        </text>
      }
    >
      <box flexDirection="column">
        <For each={logoData.left}>
          {(line, index) => (
            <box flexDirection="row" gap={1}>
              <box flexDirection="row">{renderLine(line, theme.textMuted, false)}</box>
              <box flexDirection="row">
                {renderLine(logoData.right[index()] ?? '', theme.primary, true)}
              </box>
            </box>
          )}
        </For>
      </box>
    </Show>
  );
}
