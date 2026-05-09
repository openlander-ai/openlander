import { vi } from 'vitest';

import './setup.js';

// Release gate must run in restricted CI/sandbox environments where libuv
// uptime can be denied (EPERM). Keep product code untouched and make only the
// release test runtime deterministic.
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return {
    ...actual,
    uptime: vi.fn(() => 3600),
  };
});
