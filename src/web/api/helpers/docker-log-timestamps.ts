export type RuntimeLogStream = 'stdout' | 'stderr';

export interface RuntimeLogEntry {
  line: string;
  stream: RuntimeLogStream;
  time: string;
}

const DOCKER_TIMESTAMP_RE =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})\s+(.*)$/;

function normalizeDockerTimestamp(
  base: string,
  fraction: string | undefined,
  zone: string,
): string {
  const millis = (fraction ?? '0').padEnd(3, '0').slice(0, 3);
  const parsed = new Date(`${base}.${millis}${zone}`);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function parseDockerTimestampedLine(
  rawLine: string,
  fallbackTime = new Date().toISOString(),
): { line: string; time: string } {
  const line = rawLine.trimEnd();
  const match = line.match(DOCKER_TIMESTAMP_RE);
  if (!match) {
    return { line, time: fallbackTime };
  }

  const [, base, fraction, zone, message] = match;
  return {
    line: message ?? '',
    time: normalizeDockerTimestamp(base ?? '', fraction, zone ?? 'Z'),
  };
}

function hasDockerStreamHeader(chunk: Buffer): boolean {
  return (
    chunk.length >= 8 &&
    chunk[0] !== undefined &&
    chunk[0] >= 1 &&
    chunk[0] <= 3 &&
    chunk[1] === 0 &&
    chunk[2] === 0 &&
    chunk[3] === 0
  );
}

export function parseDockerLogChunk(chunk: Buffer): RuntimeLogEntry[] {
  const streamType: RuntimeLogStream = chunk[0] === 2 ? 'stderr' : 'stdout';
  const payload = hasDockerStreamHeader(chunk) ? chunk.subarray(8) : chunk;
  const now = new Date().toISOString();

  return payload
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => parseDockerTimestampedLine(line, now))
    .filter((entry) => entry.line.trim().length > 0)
    .map((entry) => ({ ...entry, stream: streamType }));
}
