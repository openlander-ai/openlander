import type { NodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import type { Duplex } from 'node:stream';

import type { AppContext } from '../../app.js';
import { AuthService } from '../../auth/auth-service.js';
import { createModuleLogger } from '../../lib/logger.js';
import { parseCookie } from '../middleware/cookies.js';
import { getProjectOrThrow } from './helpers/project-helpers.js';

const log = createModuleLogger('terminal');

type TerminalExec = {
  resize: (opts: { w: number; h: number }) => Promise<void>;
};

export function createTerminalRoutes(
  ctx: AppContext,
  upgradeWebSocket?: NodeWebSocket['upgradeWebSocket'],
): Hono {
  const api = new Hono();
  const authService = new AuthService(ctx.db);
  const sessions = new WeakMap<
    object,
    {
      stream: Duplex;
      exec: TerminalExec;
      projectId: string;
      idleTimer: NodeJS.Timeout;
      messageCount: number;
      rateResetTimer: ReturnType<typeof setInterval>;
    }
  >();

  const MAX_MESSAGE_BYTES = 4096;
  const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

  const closeWithError = (
    ws: { send: (data: string) => void; close: () => void },
    message: string,
  ): void => {
    ws.send(JSON.stringify({ type: 'error', message }));
    ws.close();
  };

  const clearSession = (ws: object): void => {
    const session = sessions.get(ws);
    if (!session) return;
    clearTimeout(session.idleTimer);
    clearInterval(session.rateResetTimer);
    session.stream.destroy();
    sessions.delete(ws);
  };

  const toBuffer = (data: unknown): Buffer | null => {
    if (typeof data === 'string') return Buffer.from(data, 'utf8');
    if (Buffer.isBuffer(data)) return data;
    if (data instanceof ArrayBuffer) return Buffer.from(data);
    if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    return null;
  };

  if (!upgradeWebSocket) return api;

  api.get(
    '/projects/:id/terminal',
    upgradeWebSocket((c) => {
      const id = c.req.param('id') ?? '';
      return {
        onOpen(_evt, ws) {
          void (async () => {
            try {
              // Auth check: validate session cookie
              if (authService.isPasswordSet()) {
                const cookieHeader = c.req.header('cookie');
                const sessionToken = parseCookie(cookieHeader, 'ol_session');
                if (!sessionToken || !authService.validateSession(sessionToken)) {
                  closeWithError(ws, 'Unauthorized');
                  return;
                }
              }

              const originHeader = c.req.header('origin');
              const hostHeader = c.req.header('host');
              const serverHost = ctx.config.server.host.trim().toLowerCase();
              const isLocalhostServer =
                serverHost === 'localhost' || serverHost === '127.0.0.1' || serverHost === '::1';

              if (!isLocalhostServer) {
                if (!originHeader || !hostHeader) {
                  closeWithError(ws, 'Forbidden');
                  return;
                }
                let originHost: string;
                try {
                  originHost = new URL(originHeader).host.toLowerCase();
                } catch (_err) {
                  closeWithError(ws, 'Forbidden');
                  return;
                }
                if (originHost !== hostHeader.toLowerCase()) {
                  closeWithError(ws, 'Forbidden');
                  return;
                }
              }

              const project = getProjectOrThrow(c, ctx);

              // PR 4 canonical-first: container_id + status from the
              // deployable services row when available; fall back to
              // legacy projects columns through migration 0012.
              const deployable = ctx.db.getDeployableForProject(project.id);
              const status = deployable?.status ?? project.status;
              const projectContainerId = deployable?.container_id ?? project.container_id;
              if (!projectContainerId || status !== 'running') {
                closeWithError(ws, 'Container is not running');
                return;
              }

              const containerId = projectContainerId;
              const containerInfo = await ctx.docker.inspectContainer(containerId);
              if (!containerInfo.State.Running) {
                closeWithError(ws, 'Container is not running');
                return;
              }

              const probeShell = async (shell: string): Promise<boolean> => {
                try {
                  const result = await ctx.docker.execSimple(containerId, [shell, '-c', 'exit 0']);
                  return result.exitCode === 0;
                } catch (_err) {
                  return false;
                }
              };

              const shellCmd = (await probeShell('/bin/bash'))
                ? '/bin/bash'
                : (await probeShell('/bin/sh'))
                  ? '/bin/sh'
                  : null;

              if (!shellCmd) {
                closeWithError(
                  ws,
                  'No shell available (/bin/bash and /bin/sh not found). This container may be a distroless image.',
                );
                return;
              }

              const terminal = await ctx.docker.execTerminal(containerId, [shellCmd]);
              const exec: TerminalExec = terminal;
              const stream = terminal.stream as unknown as Duplex;

              const idleTimer = setTimeout(() => {
                ws.send(JSON.stringify({ type: 'error', message: 'Terminal idle timeout (30m)' }));
                ws.close();
              }, IDLE_TIMEOUT_MS);

              const rateResetTimer = setInterval(() => {
                const s = sessions.get(ws);
                if (s) s.messageCount = 0;
              }, 1000);

              sessions.set(ws, {
                stream,
                exec,
                projectId: project.id,
                idleTimer,
                messageCount: 0,
                rateResetTimer,
              });

              log.info({ projectId: project.id }, 'Terminal session opened');

              stream.on('data', (data: Buffer) => {
                ws.send(new Uint8Array(data));
              });
              stream.on('error', () => {
                ws.close();
              });
              stream.on('close', () => {
                ws.close();
              });
            } catch (err) {
              log.debug({ err, projectId: id }, 'Failed to open terminal session');
              closeWithError(ws, 'Failed to open terminal session');
            }
          })();
        },
        onMessage(evt, ws) {
          const session = sessions.get(ws);
          if (!session) return;

          session.messageCount += 1;
          if (session.messageCount > 100) {
            closeWithError(ws, 'Rate limit exceeded');
            return;
          }

          const payload = toBuffer((evt as { data: unknown }).data);
          if (!payload) return;
          if (payload.byteLength > MAX_MESSAGE_BYTES) return;

          clearTimeout(session.idleTimer);
          session.idleTimer = setTimeout(() => {
            ws.send(JSON.stringify({ type: 'error', message: 'Terminal idle timeout (30m)' }));
            ws.close();
          }, IDLE_TIMEOUT_MS);

          const text = payload.toString('utf8');
          try {
            const parsed = JSON.parse(text) as Record<string, unknown>;
            if (parsed['type'] === 'resize') {
              const cols = parsed['cols'];
              const rows = parsed['rows'];
              if (typeof cols === 'number' && typeof rows === 'number') {
                void session.exec.resize({ w: cols, h: rows });
              }
              return;
            }
            if (parsed['type'] === 'input') {
              const input = parsed['data'];
              if (typeof input === 'string') session.stream.write(input);
              return;
            }
          } catch (err) {
            log.debug({ err, projectId: session.projectId }, 'Failed to parse WebSocket message');
            session.stream.write(payload);
            return;
          }
          session.stream.write(payload);
        },
        onClose(_evt, ws) {
          const session = sessions.get(ws);
          if (session) {
            log.info({ projectId: session.projectId }, 'Terminal session closed');
          }
          clearSession(ws);
        },
        onError(err, ws) {
          console.error('Terminal WebSocket error:', err);
          clearSession(ws);
        },
      };
    }),
  );

  return api;
}
