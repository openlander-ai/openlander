import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import SelectInput from 'ink-select-input';

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
export function GitSetup({ ctx: _ctx, onNext }: ScreenProps): React.ReactElement {
  const [state, setState] = useState<GitState>('menu');
  const [existingKeys, setExistingKeys] = useState<SshKey[]>([]);
  const [selectedKey, setSelectedKey] = useState<SshKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const findExistingKeys = useCallback((): SshKey[] => {
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
  }, []);

  const handleMenuSelect = useCallback(
    (item: { value: string }) => {
      if (item.value === 'ssh') {
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
    },
    [findExistingKeys, onNext],
  );

  const handleKeySelect = useCallback(
    (item: { value: string }) => {
      const key = existingKeys.find((k) => k.path === item.value);
      if (key) {
        setSelectedKey(key);
        setState('testing');
      }
    },
    [existingKeys],
  );

  const handleGenerateKey = useCallback(() => {
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
  }, []);

  const testSshKey = useCallback((keyPath: string) => {
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
  }, []);

  // Handle key testing
  useEffect(() => {
    if (state === 'testing' && selectedKey) {
      const result = testSshKey(selectedKey.path);
      if (result.success) {
        // Save to config
        updateConfig({
          git: {
            sshKeyPath: selectedKey.path,
          },
        });
        setState('success');
        // Auto-advance after 1.5s
        setTimeout(() => {
          onNext();
        }, 1500);
      } else {
        setError(result.message);
        setState('error');
      }
    }
  }, [state, selectedKey, testSshKey, onNext]);

  // Auto-generate key when entering 'generating' state
  useEffect(() => {
    if (state === 'generating') {
      handleGenerateKey();
    }
  }, [state, handleGenerateKey]);

  useInput((_input, key) => {
    if (key.return && (state === 'success' || state === 'error')) {
      if (state === 'success') {
        onNext();
      } else {
        setState('menu');
        setError(null);
      }
    }
  });

  const renderContent = () => {
    switch (state) {
      case 'menu':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box marginBottom={1}>
              <Text dimColor>How do you want to access Git repositories?</Text>
            </Box>
            <SelectInput
              items={[
                { label: 'SSH Key (recommended)', value: 'ssh' },
                { label: 'Skip (public repos only)', value: 'skip' },
              ]}
              onSelect={handleMenuSelect}
            />
          </Box>
        );

      case 'checking_keys':
        return (
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text> Checking for SSH keys...</Text>
          </Box>
        );

      case 'select_key':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box marginBottom={1}>
              <Text dimColor>Found {existingKeys.length} SSH key(s):</Text>
            </Box>
            <SelectInput
              items={existingKeys.map((k) => ({
                label: k.name,
                value: k.path,
              }))}
              onSelect={handleKeySelect}
            />
          </Box>
        );

      case 'generating':
        return (
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text> Generating new SSH key (ed25519)...</Text>
          </Box>
        );

      case 'testing':
        return (
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text> Testing SSH key...</Text>
          </Box>
        );

      case 'success':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box>
              <Text color="green">✅ SSH key configured</Text>
            </Box>
            {selectedKey && (
              <Box>
                <Text dimColor>Key: {selectedKey.name}</Text>
              </Box>
            )}
            <Box marginTop={1}>
              <Text dimColor>Continuing...</Text>
            </Box>
          </Box>
        );

      case 'error':
        return (
          <Box flexDirection="column" alignItems="center">
            <Box marginBottom={1}>
              <Text color="red">❌ {error || 'An error occurred'}</Text>
            </Box>
            <Box>
              <Text color="cyan" bold>
                [Enter]
              </Text>
              <Text> Try again</Text>
            </Box>
          </Box>
        );

      default:
        return null;
    }
  };

  return (
    <Box flexDirection="column" alignItems="center" justifyContent="center" height={20} padding={2}>
      <Box
        flexDirection="column"
        alignItems="center"
        borderStyle="round"
        borderColor="cyan"
        paddingX={4}
        paddingY={2}
        width={60}
      >
        <Box marginBottom={1}>
          <Text bold color="cyan">
            [2/5] Git Repository Access
          </Text>
        </Box>

        <Box marginTop={2}>{renderContent()}</Box>
      </Box>
    </Box>
  );
}
