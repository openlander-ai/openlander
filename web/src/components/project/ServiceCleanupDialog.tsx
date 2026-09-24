import { useState } from 'react';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useLanguage } from '@/i18n/context';
import { copyToClipboard } from '@/lib/utils';
import type { ServiceNode } from '@/lib/projectTopology';

interface Props {
  projectId: string;
  projectName: string;
  services: ServiceNode[];
}

/** Prepare a request for the user's external agent; opening or copying never changes permissions. */
export function ServiceCleanupDialog({ projectId, projectName, services }: Props) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState<'stop' | 'delete'>('stop');
  const [selected, setSelected] = useState<string[]>([]);
  const [grantPermission, setGrantPermission] = useState(false);
  const [copied, setCopied] = useState(false);
  // Shared managed resources may belong to a different Project; keep this request on owned apps.
  const candidates = services.filter(
    (service) => service.source !== 'managed' && !service.archivedAt,
  );
  const targets = candidates.filter((service) => selected.includes(service.id));
  const allSelected = candidates.length > 0 && targets.length === candidates.length;
  const prompt = [
    t('serviceCleanup.prompt.target', { projectName, projectId }),
    ...(grantPermission ? [t('serviceCleanup.prompt.permission')] : []),
    t(`serviceCleanup.prompt.${action}`),
    ...targets.map((service) => `- ${service.name} (service_id: ${service.id})`),
    t('serviceCleanup.prompt.boundary'),
  ].join('\n');

  const change = () => setCopied(false);
  const copy = async () => {
    try {
      await copyToClipboard(prompt);
      setCopied(true);
      toast.success(t('serviceCleanup.copied'));
    } catch {
      toast.error(t('projectDetail.publicAccess.copyFailed'));
    }
  };

  if (candidates.length === 0) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          onClick={() => {
            setSelected([]);
            setAction('stop');
            setGrantPermission(false);
            setCopied(false);
            setOpen(true);
          }}
          className="shrink-0 rounded-md border border-[color:var(--ol-border)] bg-[color:var(--ol-panel)] px-3 py-2 text-[12px] font-medium text-[color:var(--ol-fg)] hover:bg-[color:var(--ol-panel-2)]"
        >
          {t('serviceCleanup.open')}
        </button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[90dvh] max-w-xl flex-col gap-4 overflow-y-auto">
        <div className="pr-6">
          <DialogTitle>{t('serviceCleanup.title')}</DialogTitle>
          <DialogDescription className="mt-2">{t('serviceCleanup.description')}</DialogDescription>
        </div>
        <fieldset className="flex gap-5">
          <legend className="sr-only">{t('serviceCleanup.action')}</legend>
          {(['stop', 'delete'] as const).map((value) => (
            <label key={value} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="radio"
                name="cleanup-action"
                checked={action === value}
                onChange={() => {
                  setAction(value);
                  change();
                }}
              />
              {t(`serviceCleanup.${value}`)}
            </label>
          ))}
        </fieldset>
        <fieldset className="rounded-md border border-[color:var(--ol-border)]">
          <legend className="sr-only">{t('serviceCleanup.targets')}</legend>
          <div className="flex items-center justify-between border-b border-[color:var(--ol-border)] px-3 py-2">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() => {
                  setSelected(allSelected ? [] : candidates.map((service) => service.id));
                  change();
                }}
              />
              {t('serviceCleanup.selectAll')}
            </label>
            <span role="status" className="text-xs text-[color:var(--ol-fg-muted)]">
              {t('serviceCleanup.selected', { count: targets.length })}
            </span>
          </div>
          <div className="max-h-48 overflow-y-auto">
            {candidates.map((service) => (
              <label
                key={service.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-[color:var(--ol-panel-2)]"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(service.id)}
                  onChange={() => {
                    setSelected((ids) =>
                      ids.includes(service.id)
                        ? ids.filter((id) => id !== service.id)
                        : [...ids, service.id],
                    );
                    change();
                  }}
                />
                <span className="min-w-0 break-all">{service.name}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="rounded-md bg-[color:var(--ol-panel-2)] p-3">
          <label className="flex cursor-pointer items-start gap-2 text-sm font-medium">
            <input
              className="mt-1"
              type="checkbox"
              checked={grantPermission}
              onChange={(event) => {
                setGrantPermission(event.target.checked);
                change();
              }}
            />
            {t('serviceCleanup.grant')}
          </label>
          <p className="mt-2 text-xs leading-relaxed text-[color:var(--ol-fg-muted)]">
            {t('serviceCleanup.grantHint')}
          </p>
        </div>
        <p className="text-xs text-[color:var(--ol-fg-muted)]">
          {t(`serviceCleanup.${action}Hint`)}
        </p>
        {targets.length > 0 && (
          <details className="text-xs">
            <summary className="cursor-pointer text-[color:var(--ol-fg-muted)]">
              {t('serviceCleanup.preview')}
            </summary>
            <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-[color:var(--ol-panel-2)] p-3 font-sans">
              {prompt}
            </pre>
          </details>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link
            to="/mcp-server"
            onClick={() => setOpen(false)}
            className="text-xs text-[color:var(--ol-fg-muted)] underline"
          >
            {t('serviceCleanup.connect')}
          </Link>
          <button
            type="button"
            disabled={targets.length === 0}
            onClick={() => void copy()}
            className="inline-flex items-center gap-2 rounded-md bg-[color:var(--ol-primary)] px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            <Copy className="h-4 w-4" />
            {t(copied ? 'serviceCleanup.copied' : 'serviceCleanup.copy')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
