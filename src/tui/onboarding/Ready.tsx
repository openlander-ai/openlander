import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { useExit } from '../context/exit.js';

import { PatchNotes } from './PatchNotes.js';
import { VERSION } from './version.js';
import { getDataDir } from '../../config/index.js';

export interface ReadyProps {
  onNext: () => void;
}

/**
 * Ready screen - final onboarding screen.
 * Shows security notice, data paths, and patch notes.
 */
export function Ready({ onNext }: ReadyProps): JSX.Element {
  const { exit } = useExit();
  const dataDir = getDataDir();

  useKeyboard((evt) => {
    if (evt.key === 'return') {
      onNext();
    }
    if (evt.char && evt.char.toLowerCase() === 'q') {
      exit();
    }
  });

  return (
    <box flexDirection="column" alignItems="center" justifyContent="center" height={24} padding={2}>
      <box
        flexDirection="column"
        alignItems="center"
        border="round"
        borderColor="cyan"
        paddingX={4}
        paddingY={2}
        width={60}
      >
        <box marginBottom={1}>
          <text bold={true} fg="green">
            [5/5] Ready!
          </text>
        </box>

        {/* Security notice */}
        <box flexDirection="column" alignItems="center" marginTop={1}>
          <box marginBottom={1}>
            <text fg="yellow">⚠️ OpenLander will:</text>
          </box>
          <box marginLeft={2}>
            <text dim={true}>• Manage Docker containers on this machine</text>
          </box>
          <box marginLeft={2}>
            <text dim={true}>• Control Traefik routing (port 80)</text>
          </box>
          <box marginLeft={2}>
            <text dim={true}>• Clone repositories via SSH</text>
          </box>
        </box>

        {/* Data paths */}
        <box flexDirection="column" alignItems="center" marginTop={1}>
          <box marginBottom={1}>
            <text dim={true}>Data directory:</text>
          </box>
          <box>
            <text fg="cyan">{dataDir}/</text>
          </box>
        </box>

        {/* Patch notes */}
        <box marginTop={1}>
          <PatchNotes version={VERSION} />
        </box>

        {/* Action prompt */}
        <box marginTop={2}>
          <text fg="green" bold={true}>
            [Enter]
          </text>
          <text> Start OpenLander</text>
        </box>

        <box marginTop={1}>
          <text dim={true}>[q] Quit</text>
        </box>
      </box>
    </box>
  );
}
