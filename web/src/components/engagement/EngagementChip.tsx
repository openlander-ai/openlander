import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { BriefcaseBusiness } from 'lucide-react';
import { getProjectEngagement, type ProjectEngagementReference } from '@/lib/api/engagements';
import { useLanguage } from '@/i18n/context';

export function EngagementChip({ projectId }: { projectId: string }) {
  const { t } = useLanguage();
  const [result, setResult] = useState<{
    projectId: string;
    engagement: ProjectEngagementReference | null;
  }>({ projectId, engagement: null });

  useEffect(() => {
    let active = true;
    void getProjectEngagement(projectId)
      .then((engagement) => {
        if (active) setResult({ projectId, engagement });
      })
      .catch(() => {
        if (active) setResult({ projectId, engagement: null });
      });
    return () => {
      active = false;
    };
  }, [projectId]);

  const engagement = result.projectId === projectId ? result.engagement : null;
  if (!engagement) return null;

  return (
    <Link
      to={`/engagements/${engagement.id}`}
      className="inline-flex max-w-56 items-center gap-1 rounded-full border border-[color:var(--ol-border)] bg-[color:var(--ol-panel-2)] px-2 py-0.5 text-[10px] font-medium text-[color:var(--ol-fg-muted)] hover:border-[color:var(--ol-border-strong)] hover:text-[color:var(--ol-fg)]"
      aria-label={t('engagements.chipAria', { title: engagement.title })}
    >
      <BriefcaseBusiness className="h-3 w-3 shrink-0" />
      <span className="truncate">{engagement.title}</span>
    </Link>
  );
}
