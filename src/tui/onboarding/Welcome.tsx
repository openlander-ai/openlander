import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { useExit } from '../context/exit.js';

import { VERSION } from './version.js';

export interface WelcomeProps {
  onNext: () => void;
}

/**
 * Welcome screen - first screen of the onboarding wizard.
 * Shows version, tagline, and prompts user to press Enter.
 */
export function Welcome({ onNext }: WelcomeProps): JSX.Element {
  const { exit } = useExit();

  useKeyboard((evt) => {
    if (evt.key === 'return') {
      onNext();
    }
    if (evt.char && evt.char.toLowerCase() === 'q') {
      exit();
    }
  });

  return (
    <box flexDirection="column" alignItems="center" justifyContent="center" height={20} padding={2}>
      <box
        flexDirection="column"
        alignItems="center"
        border="round"
        borderColor="cyan"
        paddingX={4}
        paddingY={2}
      >
        <box marginBottom={1}>
          <text bold={true} fg="cyan">
            🛬 OpenLander
          </text>
        </box>

        <box marginBottom={1}>
          <text dim={true}>v{VERSION}</text>
        </box>

        <box marginBottom={2}>
          <text fg="gray">Give any coding agent the power to deploy</text>
        </box>

        <box marginTop={1}>
          <text dim={true}>━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━</text>
        </box>

        <box marginTop={2} flexDirection="column" alignItems="center">
          <text fg="gray">OpenLander helps you deploy apps from any AI coding tool.</text>
          <text fg="gray">Clone, build, and run — all from a chat.</text>
        </box>

        <box marginTop={2}>
          <text fg="green" bold={true}>
            [Enter]
          </text>
          <text> Get started</text>
        </box>

        <box marginTop={1}>
          <text dim={true}>[q] Quit</text>
        </box>
      </box>
    </box>
  );
}
