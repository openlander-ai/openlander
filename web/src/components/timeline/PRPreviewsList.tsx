import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { getProjectPreviews, deleteProjectPreview, type PRPreview } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import { cn } from '@/lib/utils';
import { GitPullRequest, ExternalLink, Loader2, Trash2, Clock, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface PRPreviewsListProps {
  projectId: string;
}

export function PRPreviewsList({ projectId }: PRPreviewsListProps) {
  const { t } = useLanguage();
  const [previews, setPreviews] = useState<PRPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchPreviews = useCallback(async () => {
    try {
      const data = await getProjectPreviews(projectId);
      setPreviews(data);
    } catch (err) {
      console.error('Failed to fetch previews:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchPreviews();
  }, [fetchPreviews]);

  const handleDelete = async (previewId: string) => {
    setDeletingId(previewId);
    try {
      await deleteProjectPreview(projectId, previewId);
      await fetchPreviews();
    } catch (err) {
      console.error('Failed to delete preview:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const handleCopy = (url: string, id: string) => {
    void navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Status badge config
  const statusConfig: Record<string, { label: string; color: string; dot: string }> = {
    running: { label: 'Live', color: 'text-success', dot: 'bg-success' },
    building: { label: 'Deploying', color: 'text-warning', dot: 'bg-warning animate-pulse' },
    stopped: { label: 'Stopped', color: 'text-muted-ol', dot: 'bg-[var(--text-muted)]' },
    error: { label: 'Failed', color: 'text-error', dot: 'bg-error' },
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-agent" />
      </div>
    );
  }

  if (previews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-secondary-ol">
        <GitPullRequest className="h-8 w-8 mb-3 text-muted-ol" />
        <p className="text-sm font-body">{t('prPreviews.noPreviews')}</p>
        <p className="text-xs font-body text-muted-ol mt-1">{t('prPreviews.description')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 overflow-auto h-full">
      {previews.map((preview) => {
        const status = statusConfig[preview.status] ?? statusConfig.stopped;
        const previewUrl = preview.publicUrl || preview.url;

        return (
          <div
            key={preview.id}
            className="flex items-center justify-between p-3 rounded-lg border border-[hsl(var(--border))] bg-bg-panel hover:border-agent/30 transition-colors"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={cn('h-2.5 w-2.5 rounded-full shrink-0', status.dot)} />
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <GitPullRequest className="h-3.5 w-3.5 text-success shrink-0" />
                  <span className="text-sm font-display font-medium text-primary-ol">
                    PR #{preview.prNumber}
                  </span>
                  <span className={cn('text-xs font-body', status.color)}>{status.label}</span>
                </div>
                <div className="flex items-center gap-3 mt-1 text-xs font-body text-secondary-ol">
                  <span className="truncate text-muted-ol">{preview.name}</span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatRelativeTime(preview.updatedAt, t)}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {previewUrl && (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => handleCopy(previewUrl, preview.id)}
                  >
                    {copiedId === preview.id ? (
                      <Check className="h-3 w-3 text-success" />
                    ) : (
                      <Copy className="h-3 w-3 text-muted-ol" />
                    )}
                  </Button>
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-bg-subtle transition-colors"
                  >
                    <ExternalLink className="h-3 w-3 text-agent" />
                  </a>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 text-muted-ol hover:text-error"
                onClick={() => handleDelete(preview.id)}
                disabled={deletingId === preview.id}
              >
                {deletingId === preview.id ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
