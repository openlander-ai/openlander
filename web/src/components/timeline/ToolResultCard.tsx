import type { FC } from 'react';
import type { TimelineItem } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import { formatTime } from '@/lib/time';
import {
  CheckCircle2,
  LayoutList,
  ScrollText,
  Activity,
  KeyRound,
  Wrench,
  ExternalLink,
  RotateCcw,
  Layers,
} from 'lucide-react';
import { ErrorAnalysisCard } from './ErrorAnalysisCard';

interface ToolResultCardProps {
  item: TimelineItem;
}

// Secret masking logic
const REDACTED_KEYS = ['password', 'secret', 'token', 'key', 'credential'];

function maskSecrets(obj: unknown): unknown {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(maskSecrets);

  const masked: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const lowerKey = k.toLowerCase();
    if (lowerKey === 'env_vars' || lowerKey === 'envvars' || lowerKey === 'environment_variables') {
      if (typeof v === 'object' && v !== null) {
        const envMasked: Record<string, string> = {};
        for (const envKey of Object.keys(v as Record<string, unknown>)) {
          envMasked[envKey] = '***';
        }
        masked[k] = envMasked;
      } else {
        masked[k] = '***';
      }
    } else if (REDACTED_KEYS.some((rk) => lowerKey.includes(rk))) {
      masked[k] = '[redacted]';
    } else {
      masked[k] = maskSecrets(v);
    }
  }
  return masked;
}

function StatusBadge({ status }: { status: string }) {
  const isUp =
    status.toLowerCase() === 'running' ||
    status.toLowerCase() === 'up' ||
    status.toLowerCase() === 'success';
  return (
    <span
      className={cn(
        'px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider',
        isUp ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
      )}
    >
      {status}
    </span>
  );
}

function DeployProjectResult({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-primary-ol">
          {typeof res.projectName === 'string' ? res.projectName : 'Unknown'}
        </span>
        {typeof res.status === 'string' && <StatusBadge status={res.status} />}
      </div>
      {typeof res.url === 'string' && (
        <a
          href={res.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-agent/10 border border-agent/20 text-xs font-mono text-agent hover:bg-agent/20 transition-colors w-fit"
        >
          <ExternalLink className="h-3 w-3" />
          {res.url.replace(/^https?:\/\//, '')}
        </a>
      )}
      {typeof res.port === 'number' && (
        <div className="text-xs text-secondary-ol">Port: {res.port}</div>
      )}
    </div>
  );
}

function DeployComposeResult({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  const services = Array.isArray(res.services) ? res.services : [];

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-primary-ol">
          {typeof res.parentName === 'string' ? res.parentName : 'Compose Project'}
        </span>
        {typeof res.success === 'boolean' && (
          <StatusBadge status={res.success ? 'running' : 'error'} />
        )}
      </div>
      {services.length > 0 && (
        <div className="mt-1 border border-white/10 rounded-md overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-white/5 text-secondary-ol">
              <tr>
                <th className="px-3 py-1.5 font-medium">Service</th>
                <th className="px-3 py-1.5 font-medium">Container</th>
                <th className="px-3 py-1.5 font-medium">Status</th>
                <th className="px-3 py-1.5 font-medium">Ports</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {services.map((service, i: number) => {
                const entry =
                  typeof service === 'object' && service !== null
                    ? (service as Record<string, unknown>)
                    : {};
                const name = typeof entry.name === 'string' ? entry.name : '-';
                const container = typeof entry.container === 'string' ? entry.container : '-';
                const status = typeof entry.status === 'string' ? entry.status : null;
                const ports = Array.isArray(entry.ports)
                  ? entry.ports.filter(
                      (port): port is string | number =>
                        typeof port === 'string' || typeof port === 'number',
                    )
                  : [];

                return (
                  <tr key={i} className="text-primary-ol">
                    <td className="px-3 py-1.5">{name}</td>
                    <td className="px-3 py-1.5 font-mono text-[10px] text-muted-ol">{container}</td>
                    <td className="px-3 py-1.5">
                      {status ? <StatusBadge status={status} /> : '-'}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-[10px]">
                      {ports.length > 0 ? ports.join(', ') : '-'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RollbackProjectResult({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-primary-ol">
          {typeof res.projectName === 'string' ? res.projectName : 'Unknown'}
        </span>
        {typeof res.success === 'boolean' && (
          <StatusBadge status={res.success ? 'success' : 'failed'} />
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-secondary-ol bg-bg-app/50 p-2 rounded-md border border-white/5">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-ol">From</span>
          <span className="font-mono text-error/80">
            {typeof res.previousImageTag === 'string'
              ? res.previousImageTag.slice(0, 7)
              : 'unknown'}
          </span>
        </div>
        <span className="text-muted-ol">→</span>
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-wider text-muted-ol">To</span>
          <span className="font-mono text-success/80">
            {typeof res.commitSha === 'string' ? res.commitSha.slice(0, 7) : 'unknown'}
          </span>
        </div>
      </div>

      {typeof res.url === 'string' && (
        <a
          href={res.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-agent/10 border border-agent/20 text-xs font-mono text-agent hover:bg-agent/20 transition-colors w-fit"
        >
          <ExternalLink className="h-3 w-3" />
          {res.url.replace(/^https?:\/\//, '')}
        </a>
      )}
    </div>
  );
}

function FixDockerfileResult({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  const changes = Array.isArray(res.changes) ? res.changes : [];
  const before = typeof res.before === 'string' ? res.before : '';
  const after = typeof res.after === 'string' ? res.after : '';

  return (
    <div className="mt-2 flex flex-col gap-3">
      {typeof res.explanation === 'string' && (
        <p className="text-sm font-body text-primary-ol leading-relaxed">{res.explanation}</p>
      )}

      {changes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-mono text-agent/80 uppercase tracking-wider">Changes</p>
          <ul className="space-y-1">
            {changes.map((change: unknown, i: number) => (
              <li key={i} className="text-xs text-secondary-ol flex items-start gap-1.5">
                <span className="text-agent mt-0.5">•</span>
                <span>{String(change)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(before || after) && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-mono text-agent/80 uppercase tracking-wider">Diff</p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {before && (
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-error/80 px-1.5 py-0.5 bg-error/10 rounded">
                  Before
                </span>
                <pre className="text-[11px] font-mono text-error/90 bg-error/5 p-2.5 rounded border border-error/10 overflow-x-auto whitespace-pre-wrap break-all max-h-48">
                  {before}
                </pre>
              </div>
            )}
            {after && (
              <div className="space-y-1">
                <span className="text-[10px] font-mono text-success/80 px-1.5 py-0.5 bg-success/10 rounded">
                  After
                </span>
                <pre className="text-[11px] font-mono text-success/90 bg-success/5 p-2.5 rounded border border-success/10 overflow-x-auto whitespace-pre-wrap break-all max-h-48">
                  {after}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {typeof res.dockerfileContent === 'string' && !after && (
        <details className="mt-1 group/df">
          <summary className="text-[11px] font-mono text-agent/70 cursor-pointer hover:text-agent transition-colors select-none">
            View Dockerfile ▾
          </summary>
          <pre className="mt-1.5 text-[10px] font-mono text-muted-ol bg-[#0a0a0a] border border-agent/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
            {res.dockerfileContent}
          </pre>
        </details>
      )}
    </div>
  );
}

function ListProjectsResult({ result }: { result: unknown }) {
  if (!Array.isArray(result)) return <FallbackResult result={result} />;
  const maxRows = 5;
  const displayRows = result.slice(0, maxRows);
  const remaining = result.length - maxRows;

  return (
    <div className="mt-2">
      <div className="border border-white/10 rounded-md overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-white/5 text-secondary-ol">
            <tr>
              <th className="px-3 py-1.5 font-medium">Name</th>
              <th className="px-3 py-1.5 font-medium">Status</th>
              <th className="px-3 py-1.5 font-medium">URL</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {displayRows.map((p: unknown, i: number) => {
              const proj = (typeof p === 'object' && p !== null ? p : {}) as Record<
                string,
                unknown
              >;
              const name =
                typeof proj.name === 'string'
                  ? proj.name
                  : typeof proj.projectName === 'string'
                    ? proj.projectName
                    : '-';
              const status = typeof proj.status === 'string' ? proj.status : null;
              const url = typeof proj.url === 'string' ? proj.url : null;

              return (
                <tr key={i} className="text-primary-ol">
                  <td className="px-3 py-1.5">{name}</td>
                  <td className="px-3 py-1.5">{status ? <StatusBadge status={status} /> : '-'}</td>
                  <td className="px-3 py-1.5">
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-agent hover:underline"
                      >
                        Link
                      </a>
                    ) : (
                      '-'
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {remaining > 0 && (
        <div className="mt-1.5 text-[11px] text-secondary-ol text-center">
          +{remaining} more projects
        </div>
      )}
    </div>
  );
}

function GetLogsResult({ result }: { result: unknown }) {
  let logs = '';
  if (typeof result === 'string') {
    logs = result;
  } else if (typeof result === 'object' && result !== null) {
    const res = result as Record<string, unknown>;
    logs = typeof res.logs === 'string' ? res.logs : JSON.stringify(result, null, 2);
  } else {
    logs = String(result);
  }

  const displayLogs = logs.length > 500 ? logs.slice(-500) : logs;

  return (
    <details className="mt-2 group/log">
      <summary className="text-[11px] font-mono text-agent/70 cursor-pointer hover:text-agent transition-colors select-none">
        View logs ▾
      </summary>
      <pre className="mt-1.5 text-[10px] font-mono text-muted-ol bg-[#0a0a0a] border border-agent/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
        {displayLogs}
      </pre>
    </details>
  );
}

function StatBar({
  label,
  percent,
  colorClass,
}: {
  label: string;
  percent: number;
  colorClass: string;
}) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-12 text-secondary-ol">{label}</span>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full', colorClass)}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="w-8 text-right text-primary-ol font-mono">{Math.round(percent)}%</span>
    </div>
  );
}

function GetSystemStatsResult({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  // Try to extract percentages, fallback to 0
  const cpu = Number(res.cpu) || Number(res.cpuPercent) || 0;
  const mem = Number(res.memory) || Number(res.memoryPercent) || 0;
  const disk = Number(res.disk) || Number(res.diskPercent) || 0;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <StatBar label="CPU" percent={cpu} colorClass="bg-agent" />
      <StatBar label="Memory" percent={mem} colorClass="bg-success" />
      <StatBar label="Disk" percent={disk} colorClass="bg-warning" />
    </div>
  );
}

function SetEnvVarsResult({ result }: { result: unknown }) {
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  // Extract keys that were set
  let keys: string[] = [];
  if (Array.isArray(res.keys)) {
    keys = res.keys.filter((k): k is string => typeof k === 'string');
  } else {
    keys = Object.keys(res).filter((k) => k !== 'success' && k !== 'message');
  }

  if (keys.length === 0) {
    return <div className="mt-2 text-xs text-secondary-ol">Environment variables updated.</div>;
  }

  return (
    <div className="mt-2">
      <div className="text-xs text-secondary-ol mb-1.5">Updated keys:</div>
      <div className="flex flex-wrap gap-1.5">
        {keys.map((key, i) => (
          <div
            key={i}
            className="px-2 py-1 rounded bg-white/5 border border-white/10 text-[11px] font-mono text-primary-ol flex items-center gap-1.5"
          >
            <span>{key}</span>
            <span className="text-muted-ol">***</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FallbackResult({ result }: { result: unknown }) {
  const masked = maskSecrets(result);
  return (
    <details className="mt-2 group/json">
      <summary className="text-[11px] font-mono text-agent/70 cursor-pointer hover:text-agent transition-colors select-none">
        View result ▾
      </summary>
      <pre className="mt-1.5 text-[10px] font-mono text-muted-ol bg-[#0a0a0a] border border-agent/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
        {JSON.stringify(masked, null, 2)}
      </pre>
    </details>
  );
}

export function ToolResultCard({ item }: ToolResultCardProps) {
  const isSuccess = item.toolSuccess !== false; // Default to true if undefined
  const toolName = item.toolName || 'unknown_tool';

  if (toolName === 'debug_build_error') {
    return <ErrorAnalysisCard item={item} />;
  }

  const bgClass = isSuccess ? 'bg-agent/5' : 'bg-error/5';
  const borderClass = isSuccess ? 'border-agent/10' : 'border-error/10';
  const iconColorClass = isSuccess ? 'text-agent' : 'text-error';
  const iconBgClass = isSuccess ? 'bg-agent/10' : 'bg-error/10';

  let Icon = Wrench;
  let Renderer: FC<{ result: unknown }> = FallbackResult;

  switch (toolName) {
    case 'deploy_project':
      Icon = CheckCircle2;
      Renderer = DeployProjectResult;
      break;
    case 'deploy_compose':
      Icon = Layers;
      Renderer = DeployComposeResult;
      break;
    case 'rollback_project':
      Icon = RotateCcw;
      Renderer = RollbackProjectResult;
      break;
    case 'fix_dockerfile':
      Icon = Wrench;
      Renderer = FixDockerfileResult;
      break;
    case 'list_projects':
      Icon = LayoutList;
      Renderer = ListProjectsResult;
      break;
    case 'get_logs':
      Icon = ScrollText;
      Renderer = GetLogsResult;
      break;
    case 'get_system_stats':
      Icon = Activity;
      Renderer = GetSystemStatsResult;
      break;
    case 'set_env_vars':
      Icon = KeyRound;
      Renderer = SetEnvVarsResult;
      break;
  }

  if (!isSuccess) {
    Icon = Wrench; // Override icon for errors
  }

  return (
    <div
      className={cn(
        'relative flex gap-3 py-3 px-4 rounded-lg border transition-all duration-300',
        'animate-in fade-in slide-in-from-bottom-2',
        bgClass,
        borderClass,
      )}
    >
      {/* Icon */}
      <div className="shrink-0 mt-0.5">
        <div className={cn('p-1.5 rounded-md', iconBgClass)}>
          <Icon className={cn('h-3.5 w-3.5', iconColorClass)} />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <p
            className={cn(
              'text-sm font-medium font-body leading-snug',
              isSuccess ? 'text-agent/90' : 'text-error',
            )}
          >
            {item.title || `${toolName} result`}
          </p>
          <span className="text-[10px] font-mono text-muted-ol shrink-0 mt-0.5">
            {formatTime(item.timestamp)}
          </span>
        </div>

        {!isSuccess && item.toolError && (
          <p className="mt-1 text-xs font-mono text-error/80 whitespace-pre-wrap break-all">
            {item.toolError}
          </p>
        )}

        {isSuccess && item.toolResult !== undefined && item.toolResult !== null ? (
          <Renderer result={item.toolResult} />
        ) : null}
      </div>
    </div>
  );
}
