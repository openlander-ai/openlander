import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { RefreshCw } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';
import { getTerminalAvailabilityState } from './terminalAvailability';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  projectId: string;
  isConsoleActive: boolean;
  projectStatus: string;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export function TerminalPanel({ projectId, isConsoleActive, projectStatus }: TerminalPanelProps) {
  const { t } = useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [reconnectKey, setReconnectKey] = useState(0);
  const availability = getTerminalAvailabilityState(projectStatus, isConsoleActive, t);

  useEffect(() => {
    if (!availability.canConnect || !containerRef.current) return;

    setConnectionState('connecting');

    const term = new Terminal({
      theme: {
        background: '#0a0a0a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
        selectionBackground: '#264f78',
      },
      fontFamily: 'ui-monospace, monospace',
      fontSize: 13,
      cursorBlink: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/api/projects/${projectId}/terminal`;
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    wsRef.current = ws;

    ws.onopen = () => {
      setConnectionState('connected');
      term.writeln('\x1b[32mConnected to container\x1b[0m');
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
    };

    ws.onmessage = (e) => {
      if (typeof e.data === 'string') {
        term.write(e.data);
      } else {
        term.write(new Uint8Array(e.data));
      }
    };

    ws.onclose = () => {
      setConnectionState('disconnected');
      term.writeln('\r\n\x1b[33mConnection closed\x1b[0m');
    };

    ws.onerror = () => {
      setConnectionState('error');
      term.writeln('\r\n\x1b[31mConnection error\x1b[0m');
    };

    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    const resizeObserver = new ResizeObserver(() => {
      if (fitAddonRef.current && termRef.current) {
        fitAddonRef.current.fit();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(
            JSON.stringify({
              type: 'resize',
              cols: termRef.current.cols,
              rows: termRef.current.rows,
            }),
          );
        }
      }
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
      ws.close();
      term.dispose();
      termRef.current = null;
      wsRef.current = null;
      fitAddonRef.current = null;
    };
  }, [availability.canConnect, projectId, reconnectKey]);

  if (!availability.canConnect) {
    return (
      <div className="h-full min-h-[14rem] bg-[#0a0a0a] rounded-lg overflow-hidden border border-[hsl(var(--border))]">
        <div className="flex h-full flex-col justify-center gap-3 px-5 py-6 text-sm">
          <span className="inline-flex w-fit rounded-full border border-[hsl(var(--border))] bg-bg-panel/60 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.18em] text-muted-ol">
            {availability.badge}
          </span>
          <div className="space-y-1.5">
            <p className="font-body text-primary-ol">{availability.title}</p>
            <p className="max-w-sm font-body text-xs leading-5 text-muted-ol">
              {availability.detail}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const getStatusColor = () => {
    switch (connectionState) {
      case 'connected':
        return 'bg-success';
      case 'connecting':
        return 'bg-warning animate-pulse';
      case 'error':
        return 'bg-error';
      case 'disconnected':
        return 'bg-muted-ol';
      default:
        return 'bg-muted-ol';
    }
  };

  const getStatusText = () => {
    switch (connectionState) {
      case 'connected':
        return t('logs.terminalConnected');
      case 'connecting':
        return t('logs.terminalConnecting');
      case 'error':
        return t('logs.terminalError');
      case 'disconnected':
        return t('logs.terminalDisconnected');
      default:
        return t('logs.terminalDisconnected');
    }
  };

  const getStatusBody = () => {
    switch (connectionState) {
      case 'connecting':
        return t('logs.terminalConnectingBody');
      case 'error':
        return t('logs.terminalErrorBody');
      case 'disconnected':
        return t('logs.terminalDisconnectedBody');
      default:
        return availability.detail;
    }
  };

  return (
    <div className="h-full bg-[#0a0a0a] rounded-lg overflow-hidden relative">
      <div className="absolute inset-x-2 top-2 z-10 flex items-start justify-between gap-3 rounded-md border border-[hsl(var(--border))] bg-bg-panel/80 px-3 py-2 backdrop-blur-sm">
        <div className="min-w-0">
          <p className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-ol">
            {availability.badge}
          </p>
          <p className="text-xs font-body text-primary-ol">{availability.detail}</p>
        </div>

        <div className="flex items-center gap-2 text-xs font-mono text-secondary-ol">
          <span className={cn('w-2 h-2 rounded-full', getStatusColor())} />
          <span>{getStatusText()}</span>
          {(connectionState === 'disconnected' || connectionState === 'error') && (
            <button
              onClick={() => setReconnectKey((k) => k + 1)}
              className="ml-1 p-1 hover:bg-bg-subtle rounded text-muted-ol hover:text-primary-ol transition-colors"
              title={t('logs.terminalReconnect')}
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {connectionState !== 'connected' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
          <div className="pointer-events-auto w-full max-w-sm rounded-lg border border-[hsl(var(--border))] bg-bg-panel/85 p-4 text-center shadow-lg backdrop-blur-sm">
            <p className="text-sm font-mono text-secondary-ol">{getStatusText()}</p>
            <p className="mt-2 text-xs font-body text-muted-ol">{getStatusBody()}</p>
            {(connectionState === 'disconnected' || connectionState === 'error') && (
              <button
                type="button"
                onClick={() => setReconnectKey((k) => k + 1)}
                className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-bg-subtle px-3 py-1.5 text-xs font-body text-primary-ol transition-colors hover:bg-bg-subtle/80"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t('logs.terminalReconnect')}
              </button>
            )}
          </div>
        </div>
      )}

      <div ref={containerRef} className="h-full px-2 pb-2 pt-14" />
    </div>
  );
}
