import { describe, expect, it } from 'vitest';

import { parseProcNetTcpOutput } from '../../src/pipeline/port.js';

describe('Linux port scan /proc fallback', () => {
  it('extracts only listening ports from /proc/net/tcp output', () => {
    const output = [
      '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode',
      '   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 0',
      '   1: 00000000:0050 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 0',
      '   2: 00000000:1F91 00000000:0000 01 00000000:00000000 00:00000000 00000000 0 0 0',
      '',
    ].join('\n');

    expect(parseProcNetTcpOutput(output)).toEqual([8080, 80]);
  });
});
