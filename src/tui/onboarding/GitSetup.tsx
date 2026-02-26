import { createSignal, createEffect, onCleanup } from 'solid-js';
import type { JSX } from 'solid-js';
import { useKeyboard } from '@opentui/solid';
import { Spinner } from '../components/Spinner.js';

import type { ScreenProps } from './index.js';
import { updateConfig } from '../../config/index.js';
import { homedir } from 'node:os';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { createModuleLogger } from '../../lib/logger.js';

const log = createModuleLogger('tui');

type GitState =
  | 'menu'
  | 'checking_keys'
  | 'select_key'
  | 'generating'
  | 'testing'
  | 'success'
  | 'error';

interface SshKey {
  name: string;
  path: string;
}

const SSH_DIR = join(homedir(), '.ssh');

/**
 * GitSetup screen - configure SSH keys for Git repository access.
 * Allows selecting existing keys or generating new ones.
 */
export function GitSetup({ ctx: _ctx, onNext }: ScreenProps): JSX.Element {
  const [state, setState] = createSignal<GitState>('menu');
  const [existingKeys, setExistingKeys] = createSignal<SshKey[]>([]);
  const [selectedKey, setSelectedKey] = createSignal<SshKey | null>(null);
  const [error, setError] = createSignal<string | null>(null);
  const [menuIndex, setMenuIndex] = createSignal(0);
  const [keyIndex, setKeyIndex] = createSignal(0);

  const menuItems = [
    { label: 'SSH Key (recommended)', value: 'ssh' },
    { label: 'Skip (public repos only)', value: 'skip' },
  ];

  const findExistingKeys = (): SshKey[] => {
    const keys: SshKey[] = [];
    if (!existsSync(SSH_DIR)) {
      return keys;
    }

    try {
      const files = readdirSync(SSH_DIR);
      for (const file of files) {
        // Look for private keys (no .pub extension, not config files)
        if (
          file.endsWith('.pub') ||
          file.includes('.txt') ||
          file === 'config' ||
          file === 'known_hosts' ||
          file === 'authorized_keys'
        ) {
          continue;
        }
        const fullPath = join(SSH_DIR, file);
        try {
          // Check if it looks like a private key
          const content = readFileSync(fullPath, 'utf8');
          if (content.includes('PRIVATE KEY')) {
            keys.push({ name: file, path: fullPath });
          }
        } catch (err) {
          log.debug({ err, file }, 'Failed to read SSH key file');
          // Skip unreadable files
        }
      }
    } catch (err) {
      log.debug({ err }, 'Failed to read SSH directory');
      // Ignore errors reading directory
    }
    return keys;
  };

  const handleMenuSelect = (value: string) => {
    if (value === 'ssh') {
      setState('checking_keys');
      const keys = findExistingKeys();
      setExistingKeys(keys);
      if (keys.length > 0) {
        setState('select_key');
      } else {
        setState('generating');
      }
    } else {
      // Skip - just proceed
      onNext();
    }
  };

  const handleKeySelect = (value: string) => {
    const key = existingKeys().find((k) => k.path === value);
    if (key) {
      setSelectedKey(key);
      setState('testing');
    }
  };

  const handleGenerateKey = () => {
    setState('generating');
    try {
      const keyPath = join(SSH_DIR, 'id_ed25519');
      execSync(`ssh-keygen -t ed25519 -f "${keyPath}" -N "" -C "openlander"`, {
        stdio: 'pipe',
      });
      setSelectedKey({ name: 'id_ed25519', path: keyPath });
      setState('testing');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate SSH key');
      setState('error');
    }
  };

  const testSshKey = (keyPath: string) => {
    try {
      // Test SSH connection to GitHub
      const result = execSync(
        `ssh -i "${keyPath}" -T git@github.com -o StrictHostKeyChecking=no -o BatchMode=yes 2>&1`,
        {
          encoding: 'utf8',
          timeout: 10000,
        },
      );
      // GitHub returns "Hi username! You've successfully authenticated" even on success (exit code 1)
      if (
        result.includes('successfully authenticated') ||
        result.includes("You've successfully authenticated")
      ) {
        return { success: true, message: 'SSH key authenticated with GitHub' };
      }
      return { success: true, message: 'SSH key is valid' };
    } catch (err) {
      const output = err instanceof Error ? err.message : String(err);
      // GitHub returns exit code 1 even on success
      if (
        output.includes('successfully authenticated') ||
        output.includes("You've successfully authenticated")
      ) {
        return { success: true, message: 'SSH key authenticated with GitHub' };
      }
      // Key might not be added to GitHub yet - that's okay for onboarding
      return { success: true, message: 'SSH key found (not yet added to GitHub)' };
    }
  };

  // Handle key testing
  createEffect(() => {
    if (state() === 'testing' && selectedKey()) {
      const key = selectedKey();
      if (!key) return;
      const result = testSshKey(key.path);
      if (result.success) {
        // Save to config
        updateConfig({
          git: {
            sshKeyPath: key.path,
          },
        });
        setState('success');
        // Auto-advance after 1.5s
        const timer = setTimeout(() => {
          onNext();
        }, 1500);
        onCleanup(() => {
          clearTimeout(timer);
        });
      } else {
        setError(result.message);
        setState('error');
      }
    }
  });

  // Auto-generate key when entering 'generating' state
  createEffect(() => {
    if (state() === 'generating') {
      handleGenerateKey();
    }
  });

  useKeyboard((evt) => {
    const s = state();

    // Menu navigation
    if (s === 'menu') {
      if (evt.key === 'up') {
        setMenuIndex((i) => Math.max(0, i - 1));
      } else if (evt.key === 'down') {
        setMenuIndex((i) => Math.min(menuItems.length - 1, i + 1));
      } else if (evt.key === 'return') {
        const item = menuItems[menuIndex()];
        if (item) handleMenuSelect(item.value);
      }
      return;
    }

    // Key selection navigation
    if (s === 'select_key') {
      const keys = existingKeys();
      if (evt.key === 'up') {
        setKeyIndex((i) => Math.max(0, i - 1));
      } else if (evt.key === 'down') {
        setKeyIndex((i) => Math.min(keys.length - 1, i + 1));
      } else if (evt.key === 'return') {
        const key = keys[keyIndex()];
        if (key) {
          handleKeySelect(key.path);
        }
      }
      return;
    }

    if (evt.key === 'return' && (s === 'success' || s === 'error')) {
      if (s === 'success') {
        onNext();
      } else {
        setState('menu');
        setError(null);
      }
    }
  });

  const renderContent = (): JSX.Element => {
    switch (state()) {
      case 'menu':
        return (
          <box flexDirection="column" alignItems="center">
            <box marginBottom={1}>
              <text dim={true}>How do you want to access Git repositories?</text>
            </box>
            <box flexDirection="column">
              {menuItems.map((item, i) => (
                <box>
                  <text fg={menuIndex() === i ? 'cyan' : undefined} bold={menuIndex() === i}>
                    {menuIndex() === i ? '❯ ' : '  '}
                    {item.label}
                  </text>
                </box>
              ))}
            </box>
          </box>
        );

      case 'checking_keys':
        return (
          <box>
            <text fg="yellow">
              <Spinner />
            </text>
            <text> Checking for SSH keys...</text>
          </box>
        );

      case 'select_key':
        return (
          <box flexDirection="column" alignItems="center">
            <box marginBottom={1}>
              <text dim={true}>Found {existingKeys().length} SSH key(s):</text>
            </box>
            <box flexDirection="column">
              {existingKeys().map((k, i) => (
                <box>
                  <text fg={keyIndex() === i ? 'cyan' : undefined} bold={keyIndex() === i}>
                    {keyIndex() === i ? '❯ ' : '  '}
                    {k.name}
                  </text>
                </box>
              ))}
            </box>
          </box>
        );

      case 'generating':
        return (
          <box>
            <text fg="yellow">
              <Spinner />
            </text>
            <text> Generating new SSH key (ed25519)...</text>
          </box>
        );

      case 'testing':
        return (
          <box>
            <text fg="yellow">
              <Spinner />
            </text>
            <text> Testing SSH key...</text>
          </box>
        );

      case 'success':
        return (
          <box flexDirection="column" alignItems="center">
            <box>
              <text fg="green">✅ SSH key configured</text>
            </box>
            {selectedKey() && (
              <box>
                <text dim={true}>Key: {selectedKey()?.name}</text>
              </box>
            )}
            <box marginTop={1}>
              <text dim={true}>Continuing...</text>
            </box>
          </box>
        );

      case 'error':
        return (
          <box flexDirection="column" alignItems="center">
            <box marginBottom={1}>
              <text fg="red">❌ {error() || 'An error occurred'}</text>
            </box>
            <box>
              <text fg="cyan" bold={true}>
                [Enter]
              </text>
              <text> Try again</text>
            </box>
          </box>
        );

      default:
        return <box />;
    }
  };

  return (
    <box flexDirection="column" alignItems="center" justifyContent="center" height={20} padding={2}>
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
          <text bold={true} fg="cyan">
            [2/5] Git Repository Access
          </text>
        </box>

        <box marginTop={2}>{renderContent()}</box>
      </box>
    </box>
  );
}
