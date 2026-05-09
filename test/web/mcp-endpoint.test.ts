import { afterEach, describe, expect, it } from 'vitest';

import { getMcpEndpoint } from '../../web/src/lib/mcp-endpoint.js';

const originalWindow = globalThis.window;

function setWindowLocation(url: string): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      location: new URL(url),
    },
  });
}

describe('getMcpEndpoint', () => {
  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('uses same-origin MCP URLs for production and reverse-proxy pages', () => {
    setWindowLocation('https://openlander.example.com/projects/demo');

    expect(getMcpEndpoint()).toBe('https://openlander.example.com/mcp');
  });

  it('does not hard-code http when the current page uses https', () => {
    setWindowLocation('https://openlander.example.com:443/settings');

    expect(getMcpEndpoint()).toBe('https://openlander.example.com/mcp');
  });

  it('maps Vite localhost pages to the OpenLander backend port', () => {
    setWindowLocation('http://localhost:5173/mcp-server');

    expect(getMcpEndpoint()).toBe('http://localhost:10114/mcp');
  });
});
