import { useCallback, useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { AiOpsBriefingFeed } from '@/components/ai-ops/AiOpsBriefingFeed';
import { useLanguage } from '@/i18n/context';
import {
  listProjectAiOpsBriefings,
  type AiOpsBriefing,
  type AiOpsBriefingStatus,
} from '@/lib/api/ai-ops';
import { cn } from '@/lib/utils';

interface ProjectAiOpsTabProps {
  projectId: string;
}

const STATUS_FILTERS: Array<{ value: AiOpsBriefingStatus | 'all'; labelKey: string }> = [
  { value: 'open', labelKey: 'aiOps.status.open' },
  { value: 'acknowledged', labelKey: 'aiOps.status.acknowledged' },
  { value: 'resolved', labelKey: 'aiOps.status.resolved' },
  { value: 'all', labelKey: 'aiOps.status.all' },
];

export function ProjectAiOpsTab({ projectId }: ProjectAiOpsTabProps) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<AiOpsBriefingStatus | 'all'>('open');
  const [briefings, setBriefings] = useState<AiOpsBriefing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listProjectAiOpsBriefings(projectId, {
        limit: 50,
        status: status === 'all' ? undefined : status,
      });
      setBriefings(response.briefings ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('aiOps.error.load'));
    } finally {
      setLoading(false);
    }
  }, [projectId, status, t]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-agent" />
            <h3 className="text-sm font-semibold text-foreground">
              {t('aiOps.projectInbox.title')}
            </h3>
          </div>
          <p className="mt-1 text-xs text-foreground/70">{t('aiOps.projectInbox.description')}</p>
        </div>
        <div className="flex flex-wrap gap-1 rounded-md border border-[hsl(var(--border))] bg-bg-subtle p-1">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setStatus(option.value)}
              className={cn(
                'rounded px-2.5 py-1 text-[11.5px] transition-colors',
                status === option.value
                  ? 'bg-bg-panel text-foreground shadow-sm'
                  : 'text-foreground/60 hover:text-foreground',
              )}
            >
              {t(option.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}

      <AiOpsBriefingFeed
        briefings={briefings}
        loading={loading}
        emptyTitle={t('aiOps.projectInbox.emptyTitle')}
        emptyDescription={t('aiOps.projectInbox.emptyDescription')}
        showScope
        onError={setError}
      />
    </div>
  );
}
