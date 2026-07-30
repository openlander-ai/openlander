import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { PlatformUpdateValidationError } from '../errors.js';
import {
  UPDATE_PHASES,
  type PlatformUpdateOperation,
  type PlatformUpdateRunnerInput,
} from './types.js';
import { parseSemVer } from './semver.js';

const OPERATION_FILE = 'status.json';
const RUNNER_INPUT_FILE = 'runner-input.json';

export interface PlatformUpdateStartupValidation {
  version: string;
  ok: boolean;
  checkedAt: string;
  message: string;
}

function operationIsValid(value: unknown): value is PlatformUpdateOperation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.sourceVersion === 'string' &&
    typeof record.targetVersion === 'string' &&
    typeof record.phase === 'string' &&
    UPDATE_PHASES.includes(record.phase as PlatformUpdateOperation['phase']) &&
    typeof record.startedAt === 'string' &&
    typeof record.updatedAt === 'string' &&
    (record.message === null || typeof record.message === 'string') &&
    (record.errorCode === null || typeof record.errorCode === 'string') &&
    (record.runnerContainerId === null || typeof record.runnerContainerId === 'string')
  );
}

function runnerInputIsValid(
  value: unknown,
  operationId: string,
): value is PlatformUpdateRunnerInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (
    record.operationId !== operationId ||
    typeof record.sourceVersion !== 'string' ||
    !parseSemVer(record.sourceVersion) ||
    typeof record.targetVersion !== 'string' ||
    !parseSemVer(record.targetVersion) ||
    typeof record.targetImage !== 'string' ||
    record.targetImage !== `ghcr.io/openlander-ai/openlander:${record.targetVersion}` ||
    typeof record.targetDigest !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(record.targetDigest) ||
    typeof record.targetComposeSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.targetComposeSha256) ||
    typeof record.sourceImage !== 'string' ||
    !record.sourceImage.startsWith('ghcr.io/openlander-ai/openlander:') ||
    typeof record.runnerImageId !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(record.runnerImageId) ||
    typeof record.composeProject !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(record.composeProject) ||
    record.composeService !== 'openlander' ||
    typeof record.workingDirectory !== 'string' ||
    !isAbsolute(record.workingDirectory) ||
    !Array.isArray(record.composeFiles) ||
    record.composeFiles.length !== 1 ||
    typeof record.composeFiles[0] !== 'string' ||
    !isAbsolute(record.composeFiles[0]) ||
    basename(record.composeFiles[0]) !== 'docker-compose.runtime.yml' ||
    resolve(record.composeFiles[0]) !==
      resolve(record.workingDirectory, 'docker-compose.runtime.yml') ||
    typeof record.dataVolumeName !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(record.dataVolumeName) ||
    typeof record.databaseContainerId !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.databaseContainerId) ||
    !Array.isArray(record.networkNames) ||
    record.networkNames.length === 0 ||
    !record.networkNames.every(
      (name) => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(name),
    )
  ) {
    return false;
  }
  return true;
}

export class PlatformUpdateStateStore {
  readonly updateRoot: string;

  constructor(dataDir: string) {
    this.updateRoot = join(dataDir, 'updates');
  }

  operationPath(): string {
    return join(this.updateRoot, OPERATION_FILE);
  }

  runnerInputPath(operationId: string): string {
    return join(this.updateRoot, operationId, RUNNER_INPUT_FILE);
  }

  backupDirectory(operationId: string): string {
    return join(this.updateRoot, operationId, 'backup');
  }

  validationPath(operationId: string): string {
    return join(this.updateRoot, operationId, 'startup-validation.json');
  }

  async readStartupValidation(
    operationId: string,
  ): Promise<PlatformUpdateStartupValidation | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.validationPath(operationId), 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const record = parsed as Record<string, unknown>;
      if (
        typeof record.version !== 'string' ||
        typeof record.ok !== 'boolean' ||
        typeof record.checkedAt !== 'string' ||
        typeof record.message !== 'string'
      ) {
        return null;
      }
      return {
        version: record.version,
        ok: record.ok,
        checkedAt: record.checkedAt,
        message: record.message,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async writeStartupValidation(
    operationId: string,
    validation: PlatformUpdateStartupValidation,
  ): Promise<void> {
    await this.writeJsonAtomic(this.validationPath(operationId), validation);
  }

  async readOperation(): Promise<PlatformUpdateOperation | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.operationPath(), 'utf8'));
      return operationIsValid(parsed) ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      if (error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async writeOperation(operation: PlatformUpdateOperation): Promise<void> {
    await this.writeJsonAtomic(this.operationPath(), operation);
  }

  async writeRunnerInput(input: PlatformUpdateRunnerInput): Promise<void> {
    await this.writeJsonAtomic(this.runnerInputPath(input.operationId), input);
  }

  async readRunnerInput(operationId: string): Promise<PlatformUpdateRunnerInput> {
    const path = this.runnerInputPath(operationId);
    try {
      const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
      if (!runnerInputIsValid(parsed, operationId)) {
        throw new PlatformUpdateValidationError('Update runner input is invalid.');
      }
      return parsed;
    } catch (error) {
      if (error instanceof PlatformUpdateValidationError) throw error;
      throw new PlatformUpdateValidationError('Update runner input could not be read.', {
        operationId,
      });
    }
  }

  async removeOperationDirectory(operationId: string): Promise<void> {
    await rm(join(this.updateRoot, operationId), { recursive: true, force: true });
  }

  private async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const tempPath = `${path}.${String(process.pid)}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await rename(tempPath, path);
  }
}

export async function recordPlatformUpdateStartupValidation(
  dataDir: string,
  version: string,
  ok: boolean,
  message: string,
): Promise<boolean> {
  const store = new PlatformUpdateStateStore(dataDir);
  const operation = await store.readOperation();
  if (!operation || operation.targetVersion !== version) return false;
  if (!['restarting', 'verifying', 'rolling_back'].includes(operation.phase)) return false;
  await store.writeStartupValidation(operation.id, {
    version,
    ok,
    checkedAt: new Date().toISOString(),
    message,
  });
  return true;
}
