import type { FC } from 'react';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';
import { ExternalLink } from 'lucide-react';

// Secret masking logic
const REDACTED_KEYS = ['password', 'secret', 'token', 'key', 'credential'];

export function maskSecrets(obj: unknown): unknown {
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

export function StatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const normalizedStatus = status.toLowerCase();
  const translatedStatus: Record<string, string> = {
    running: t('toolResults.statusValue.running'),
    up: t('toolResults.statusValue.up'),
    success: t('toolResults.statusValue.success'),
    failed: t('toolResults.statusValue.failed'),
    error: t('toolResults.statusValue.error'),
    healthy: t('toolResults.statusValue.healthy'),
    unhealthy: t('toolResults.statusValue.unhealthy'),
    ready: t('toolResults.statusValue.ready'),
    completed: t('toolResults.statusValue.completed'),
    stopped: t('toolResults.statusValue.stopped'),
    starting: t('toolResults.statusValue.starting'),
    stopping: t('toolResults.statusValue.stopping'),
    building: t('toolResults.statusValue.building'),
    deploying: t('toolResults.statusValue.deploying'),
    pending: t('toolResults.statusValue.pending'),
    cancelled: t('toolResults.statusValue.cancelled'),
    unknown: t('toolResults.statusValue.unknown'),
  };
  const label = translatedStatus[normalizedStatus] ?? t('toolResults.statusValue.unknown');
  const isUp = ['running', 'up', 'success', 'healthy', 'ready', 'completed'].includes(
    normalizedStatus,
  );
  const isFailure = ['failed', 'error', 'unhealthy', 'cancelled'].includes(normalizedStatus);
  return (
    <span
      title={translatedStatus[normalizedStatus] ? undefined : status}
      className={cn(
        'px-1.5 py-0.5 rounded text-xs font-medium uppercase tracking-wider',
        isUp
          ? 'bg-success/10 text-success'
          : isFailure
            ? 'bg-error/10 text-error'
            : 'bg-bg-subtle text-muted-foreground',
      )}
    >
      {label}
    </span>
  );
}

export function DeployProjectResult({ result }: { result: unknown }) {
  const { t } = useLanguage();
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {typeof res.projectName === 'string' ? res.projectName : t('toolResults.unknown')}
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
        <div className="text-xs text-foreground/80">
          {t('toolResults.port')}: {res.port}
        </div>
      )}
    </div>
  );
}

export function DeployComposeResult({ result }: { result: unknown }) {
  const { t } = useLanguage();
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  const services = Array.isArray(res.services) ? res.services : [];

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {typeof res.parentName === 'string' ? res.parentName : t('toolResults.composeProject')}
        </span>
        {typeof res.success === 'boolean' && (
          <StatusBadge status={res.success ? 'running' : 'error'} />
        )}
      </div>
      {services.length > 0 && (
        <div className="mt-1 border border-border rounded-md overflow-hidden">
          <table className="w-full text-left text-xs">
            <thead className="bg-bg-subtle text-foreground/80">
              <tr>
                <th className="px-3 py-1.5 font-medium">{t('toolResults.service')}</th>
                <th className="px-3 py-1.5 font-medium">{t('toolResults.container')}</th>
                <th className="px-3 py-1.5 font-medium">{t('toolResults.status')}</th>
                <th className="px-3 py-1.5 font-medium">{t('toolResults.ports')}</th>
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
                  <tr key={i} className="text-foreground">
                    <td className="px-3 py-1.5">{name}</td>
                    <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                      {container}
                    </td>
                    <td className="px-3 py-1.5">
                      {status ? <StatusBadge status={status} /> : '-'}
                    </td>
                    <td className="px-3 py-1.5 font-mono text-xs">
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

export function RollbackProjectResult({ result }: { result: unknown }) {
  const { t } = useLanguage();
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">
          {typeof res.projectName === 'string' ? res.projectName : t('toolResults.unknown')}
        </span>
        {typeof res.success === 'boolean' && (
          <StatusBadge status={res.success ? 'success' : 'failed'} />
        )}
      </div>

      <div className="flex items-center gap-2 text-xs text-foreground/80 bg-bg-app/50 p-2 rounded-md border border-border/50">
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {t('toolResults.from')}
          </span>
          <span className="font-mono text-error/80">
            {typeof res.previousImageTag === 'string'
              ? res.previousImageTag.slice(0, 7)
              : t('toolResults.unknown')}
          </span>
        </div>
        <span className="text-muted-foreground">→</span>
        <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">
            {t('toolResults.to')}
          </span>
          <span className="font-mono text-success/80">
            {typeof res.commitSha === 'string'
              ? res.commitSha.slice(0, 7)
              : t('toolResults.unknown')}
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

export function FixDockerfileResult({ result }: { result: unknown }) {
  const { t } = useLanguage();
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  const changes = Array.isArray(res.changes) ? res.changes : [];
  const before = typeof res.before === 'string' ? res.before : '';
  const after = typeof res.after === 'string' ? res.after : '';

  return (
    <div className="mt-2 flex flex-col gap-3">
      {typeof res.explanation === 'string' && (
        <p className="text-sm font-body text-foreground leading-relaxed">{res.explanation}</p>
      )}

      {changes.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-mono text-agent/80 uppercase tracking-wider">
            {t('toolResults.changes')}
          </p>
          <ul className="space-y-1">
            {changes.map((change: unknown, i: number) => (
              <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                <span className="text-agent mt-0.5">•</span>
                <span>{String(change)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(before || after) && (
        <div className="space-y-1.5">
          <p className="text-xs font-mono text-agent/80 uppercase tracking-wider">
            {t('toolResults.diff')}
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {before && (
              <div className="space-y-1">
                <span className="text-xs font-mono text-error/80 px-1.5 py-0.5 bg-error/10 rounded">
                  {t('toolResults.before')}
                </span>
                <pre className="text-xs font-mono text-error/90 bg-error/5 p-2.5 rounded border border-error/10 overflow-x-auto whitespace-pre-wrap break-all max-h-48">
                  {before}
                </pre>
              </div>
            )}
            {after && (
              <div className="space-y-1">
                <span className="text-xs font-mono text-success/80 px-1.5 py-0.5 bg-success/10 rounded">
                  {t('toolResults.after')}
                </span>
                <pre className="text-xs font-mono text-success/90 bg-success/5 p-2.5 rounded border border-success/10 overflow-x-auto whitespace-pre-wrap break-all max-h-48">
                  {after}
                </pre>
              </div>
            )}
          </div>
        </div>
      )}

      {typeof res.dockerfileContent === 'string' && !after && (
        <details className="mt-1 group/df">
          <summary className="text-xs font-mono text-agent/70 cursor-pointer hover:text-agent transition-colors select-none">
            {t('toolResults.viewDockerfile')}
          </summary>
          <pre className="mt-1.5 text-xs font-mono text-muted-foreground bg-bg-terminal border border-agent/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
            {res.dockerfileContent}
          </pre>
        </details>
      )}
    </div>
  );
}

export function ListProjectsResult({ result }: { result: unknown }) {
  const { t } = useLanguage();
  if (!Array.isArray(result)) return <FallbackResult result={result} />;
  const maxRows = 5;
  const displayRows = result.slice(0, maxRows);
  const remaining = result.length - maxRows;

  return (
    <div className="mt-2">
      <div className="border border-border rounded-md overflow-hidden">
        <table className="w-full text-left text-xs">
          <thead className="bg-bg-subtle text-foreground/80">
            <tr>
              <th className="px-3 py-1.5 font-medium">{t('toolResults.name')}</th>
              <th className="px-3 py-1.5 font-medium">{t('toolResults.status')}</th>
              <th className="px-3 py-1.5 font-medium">{t('toolResults.url')}</th>
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
                <tr key={i} className="text-foreground">
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
                        {t('toolResults.link')}
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
        <div className="mt-1.5 text-xs text-foreground/80 text-center">
          {t('toolResults.moreProjects', { count: remaining })}
        </div>
      )}
    </div>
  );
}

export function GetLogsResult({ result }: { result: unknown }) {
  const { t } = useLanguage();
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
      <summary className="text-xs font-mono text-agent/70 cursor-pointer hover:text-agent transition-colors select-none">
        {t('toolResults.viewLogs')}
      </summary>
      <pre className="mt-1.5 text-xs font-mono text-muted-foreground bg-bg-terminal border border-agent/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
        {displayLogs}
      </pre>
    </details>
  );
}

export function StatBar({
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
      <span className="w-12 text-foreground/80">{label}</span>
      <div className="flex-1 h-1.5 bg-white/10 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full', colorClass)}
          style={{ width: `${Math.min(100, Math.max(0, percent))}%` }}
        />
      </div>
      <span className="w-8 text-right text-foreground font-mono">{Math.round(percent)}%</span>
    </div>
  );
}

export function GetSystemStatsResult({ result }: { result: unknown }) {
  const { t } = useLanguage();
  if (!result || typeof result !== 'object') return null;
  const res = result as Record<string, unknown>;

  // Try to extract percentages, fallback to 0
  const cpu = Number(res.cpu) || Number(res.cpuPercent) || 0;
  const mem = Number(res.memory) || Number(res.memoryPercent) || 0;
  const disk = Number(res.disk) || Number(res.diskPercent) || 0;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <StatBar label="CPU" percent={cpu} colorClass="bg-agent" />
      <StatBar label={t('toolResults.memory')} percent={mem} colorClass="bg-success" />
      <StatBar label={t('toolResults.disk')} percent={disk} colorClass="bg-warning" />
    </div>
  );
}

export function SetEnvVarsResult({ result }: { result: unknown }) {
  const { t } = useLanguage();
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
    return <div className="mt-2 text-xs text-foreground/80">{t('toolResults.envUpdated')}</div>;
  }

  return (
    <div className="mt-2">
      <div className="text-xs text-foreground/80 mb-1.5">{t('toolResults.updatedKeys')}</div>
      <div className="flex flex-wrap gap-1.5">
        {keys.map((key, i) => (
          <div
            key={i}
            className="px-2 py-1 rounded bg-bg-subtle border border-border text-xs font-mono text-foreground flex items-center gap-1.5"
          >
            <span>{key}</span>
            <span className="text-muted-foreground">***</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FallbackResult({ result }: { result: unknown }) {
  const { t } = useLanguage();
  const masked = maskSecrets(result);
  return (
    <details className="mt-2 group/json">
      <summary className="text-xs font-mono text-agent/70 cursor-pointer hover:text-agent transition-colors select-none">
        {t('toolResults.viewResult')}
      </summary>
      <pre className="mt-1.5 text-xs font-mono text-muted-foreground bg-bg-terminal border border-agent/10 rounded-md p-2.5 max-h-48 overflow-auto whitespace-pre-wrap break-all leading-relaxed">
        {JSON.stringify(masked, null, 2)}
      </pre>
    </details>
  );
}

export function getRendererForTool(toolName: string): FC<{ result: unknown }> {
  switch (toolName) {
    case 'deploy_project':
      return DeployProjectResult;
    case 'deploy_compose':
      return DeployComposeResult;
    case 'rollback_service':
      return RollbackProjectResult;
    case 'fix_dockerfile':
      return FixDockerfileResult;
    case 'list_projects':
      return ListProjectsResult;
    case 'get_logs':
      return GetLogsResult;
    case 'get_system_stats':
      return GetSystemStatsResult;
    case 'set_env_vars':
      return SetEnvVarsResult;
    default:
      return FallbackResult;
  }
}
