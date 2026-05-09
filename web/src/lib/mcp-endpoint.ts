const LOCAL_DEV_MCP_PORT = '10114';
const VITE_DEV_PORTS = new Set(['5173', '5174', '4173']);

export function getMcpEndpoint(): string {
  if (typeof window === 'undefined') {
    return `http://localhost:${LOCAL_DEV_MCP_PORT}/mcp`;
  }

  const { hostname, origin, port, protocol } = window.location;
  const isLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';

  if (isLocalhost && VITE_DEV_PORTS.has(port)) {
    return `${protocol}//${hostname}:${LOCAL_DEV_MCP_PORT}/mcp`;
  }

  return `${origin}/mcp`;
}
