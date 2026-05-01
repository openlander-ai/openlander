import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { getProjectWebhooks, setProjectWebhook, deleteProjectWebhook } from '@/lib/api';
import type { WebhookConfig } from '@/lib/api';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Webhook, Trash2, Check, Copy, Loader2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCopy } from '@/hooks/use-copy';

interface WebhookPanelProps {
  projectId: string;
}

export function WebhookPanel({ projectId }: WebhookPanelProps) {
  const { t } = useLanguage();
  const { copy, isCopied } = useCopy();
  const [webhooks, setWebhooks] = useState<WebhookConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selectedSource, setSelectedSource] = useState<string>('github');
  const [branchFilter, setBranchFilter] = useState('main');

  const fetchWebhooks = useCallback(async () => {
    try {
      const data = await getProjectWebhooks(projectId);
      setWebhooks(data);
    } catch (err) {
      console.error('Failed to fetch webhooks:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    void fetchWebhooks();
  }, [fetchWebhooks]);

  const handleAdd = async () => {
    try {
      setAdding(true);
      await setProjectWebhook(projectId, {
        source: selectedSource,
        branch_filter: branchFilter,
        enabled: true,
      });
      await fetchWebhooks();
      setBranchFilter('main');
    } catch (err) {
      console.error('Failed to add webhook:', err);
    } finally {
      setAdding(false);
    }
  };

  const handleToggle = async (webhook: WebhookConfig) => {
    try {
      await setProjectWebhook(projectId, {
        source: webhook.source,
        branch_filter: webhook.branchFilter,
        enabled: !webhook.enabled,
      });
      await fetchWebhooks();
    } catch (err) {
      console.error('Failed to toggle webhook:', err);
    }
  };

  const handleDelete = async (source: string) => {
    try {
      await deleteProjectWebhook(projectId, source);
      await fetchWebhooks();
    } catch (err) {
      console.error('Failed to delete webhook:', err);
    }
  };

  const handleCopy = (text: string, id: string) => {
    void copy(text, id);
  };

  const configuredSources = new Set(webhooks.map((w) => w.source));
  const availableSources = (['github', 'gitlab', 'bitbucket'] as const).filter(
    (s) => !configuredSources.has(s),
  );

  useEffect(() => {
    if (
      availableSources.length > 0 &&
      !availableSources.includes(selectedSource as (typeof availableSources)[number])
    ) {
      setSelectedSource(availableSources[0]);
    }
  }, [availableSources, selectedSource]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="space-y-3">
          {[1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-4 w-16" />
                </div>
                <div className="flex items-center gap-1">
                  <Skeleton className="h-7 w-16" />
                  <Skeleton className="h-7 w-8" />
                </div>
              </div>
              <div className="space-y-3">
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-6 w-full" />
                <Skeleton className="h-4 w-48" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <div className="bg-bg-panel shadow-sm border border-[hsl(var(--border))] rounded-xl p-5 space-y-4">
        {webhooks.length === 0 ? (
          <div className="text-center py-8 text-foreground/80 text-sm font-body">
            <Webhook className="h-8 w-8 mx-auto mb-3 text-muted-foreground" />
            <p>{t('webhooks.noWebhooks')}</p>
            <p className="text-xs text-muted-foreground mt-1">{t('webhooks.description')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            {webhooks.map((webhook) => {
              const fullUrl = `${window.location.origin}${webhook.webhookUrl}`;
              return (
                <div
                  key={webhook.id}
                  className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-display font-semibold text-foreground capitalize">
                        {webhook.source}
                      </span>
                      <span
                        className={cn(
                          'text-xs px-1.5 py-0.5 rounded font-body',
                          webhook.enabled
                            ? 'bg-success/10 text-success'
                            : 'bg-[var(--bg-subtle)] text-muted-foreground',
                        )}
                      >
                        {webhook.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs font-body"
                        onClick={() => handleToggle(webhook)}
                      >
                        {webhook.enabled ? 'Disable' : 'Enable'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs font-body text-error hover:text-error"
                        onClick={() => handleDelete(webhook.source)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2 text-xs font-body">
                    <div>
                      <span className="text-muted-foreground">{'Webhook URL'}:</span>
                      <div className="flex items-center gap-1 mt-0.5">
                        <code className="flex-1 bg-bg-subtle px-2 py-1 rounded text-xs text-foreground/80 truncate">
                          {fullUrl}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 shrink-0"
                          onClick={() => handleCopy(fullUrl, `url-${webhook.id}`)}
                        >
                          {isCopied(`url-${webhook.id}`) ? (
                            <Check className="h-3 w-3 text-success" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div>
                      <span className="text-muted-foreground">{'Secret'}:</span>
                      <div className="flex items-center gap-1 mt-0.5">
                        <code className="flex-1 bg-bg-subtle px-2 py-1 rounded text-xs text-foreground/80 truncate">
                          {webhook.secret}
                        </code>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 shrink-0"
                          onClick={() => handleCopy(webhook.secret, `secret-${webhook.id}`)}
                        >
                          {isCopied(`secret-${webhook.id}`) ? (
                            <Check className="h-3 w-3 text-success" />
                          ) : (
                            <Copy className="h-3 w-3" />
                          )}
                        </Button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-muted-foreground">
                      <span>{'Branch filter'}:</span>
                      <span className="text-foreground/80">{webhook.branchFilter}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {availableSources.length > 0 && (
          <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-4">
            <div className="flex items-center gap-3">
              <select
                value={selectedSource}
                onChange={(e) => setSelectedSource(e.target.value)}
                className="h-8 rounded-md border border-[hsl(var(--border))] bg-bg-panel px-2 text-xs font-body text-foreground capitalize"
              >
                {availableSources.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <input
                type="text"
                value={branchFilter}
                onChange={(e) => setBranchFilter(e.target.value)}
                placeholder="main"
                className="h-8 rounded-md border border-[hsl(var(--border))] bg-bg-panel px-2 text-xs font-body text-foreground w-24"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-body gap-1.5"
                onClick={handleAdd}
                disabled={adding}
              >
                {adding ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Plus className="h-3 w-3" />
                )}
                {'Add Webhook'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
