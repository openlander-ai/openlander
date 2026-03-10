import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import '@xterm/xterm/css/xterm.css';

interface TerminalPanelProps {
  projectId: string;
  isActive: boolean;
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export function TerminalPanel({ projectId, isActive }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    if (!isActive || !containerRef.current) return;

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
  }, [projectId, isActive, reconnectKey]);

  if (!isActive) {
    return (
      <div className="h-full bg-[#0a0a0a] rounded-lg overflow-hidden flex items-center justify-center">
        <div className="text-muted-ol font-mono text-sm">Container not running</div>
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
        return 'Connected';
      case 'connecting':
        return 'Connecting...';
      case 'error':
        return 'Error';
      case 'disconnected':
        return 'Disconnected';
      default:
        return 'Unknown';
    }
  };

  return (
    <div className="h-full bg-[#0a0a0a] rounded-lg overflow-hidden relative">
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 bg-bg-panel/80 backdrop-blur-sm border border-[hsl(var(--border))] rounded-md px-2 py-1 text-xs font-mono text-secondary-ol">
        <span className={cn('w-2 h-2 rounded-full', getStatusColor())} />
        <span>{getStatusText()}</span>
        {(connectionState === 'disconnected' || connectionState === 'error') && (
          <button
            onClick={() => setReconnectKey((k) => k + 1)}
            className="ml-1 p-1 hover:bg-bg-subtle rounded text-muted-ol hover:text-primary-ol transition-colors"
            title="Reconnect"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
      </div>

      <div ref={containerRef} className="h-full p-2" />
    </div>
  );
}
