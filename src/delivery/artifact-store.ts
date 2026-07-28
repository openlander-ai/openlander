import { createHash, randomUUID } from 'node:crypto';
import {
  constants,
  createReadStream,
  createWriteStream,
  promises as fs,
  type ReadStream,
} from 'node:fs';
import { basename, extname, join, resolve, sep } from 'node:path';
import { once } from 'node:events';
import { Readable } from 'node:stream';
import { PDFDocument } from 'pdf-lib';
import { getDataDir } from '../config/index.js';
import { ArtifactValidationError } from '../errors.js';
import { MAX_ARTIFACT_BYTES } from './types.js';

const ALLOWED_MIME_TYPES = new Set([
  'text/html',
  'text/markdown',
  'application/pdf',
  'application/json',
  'application/xml',
  'text/xml',
  'application/junit+xml',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export interface StoredArtifact {
  sha256: string;
  mimeType: string;
  sizeBytes: number;
  storageKey: string;
}

export interface StoreArtifactOptions {
  filename: string;
  declaredMimeType?: string | null;
  maxBytes?: number;
}

function normalizedMime(value: string | null | undefined): string | null {
  if (!value) return null;
  const [mime] = value.toLowerCase().split(';', 1);
  return mime?.trim() || null;
}

export function validateArtifactMetadata(
  filenameValue: string,
  declaredMimeType?: string | null,
): { filename: string; mimeType: string } {
  const filename = basename(filenameValue);
  if (!filename || filename === '.' || filename === '..') {
    throw new ArtifactValidationError('A valid display filename is required.');
  }

  const extensionMime = MIME_BY_EXTENSION[extname(filename).toLowerCase()] ?? null;
  const declaredMime = normalizedMime(declaredMimeType);
  const mimeType = declaredMime ?? extensionMime;
  if (!mimeType || !ALLOWED_MIME_TYPES.has(mimeType)) {
    throw new ArtifactValidationError('Artifact type is not allowed.', {
      filename,
      declaredMimeType: declaredMime,
    });
  }
  if (extensionMime && declaredMime && extensionMime !== declaredMime) {
    const xmlPair =
      extensionMime === 'application/xml' &&
      (declaredMime === 'text/xml' || declaredMime === 'application/junit+xml');
    if (!xmlPair) {
      throw new ArtifactValidationError('Artifact filename and MIME type do not match.', {
        filename,
        extensionMime,
        declaredMime,
      });
    }
  }
  return { filename, mimeType };
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'));
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function isWebp(bytes: Buffer): boolean {
  return (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}

function assertText(bytes: Buffer, mimeType: string): void {
  if (bytes.includes(0)) {
    throw new ArtifactValidationError('Text artifact contains binary null bytes.', { mimeType });
  }
}

async function validateStoredFile(path: string, mimeType: string, sample: Buffer): Promise<void> {
  if (mimeType === 'application/pdf') {
    if (!sample.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
      throw new ArtifactValidationError('Uploaded PDF does not have a valid PDF signature.');
    }
    try {
      const bytes = await fs.readFile(path);
      await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    } catch (error) {
      throw new ArtifactValidationError('Uploaded PDF is corrupt or cannot be parsed.', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (mimeType === 'image/png' && !isPng(sample)) {
    throw new ArtifactValidationError('Uploaded PNG does not have a valid PNG signature.');
  }
  if (mimeType === 'image/jpeg' && !isJpeg(sample)) {
    throw new ArtifactValidationError('Uploaded JPEG does not have a valid JPEG signature.');
  }
  if (mimeType === 'image/webp' && !isWebp(sample)) {
    throw new ArtifactValidationError('Uploaded WebP does not have a valid WebP signature.');
  }

  if (mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('xml')) {
    assertText(sample, mimeType);
  }

  if (mimeType === 'application/json') {
    try {
      JSON.parse(await fs.readFile(path, 'utf8'));
    } catch (error) {
      throw new ArtifactValidationError('Uploaded JSON is not valid JSON.', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (
    (mimeType === 'application/xml' ||
      mimeType === 'text/xml' ||
      mimeType === 'application/junit+xml') &&
    !sample.toString('utf8').trimStart().startsWith('<')
  ) {
    throw new ArtifactValidationError('Uploaded XML does not have a valid XML document prefix.');
  }
}

export class ArtifactStore {
  readonly rootDir: string;
  private readonly tempDir: string;

  constructor(dataDir: string = getDataDir()) {
    this.rootDir = join(dataDir, 'artifacts');
    this.tempDir = join(this.rootDir, '.tmp');
  }

  async storeBuffer(buffer: Uint8Array, options: StoreArtifactOptions): Promise<StoredArtifact> {
    return await this.store(Readable.from([buffer]), options);
  }

  async store(
    source: AsyncIterable<Uint8Array>,
    options: StoreArtifactOptions,
  ): Promise<StoredArtifact> {
    const { mimeType } = validateArtifactMetadata(options.filename, options.declaredMimeType);

    const maxBytes = options.maxBytes ?? MAX_ARTIFACT_BYTES;
    await fs.mkdir(this.tempDir, { recursive: true, mode: 0o700 });
    const tempPath = join(this.tempDir, `${randomUUID()}.upload`);
    const output = createWriteStream(tempPath, { flags: 'wx', mode: 0o600 });
    const hash = createHash('sha256');
    const sampleChunks: Buffer[] = [];
    let sampleBytes = 0;
    let sizeBytes = 0;

    try {
      for await (const sourceChunk of source) {
        const chunk = Buffer.from(sourceChunk);
        sizeBytes += chunk.length;
        if (sizeBytes > maxBytes) {
          throw new ArtifactValidationError('Artifact exceeds the configured size limit.', {
            maxBytes,
          });
        }
        hash.update(chunk);
        if (sampleBytes < 8192) {
          const sampleChunk = chunk.subarray(0, 8192 - sampleBytes);
          sampleChunks.push(sampleChunk);
          sampleBytes += sampleChunk.length;
        }
        if (!output.write(chunk)) {
          await once(output, 'drain');
        }
      }
      output.end();
      await once(output, 'close');

      if (sizeBytes === 0) {
        throw new ArtifactValidationError('Empty artifacts are not allowed.');
      }

      const sample = Buffer.concat(sampleChunks);
      await validateStoredFile(tempPath, mimeType, sample);

      const sha256 = hash.digest('hex');
      const storageKey = `sha256/${sha256.slice(0, 2)}/${sha256}`;
      const finalPath = this.resolveStorageKey(storageKey);
      await fs.mkdir(resolve(finalPath, '..'), { recursive: true, mode: 0o700 });
      try {
        await fs.link(tempPath, finalPath);
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? String(error.code)
            : null;
        if (code !== 'EEXIST') throw error;
      }
      await fs.unlink(tempPath);
      return { sha256, mimeType, sizeBytes, storageKey };
    } catch (error) {
      output.destroy();
      await fs.unlink(tempPath).catch(() => undefined);
      if (error instanceof ArtifactValidationError) throw error;
      throw new ArtifactValidationError('Artifact could not be stored.', {
        cause: error instanceof Error ? error.message : String(error),
      });
    }
  }

  resolveStorageKey(storageKey: string): string {
    if (!/^sha256\/[0-9a-f]{2}\/[0-9a-f]{64}$/.test(storageKey)) {
      throw new ArtifactValidationError('Artifact storage key is invalid.');
    }
    const path = resolve(this.rootDir, storageKey);
    const root = resolve(this.rootDir) + sep;
    if (!path.startsWith(root)) {
      throw new ArtifactValidationError('Artifact storage key escapes the artifact root.');
    }
    return path;
  }

  open(storageKey: string): ReadStream {
    return createReadStream(this.resolveStorageKey(storageKey));
  }

  async read(storageKey: string): Promise<Buffer> {
    return await fs.readFile(this.resolveStorageKey(storageKey));
  }

  async exists(storageKey: string): Promise<boolean> {
    try {
      await fs.access(this.resolveStorageKey(storageKey), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
}
