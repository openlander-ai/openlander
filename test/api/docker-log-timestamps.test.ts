import { describe, expect, it } from 'vitest';

import {
  parseDockerLogChunk,
  parseDockerTimestampedLine,
} from '../../src/web/api/helpers/docker-log-timestamps.js';

function dockerFrame(streamType: 1 | 2, payload: string): Buffer {
  const body = Buffer.from(payload, 'utf8');
  const frame = Buffer.alloc(8 + body.length);
  frame[0] = streamType;
  frame.writeUInt32BE(body.length, 4);
  body.copy(frame, 8);
  return frame;
}

describe('docker log timestamp helpers', () => {
  it('extracts Docker RFC3339Nano timestamps without keeping them in the message', () => {
    expect(
      parseDockerTimestampedLine('2026-05-08T22:17:23.351234567Z container started'),
    ).toEqual({
      line: 'container started',
      time: '2026-05-08T22:17:23.351Z',
    });
  });

  it('parses multiplexed Docker log stream chunks with original timestamps', () => {
    expect(
      parseDockerLogChunk(
        dockerFrame(
          2,
          '2026-05-08T22:17:23.351234567Z err line\n2026-05-08T22:17:24Z next\n',
        ),
      ),
    ).toEqual([
      { line: 'err line', stream: 'stderr', time: '2026-05-08T22:17:23.351Z' },
      { line: 'next', stream: 'stderr', time: '2026-05-08T22:17:24.000Z' },
    ]);
  });
});
