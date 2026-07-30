import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Docker } from '../pipeline/docker.js';
import { PlatformUpdateExecutionError, PlatformUpdateValidationError } from '../errors.js';
import { createModuleLogger } from '../lib/logger.js';
import { sleep } from '../lib/sleep.js';
import { sha256Hex } from './release-checker.js';
import { PlatformUpdateStateStore } from './state-store.js';
import type {
  PlatformUpdateOperation,
  PlatformUpdatePhase,
  PlatformUpdateRunnerInput,
} from './types.js';

const log = createModuleLogger('platform-update:runner');
const HEALTH_TIMEOUT_MS = 3 * 60 * 1000;
const POLL_MS = 2_000;
const MAX_COMMAND_OUTPUT = 64 * 1024;

interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

type RunnerDocker = Pick<Docker, 'execToFile' | 'pullImage' | 'inspectImage'>;
type CommandRunner = typeof runCommand;

const COMPOSE_ENVIRONMENT_KEYS = [
  'OPENLANDER_POSTGRES_PASSWORD',
  'OPENLANDER_PORT',
  'OPENLANDER_PUBLIC_HOST',
  'OPENLANDER_DATA_VOLUME',
] as const;

type ComposeEnvironmentKey = (typeof COMPOSE_ENVIRONMENT_KEYS)[number];
type ComposeEnvironment = Record<ComposeEnvironmentKey, string>;

export interface PlatformUpdateRunnerDependencies {
  docker?: RunnerDocker;
  fetchImpl?: typeof fetch;
  commandRunner?: CommandRunner;
  healthTimeoutMs?: number;
  environment?: NodeJS.ProcessEnv;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
  return await new Promise<CommandResult>((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout = `${stdout}${chunk}`.slice(-MAX_COMMAND_OUTPUT);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-MAX_COMMAND_OUTPUT);
    });
    child.once('error', rejectCommand);
    child.once('close', (exitCode) => {
      resolveCommand({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });
}

function composeArgs(input: PlatformUpdateRunnerInput, args: string[]): string[] {
  return [
    'compose',
    '--project-name',
    input.composeProject,
    ...input.composeFiles.flatMap((file) => ['--file', file]),
    ...args,
  ];
}

async function runCompose(
  input: PlatformUpdateRunnerInput,
  args: string[],
  commandRunner: CommandRunner,
): Promise<void> {
  const result = await commandRunner('docker', composeArgs(input, args), input.workingDirectory);
  if (result.exitCode !== 0) {
    throw new PlatformUpdateExecutionError('Docker Compose could not apply the platform update.', {
      exitCode: result.exitCode,
      stderr: result.stderr.slice(-2_000),
    });
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function writeFileAtomic(path: string, content: string, mode: number): Promise<void> {
  const tempPath = `${path}.openlander-update.tmp`;
  await writeFile(tempPath, content, { mode });
  await rename(tempPath, path);
}

function formatComposeEnvironmentValue(value: string): string {
  if (value.length === 0) return '""';
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) return value;
  throw new PlatformUpdateValidationError(
    'A Compose environment value cannot be persisted safely for the platform update.',
  );
}

function updateComposeEnvironmentEntry(
  environmentContent: string,
  key: string,
  value: string,
  replaceExisting: boolean,
): string {
  const lineEnding = environmentContent.includes('\r\n') ? '\r\n' : '\n';
  const formattedValue = formatComposeEnvironmentValue(value);
  if (environmentContent.length === 0) return `${key}=${formattedValue}${lineEnding}`;
  const endedWithNewline = /\r?\n$/.test(environmentContent);
  const lines = environmentContent.split(/\r?\n/);
  const matchingIndexes = lines
    .map((line, index) => (line.startsWith(`${key}=`) ? index : -1))
    .filter((index) => index >= 0);
  if (matchingIndexes.length > 1) {
    throw new PlatformUpdateValidationError(
      `The Compose .env file contains multiple ${key} entries.`,
    );
  }
  if (matchingIndexes.length === 1 && replaceExisting) {
    const index = matchingIndexes[0];
    if (index !== undefined) lines[index] = `${key}=${formattedValue}`;
  } else if (matchingIndexes.length === 0) {
    const insertionIndex = endedWithNewline ? lines.length - 1 : lines.length;
    lines.splice(insertionIndex, 0, `${key}=${formattedValue}`);
  }
  const updated = lines.join(lineEnding);
  return endedWithNewline ? updated : `${updated}${lineEnding}`;
}

export function replaceOpenLanderImage(environmentContent: string, image: string): string {
  return updateComposeEnvironmentEntry(environmentContent, 'OPENLANDER_IMAGE', image, true);
}

export function persistOpenLanderComposeEnvironment(
  environmentContent: string,
  image: string,
  composeEnvironment: ComposeEnvironment,
): string {
  let updated = replaceOpenLanderImage(environmentContent, image);
  for (const key of COMPOSE_ENVIRONMENT_KEYS) {
    updated = updateComposeEnvironmentEntry(updated, key, composeEnvironment[key], true);
  }
  return updated;
}

function readComposeEnvironment(environment: NodeJS.ProcessEnv): ComposeEnvironment {
  const values = {} as ComposeEnvironment;
  for (const key of COMPOSE_ENVIRONMENT_KEYS) {
    const value = environment[key];
    if (value === undefined) {
      throw new PlatformUpdateValidationError(
        'The current Compose environment cannot be preserved for the platform update.',
        { missingKey: key },
      );
    }
    formatComposeEnvironmentValue(value);
    values[key] = value;
  }
  return values;
}

function targetComposeUrl(version: string): string {
  return `https://raw.githubusercontent.com/openlander-ai/openlander/v${encodeURIComponent(version)}/docker-compose.runtime.yml`;
}

async function downloadTargetCompose(
  input: PlatformUpdateRunnerInput,
  fetchImpl: typeof fetch,
): Promise<string> {
  const response = await fetchImpl(targetComposeUrl(input.targetVersion), {
    headers: { 'User-Agent': 'OpenLander-Update-Runner' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new PlatformUpdateValidationError('The target Compose file could not be downloaded.', {
      status: response.status,
    });
  }
  const content = await response.text();
  if (sha256Hex(content) !== input.targetComposeSha256) {
    throw new PlatformUpdateValidationError('The target Compose file checksum does not match.');
  }
  return content;
}

async function waitForVersion(
  input: PlatformUpdateRunnerInput,
  store: PlatformUpdateStateStore,
  expectedVersion: string,
  requireStartupValidation: boolean,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastHealthVersion: string | null = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(`http://${input.composeService}:10114/health`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        const payload: unknown = await response.json();
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
          const candidate = (payload as Record<string, unknown>).version;
          lastHealthVersion = typeof candidate === 'string' ? candidate : null;
          if (lastHealthVersion === expectedVersion) {
            if (!requireStartupValidation) return;
            const validation = await store.readStartupValidation(input.operationId);
            if (validation?.version === expectedVersion && validation.ok) return;
            if (validation?.version === expectedVersion && !validation.ok) {
              throw new PlatformUpdateValidationError(
                'The updated process failed its Traefik startup validation.',
              );
            }
          }
        }
      }
    } catch (error) {
      if (error instanceof PlatformUpdateValidationError) throw error;
    }
    await sleep(POLL_MS);
  }
  throw new PlatformUpdateValidationError('The updated process did not pass health verification.', {
    expectedVersion,
    observedVersion: lastHealthVersion,
  });
}

async function backupInstallation(
  input: PlatformUpdateRunnerInput,
  store: PlatformUpdateStateStore,
  docker: RunnerDocker,
): Promise<{ environmentExisted: boolean }> {
  const backupDirectory = store.backupDirectory(input.operationId);
  await mkdir(backupDirectory, { recursive: true, mode: 0o700 });
  const environmentPath = join(input.workingDirectory, '.env');
  const environmentExisted = await pathExists(environmentPath);
  if (environmentExisted) await copyFile(environmentPath, join(backupDirectory, '.env'));
  for (const composeFile of input.composeFiles) {
    await copyFile(composeFile, join(backupDirectory, basename(composeFile)));
  }
  await docker.execToFile(
    input.databaseContainerId,
    ['pg_dump', '--format=custom', '--username=openlander', '--dbname=openlander'],
    join(backupDirectory, 'openlander.pgdump'),
  );
  await writeFile(
    join(backupDirectory, 'metadata.json'),
    `${JSON.stringify(
      {
        sourceVersion: input.sourceVersion,
        targetVersion: input.targetVersion,
        sourceImage: input.sourceImage,
        environmentExisted,
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );
  return { environmentExisted };
}

async function restoreInstallation(
  input: PlatformUpdateRunnerInput,
  store: PlatformUpdateStateStore,
  environmentExisted: boolean,
  composeEnvironment: ComposeEnvironment,
): Promise<void> {
  const backupDirectory = store.backupDirectory(input.operationId);
  const environmentPath = join(input.workingDirectory, '.env');
  let restoredEnvironment = '';
  if (environmentExisted) {
    restoredEnvironment = await readFile(join(backupDirectory, '.env'), 'utf8');
  }
  await writeFileAtomic(
    environmentPath,
    persistOpenLanderComposeEnvironment(restoredEnvironment, input.sourceImage, composeEnvironment),
    0o600,
  );
  for (const composeFile of input.composeFiles) {
    await copyFile(join(backupDirectory, basename(composeFile)), composeFile);
  }
}

async function pruneOldBackups(store: PlatformUpdateStateStore): Promise<void> {
  const entries = await readdir(store.updateRoot, { withFileTypes: true });
  const candidates = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const backupPath = join(store.updateRoot, entry.name, 'backup');
        try {
          const info = await stat(backupPath);
          return { name: entry.name, modifiedAt: info.mtimeMs };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      }),
  );
  const old = candidates
    .filter((entry): entry is { name: string; modifiedAt: number } => entry !== null)
    .sort((left, right) => right.modifiedAt - left.modifiedAt)
    .slice(3);
  await Promise.all(old.map((entry) => store.removeOperationDirectory(entry.name)));
}

async function pruneOldBackupsForTerminalState(
  store: PlatformUpdateStateStore,
  operationId: string,
): Promise<string | null> {
  try {
    await pruneOldBackups(store);
    return null;
  } catch (error) {
    log.error({ error, operationId }, 'Platform update backup retention cleanup failed');
    return 'The update finished, but older backup directories could not be pruned.';
  }
}

function publicFailureCode(error: unknown): string {
  if (error instanceof PlatformUpdateValidationError) return 'UPDATE_VERIFICATION_FAILED';
  if (error instanceof PlatformUpdateExecutionError) return 'UPDATE_COMMAND_FAILED';
  return 'UPDATE_FAILED';
}

export async function runPlatformUpdate(
  operationId: string,
  dataDir: string,
  dependencies: PlatformUpdateRunnerDependencies = {},
): Promise<void> {
  const docker = dependencies.docker ?? new Docker();
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const commandRunner = dependencies.commandRunner ?? runCommand;
  const healthTimeoutMs = dependencies.healthTimeoutMs ?? HEALTH_TIMEOUT_MS;
  const store = new PlatformUpdateStateStore(dataDir);
  const input = await store.readRunnerInput(operationId);
  const storedOperation = await store.readOperation();
  if (!storedOperation || storedOperation.id !== operationId) {
    throw new PlatformUpdateValidationError('Update operation state does not match the runner.');
  }
  let operation: PlatformUpdateOperation = storedOperation;
  const transition = async (
    phase: PlatformUpdatePhase,
    message: string | null = null,
    errorCode: string | null = null,
  ): Promise<void> => {
    const latestOperation = await store.readOperation();
    operation = {
      ...(latestOperation?.id === operationId ? latestOperation : operation),
      phase,
      updatedAt: new Date().toISOString(),
      message,
      errorCode,
    };
    await store.writeOperation(operation);
  };

  let backupComplete = false;
  let environmentExisted = false;
  let filesChanged = false;
  let composeEnvironment: ComposeEnvironment | null = null;
  try {
    await transition('preparing');
    composeEnvironment = readComposeEnvironment(dependencies.environment ?? process.env);
    const targetCompose = await downloadTargetCompose(input, fetchImpl);
    await transition('backing_up');
    const backup = await backupInstallation(input, store, docker);
    backupComplete = true;
    environmentExisted = backup.environmentExisted;

    await transition('pulling');
    const targetReference = `${input.targetImage}@${input.targetDigest}`;
    await docker.pullImage(targetReference);
    const targetImage = await docker.inspectImage(targetReference);
    if (!targetImage.RepoDigests.some((digest) => digest.endsWith(`@${input.targetDigest}`))) {
      throw new PlatformUpdateValidationError(
        'The pulled image digest does not match the release.',
      );
    }

    const environmentPath = join(input.workingDirectory, '.env');
    const currentEnvironment = environmentExisted ? await readFile(environmentPath, 'utf8') : '';
    await writeFileAtomic(
      environmentPath,
      persistOpenLanderComposeEnvironment(currentEnvironment, targetReference, composeEnvironment),
      0o600,
    );
    filesChanged = true;
    await writeFileAtomic(input.composeFiles[0] ?? '', targetCompose, 0o644);
    await runCompose(input, ['config', '--quiet'], commandRunner);

    await transition('restarting');
    await runCompose(
      input,
      ['up', '-d', '--no-deps', '--force-recreate', input.composeService],
      commandRunner,
    );
    await transition('verifying');
    await waitForVersion(input, store, input.targetVersion, true, fetchImpl, healthTimeoutMs);
    const retentionWarning = await pruneOldBackupsForTerminalState(store, operationId);
    await transition('completed', retentionWarning);
  } catch (error) {
    log.error({ error, operationId }, 'Platform update runner failed');
    const failureCode = publicFailureCode(error);
    if (backupComplete && filesChanged) {
      try {
        await transition(
          'rolling_back',
          'Update verification failed; restoring the previous version.',
          failureCode,
        );
        if (!composeEnvironment) {
          throw new PlatformUpdateValidationError(
            'The current Compose environment is unavailable for rollback.',
          );
        }
        await restoreInstallation(input, store, environmentExisted, composeEnvironment);
        await runCompose(input, ['config', '--quiet'], commandRunner);
        await runCompose(
          input,
          ['up', '-d', '--no-deps', '--force-recreate', input.composeService],
          commandRunner,
        );
        await waitForVersion(input, store, input.sourceVersion, true, fetchImpl, healthTimeoutMs);
        const retentionWarning = await pruneOldBackupsForTerminalState(store, operationId);
        await transition(
          'rolled_back',
          [
            'The previous version was restored. Review the update error before retrying.',
            retentionWarning,
          ]
            .filter(Boolean)
            .join(' '),
          failureCode,
        );
        return;
      } catch (rollbackError) {
        log.error({ rollbackError, operationId }, 'Platform update rollback failed');
        await transition(
          'failed',
          'The update and automatic rollback both failed. Manual recovery is required.',
          'UPDATE_ROLLBACK_FAILED',
        );
        return;
      }
    }
    await transition('failed', 'The update stopped before OpenLander was replaced.', failureCode);
  }
}
