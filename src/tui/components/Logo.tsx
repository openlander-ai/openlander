import { Show, type JSX } from 'solid-js';
import { useTerminalDimensions } from '@opentui/solid';
import { theme } from '../theme.js';

// ── Logo Data ───────────────────────────────────────────────────────────────

// "OPEN" - ~36 chars wide
const LOGO_OPEN = [
  ' ██████╗ ██████╗ ███████╗███╗   ██╗',
  '██╔═══██╗██╔══██╗██╔════╝████╗  ██║',
  '██║   ██║██████╔╝█████╗  ██╔██╗ ██║',
  '██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║',
  '╚██████╔╝██║     ███████╗██║ ╚████║',
  ' ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝',
];

// "LANDER" - ~51 chars wide
const LOGO_LANDER = [
  '██╗      █████╗ ███╗   ██╗██████╗ ███████╗██████╗ ',
  '██║     ██╔══██╗████╗  ██║██╔══██╗██╔════╝██╔══██╗',
  '██║     ███████║██╔██╗ ██║██║  ██║█████╗  ██████╔╝',
  '██║     ██╔══██║██║╚██╗██║██║  ██║██╔══╝  ██╔══██╗',
  '███████╗██║  ██║██║ ╚████║██████╔╝███████╗██║  ██║',
  '╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝ ╚══════╝╚═╝  ╚═╝',
];

const WIDTH_OPEN = 36;
const WIDTH_LANDER = 51;
const GAP = 2;
const WIDTH_FULL = WIDTH_OPEN + GAP + WIDTH_LANDER; // ~89 chars

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

// Pre-calculate gradients
const GRAY_GRADIENT = [
  tint(theme.background, theme.textMuted, 1.0),
  tint(theme.background, theme.textMuted, 0.85),
  tint(theme.background, theme.textMuted, 0.7),
  tint(theme.background, theme.textMuted, 0.55),
  tint(theme.background, theme.textMuted, 0.45),
  tint(theme.background, theme.textMuted, 0.35),
];

const ORANGE_GRADIENT = [
  tint(theme.background, theme.primary, 1.0),
  tint(theme.background, theme.primary, 0.88),
  tint(theme.background, theme.primary, 0.76),
  tint(theme.background, theme.primary, 0.64),
  tint(theme.background, theme.primary, 0.52),
  tint(theme.background, theme.primary, 0.4),
];

// ── Component ───────────────────────────────────────────────────────────────

export function Logo(): JSX.Element {
  const dims = useTerminalDimensions();
  const width = () => dims().width;

  // Estimate actual available content width, accounting for split-panel layout.
  // Layout.tsx: >=120 → 60:40, >=80 → 65:35, <80 → single panel.
  // Deductions: layout padding(2) + panel paddingRight(1) + ChatPanel padding(4) = 7.
  const availableWidth = () => {
    const w = width();
    if (w >= 120) return Math.floor(w * 0.6) - 7;
    if (w >= 80) return Math.floor(w * 0.65) - 7;
    return w - 6;
  };

  return (
    <box flexDirection="column">
      <Show
        when={availableWidth() >= WIDTH_LANDER}
        fallback={
          <text fg={theme.primary} bold={true}>
            OpenLander
          </text>
        }
      >
        {/* Row-by-row rendering for gradient effect */}
        <box flexDirection="column">
          {LOGO_LANDER.map((_, i) => (
            <box flexDirection="row" gap={GAP}>
              {/* Left "OPEN" section - only if space permits */}
              <Show when={availableWidth() >= WIDTH_FULL}>
                <text fg={GRAY_GRADIENT[i]}>{LOGO_OPEN[i]}</text>
              </Show>

              {/* Right "LANDER" section */}
              <text fg={ORANGE_GRADIENT[i]} bold>
                {LOGO_LANDER[i]}
              </text>
            </box>
          ))}
        </box>
      </Show>
    </box>
  );
}
