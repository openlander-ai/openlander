import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  GitPullRequestArrow,
  Siren,
  ShieldAlert,
  ChevronRight,
  ChevronDown,
  Bot,
} from 'lucide-react';
import { relativeTime } from '@/components/ops/utils';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useActivityStream } from '@/hooks/use-activity-stream';
import type { ActivityItem } from '@/lib/api/operations';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';

interface ActivityFeedProps {
  projectId?: string;
}

type ActivityTypeFilter = 'all' | ActivityItem['type'];
type SeverityFilter = 'all' | ActivityItem['severity'];

interface GroupedActivity {
  key: string;
  head: ActivityItem;
  items: ActivityItem[];
}

const ACTIVITY_TYPES: ActivityTypeFilter[] = [
  'all',
  'incident',
  'recovery',
  'ai_diagnosis',
  'approval',
  'alert',
  'circuit_breaker',
  'cleanup',
];

const SEVERITY_FILTERS: SeverityFilter[] = ['all', 'critical', 'warning', 'info'];

function getTypeIcon(type: ActivityItem['type']) {
  if (type === 'incident') return AlertTriangle;
  if (type === 'recovery') return CheckCircle2;
  if (type === 'ai_diagnosis') return Bot;
  if (type === 'approval') return GitPullRequestArrow;
  if (type === 'alert') return Siren;
  if (type === 'circuit_breaker') return ShieldAlert;
  return Bell;
}

function getStatusClass(status: ActivityItem['status']) {
  if (status === 'failed') return 'text-error border-error/40 bg-error/10';
  if (status === 'active') return 'text-warning border-warning/40 bg-warning/10';
  if (status === 'resolved') return 'text-success border-success/40 bg-success/10';
  return 'text-secondary-ol border-border bg-bg-subtle';
}

function groupByCorrelation(items: ActivityItem[]): GroupedActivity[] {
  const groups: GroupedActivity[] = [];
  const indexByKey = new Map<string, number>();

  for (const item of items) {
    const tsBucket = Math.floor(new Date(item.timestamp).getTime() / 300_000);
    const key = item.correlationId || `${item.projectId}::${item.title}::${tsBucket}`;
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      groups.push({ key, head: item, items: [item] });
      indexByKey.set(key, groups.length - 1);
      continue;
    }
    groups[existingIndex].items.push(item);
  }

  return groups;
}

export function ActivityFeed({ projectId }: ActivityFeedProps) {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [typeFilter, setTypeFilter] = useState<ActivityTypeFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({});

  const toggleExpand = (key: string) => {
    setExpandedItems((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const streamTypes = useMemo(() => {
    if (typeFilter === 'all') {
      return undefined;
    }
    return [typeFilter];
  }, [typeFilter]);

  const { activities, isConnected, error } = useActivityStream({
    projectId,
    types: streamTypes,
  });

  const groupedActivities = useMemo(() => {
    const sorted = [...activities].sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    const filtered = sorted
      .filter((item) => (severityFilter === 'all' ? true : item.severity === severityFilter))
      .slice(0, 200);

    return groupByCorrelation(filtered);
  }, [activities, severityFilter]);

  return (
    <Card className="border-border bg-panel p-4 lg:p-5">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <h2 className="font-display text-lg font-semibold text-primary-ol">
            {t('operations.activity.title')}
          </h2>
          <Badge
            variant="outline"
            className={cn(
              'font-body text-[11px]',
              isConnected ? 'text-success border-success/40' : 'text-muted-ol',
            )}
          >
            {isConnected ? t('ops.connected') : t('ops.disconnected')}
          </Badge>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-xs font-body text-muted-ol">
            {t('operations.activity.filters')}
          </span>

          <Select
            value={typeFilter}
            onValueChange={(value) => setTypeFilter(value as ActivityTypeFilter)}
          >
            <SelectTrigger className="w-full sm:w-[170px] bg-bg-subtle border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACTIVITY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {type === 'all'
                    ? t('operations.activity.allTypes')
                    : t(type.replace('_', ' ').replace(/\b\w/g, (char) => char.toUpperCase()))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={severityFilter}
            onValueChange={(value) => setSeverityFilter(value as SeverityFilter)}
          >
            <SelectTrigger className="w-full sm:w-[140px] bg-bg-subtle border-border">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_FILTERS.map((severity) => (
                <SelectItem key={severity} value={severity}>
                  {severity === 'all' ? t('All') : t(severity)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs font-body text-error">
          {error.message}
        </div>
      ) : null}

      {groupedActivities.length === 0 ? (
        <div className="rounded-lg border border-border bg-bg-subtle px-4 py-8 text-center text-sm font-body text-muted-ol">
          {t('operations.activity.empty')}
        </div>
      ) : (
        <ScrollArea className="max-h-[560px] pr-3">
          <div className="space-y-3">
            {groupedActivities.map((group) => {
              const item = group.head;
              const TypeIcon = getTypeIcon(item.type);
              const hasGroupedItems = group.items.length > 1;
              const isExpanded = expandedItems[group.key];

              // Title string mapping if ai diagnosis
              const displayTitle = item.aiMetadata?.diagnosisSummary
                ? `진단 요약: ${item.aiMetadata.diagnosisSummary}`
                : item.title;

              return (
                <div
                  key={group.key}
                  className="rounded-lg border border-border bg-bg-subtle/80 p-3 transition-colors hover:border-agent/40"
                >
                  <div
                    className="flex items-start justify-between gap-3 cursor-pointer"
                    onClick={() => toggleExpand(group.key)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!item.projectName.startsWith('[삭제')) {
                              navigate(`/projects/${item.projectId}`);
                            }
                          }}
                          className={cn(
                            'rounded border border-border bg-panel px-2 py-0.5 text-xs font-body text-secondary-ol hover:text-primary-ol',
                            item.projectName.startsWith('[삭제')
                              ? 'cursor-not-allowed opacity-60'
                              : 'cursor-pointer',
                          )}
                        >
                          {item.projectName}
                        </button>

                        <Badge
                          variant="outline"
                          className={cn(
                            'font-body text-[11px] capitalize',
                            item.type === 'ai_diagnosis' && 'text-agent border-agent/30 bg-agent/5',
                          )}
                        >
                          <TypeIcon className="mr-1 h-3 w-3" />
                          {t(item.type.replace('_', ' '))}
                        </Badge>

                        {hasGroupedItems ? (
                          <Badge variant="secondary" className="font-mono text-[10px]">
                            {group.items.length} {t('events')}
                          </Badge>
                        ) : null}
                      </div>

                      <p className="truncate font-body text-sm text-primary-ol flex items-center gap-1.5">
                        {isExpanded ? (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-ol" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 text-muted-ol" />
                        )}
                        {displayTitle}
                      </p>

                      <div
                        className="flex items-center gap-1 mt-1 text-xs font-body text-muted-ol"
                        title={new Date(item.timestamp).toLocaleString()}
                      >
                        <span>
                          {relativeTime(
                            new Date(item.timestamp).getTime(),
                            (t('language') as 'ko' | 'en') || 'ko',
                          )}
                        </span>
                        {item.aiMetadata && (
                          <>
                            <span>·</span>
                            <span className="font-mono">{item.aiMetadata.model}</span>
                            {item.aiMetadata.durationMs && (
                              <span>· {(item.aiMetadata.durationMs / 1000).toFixed(1)}s</span>
                            )}
                            {item.aiMetadata.tokensUsed && (
                              <span>· {item.aiMetadata.tokensUsed} tokens</span>
                            )}
                          </>
                        )}
                      </div>
                    </div>

                    <Badge
                      variant="outline"
                      className={cn('capitalize mt-1', getStatusClass(item.status))}
                    >
                      {t(item.status)}
                    </Badge>
                  </div>

                  {isExpanded && (
                    <div className="mt-3 pl-5 border-l-[3px] border-agent/20 space-y-3">
                      {item.description && (
                        <p className="text-sm font-body text-secondary-ol whitespace-pre-wrap">
                          {item.description}
                        </p>
                      )}

                      {item.aiMetadata?.diagnosisSummary && (
                        <div className="p-3 bg-agent/5 border border-agent/20 rounded-md">
                          <p className="text-xs font-medium text-agent mb-1">🤖 AI 진단 요약</p>
                          <p className="text-sm text-primary-ol">
                            {item.aiMetadata.diagnosisSummary}
                          </p>
                        </div>
                      )}

                      {hasGroupedItems && (
                        <div className="space-y-1.5 bg-bg-app rounded p-2.5">
                          <p className="text-[11px] font-semibold text-muted-ol mb-2 uppercase tracking-wider">
                            최근 동일 이벤트 ({group.items.length}건)
                          </p>
                          {group.items.slice(1, 6).map((subItem) => (
                            <div key={subItem.id} className="flex gap-3 text-xs font-mono">
                              <span className="text-muted-ol w-[65px] flex-shrink-0">
                                {relativeTime(
                                  new Date(subItem.timestamp).getTime(),
                                  (t('language') as 'ko' | 'en') || 'ko',
                                )}
                              </span>
                              <span className="text-secondary-ol truncate">{subItem.title}</span>
                            </div>
                          ))}
                          {group.items.length > 6 && (
                            <p className="text-xs italic text-muted-ol pl-3">
                              외 {group.items.length - 6}건의 병합된 로그가 더 있습니다.
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      )}
    </Card>
  );
}
