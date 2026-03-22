import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, GitCommit, History, Sparkles } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { useLanguage } from '@/i18n/context';
import { getProjectDeployments } from '@/lib/api';
import { formatRelativeTime } from '@/lib/time';
import type { ChatStreamEvent, DeployLogSummary } from '@/types';
import { cn } from '@/lib/utils';
import { useSetup } from '@/hooks/use-setup';

interface RollbackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName: string;
  currentEnvironment?: string;
  isSubmitting?: boolean;
  onConfirm: (deploymentId: string) => void | Promise<void>;
}

function getStatusGlyph(status: DeployLogSummary['status']): string {
  if (status === 'success') return '✅';
  if (status === 'failed') return '❌';
  return '⚪';
}

interface AiSuggestion {
  text: string;
  suggestedDeploymentId?: string;
}

function parseChatStreamEvent(line: string): ChatStreamEvent | null {
  if (!line.trim()) {
    return null;
  }
  try {
    return JSON.parse(line) as ChatStreamEvent;
  } catch {
    return null;
  }
}

function parseSuggestedDeploymentId(
  text: string,
  deployments: DeployLogSummary[],
): string | undefined {
  const deploymentIds = deployments.map((deployment) => deployment.id);
  if (deploymentIds.length === 0) {
    return undefined;
  }

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const primaryLine = lines[0] ?? text;

  const primaryMatch = deploymentIds.find((id) => primaryLine.includes(id));
  if (primaryMatch) {
    return primaryMatch;
  }

  return deploymentIds.find((id) => text.includes(id));
}

function createSuggestionSessionId(projectId: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `rollback-${projectId}-${Date.now()}`;
}

export function RollbackDialog({
  open,
  onOpenChange,
  projectId,
  projectName,
  currentEnvironment,
  isSubmitting = false,
  onConfirm,
}: RollbackDialogProps) {
  const { t } = useLanguage();
  const { status: setupStatus } = useSetup();
  const [deployments, setDeployments] = useState<DeployLogSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedDeploymentId, setSelectedDeploymentId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [aiSuggestion, setAiSuggestion] = useState<AiSuggestion | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const llmEnabled = setupStatus?.llm.ok === true;

  useEffect(() => {
    if (!open) {
      setSelectedDeploymentId(null);
      setLoadError(null);
      setAiSuggestion(null);
      setAiLoading(false);
      setAiError(null);
      return;
    }

    let mounted = true;
    const loadDeployments = async () => {
      setLoading(true);
      if (llmEnabled) {
        setAiSuggestion(null);
        setAiError(null);
      }
      try {
        const data = await getProjectDeployments(projectId);
        if (!mounted) return;
        setDeployments(data);
        setSelectedDeploymentId(data[0]?.id ?? null);
        setLoadError(null);
      } catch (err) {
        if (!mounted) return;
        setDeployments([]);
        setSelectedDeploymentId(null);
        setLoadError(err instanceof Error ? err.message : 'Failed to fetch deployments');
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    void loadDeployments();

    return () => {
      mounted = false;
    };
  }, [llmEnabled, open, projectId]);

  useEffect(() => {
    if (!open || !llmEnabled || deployments.length === 0 || loading || loadError) {
      return;
    }

    const controller = new AbortController();
    let active = true;

    const requestSuggestion = async () => {
      setAiLoading(true);
      setAiError(null);
      setAiSuggestion(null);

      const deploymentLines = deployments
        .map((deployment) => {
          const shortSha = deployment.commitSha?.slice(0, 7) ?? 'unknown';
          const failureText = deployment.failureSummary
            ? `, error: ${deployment.failureSummary}`
            : '';
          const triggerText = deployment.triggerDetail ?? deployment.trigger;
          return `- ${deployment.id}: ${deployment.status}, commit ${shortSha}, ${deployment.createdAt}, trigger ${triggerText}${failureText}`;
        })
        .join('\n');

      const prompt = `Given these deployment records for project "${projectName}":\n${deploymentLines}\n\nWhich deployment should be rolled back to? Reply with ONLY the deployment ID on the first line, then a brief reason on the second line.`;

      try {
        const response = await fetch('/api/chat/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: prompt,
            session_id: createSuggestionSessionId(projectId),
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error('AI suggestion request failed');
        }
        if (!response.body) {
          throw new Error('AI suggestion stream unavailable');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let assistantText = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const event = parseChatStreamEvent(line);
            if (event?.type === 'message') {
              assistantText = event.content.trim();
            }
          }
        }

        const trailingEvent = parseChatStreamEvent(buffer);
        if (trailingEvent?.type === 'message') {
          assistantText = trailingEvent.content.trim();
        }

        if (!assistantText) {
          throw new Error('AI suggestion empty response');
        }

        if (!active) {
          return;
        }

        const suggestedDeploymentId = parseSuggestedDeploymentId(assistantText, deployments);
        setAiSuggestion({
          text: assistantText,
          suggestedDeploymentId,
        });
        setAiError(null);
      } catch (err) {
        if (!active || controller.signal.aborted) {
          return;
        }
        setAiSuggestion(null);
        setAiError(err instanceof Error ? err.message : 'AI suggestion unavailable');
      } finally {
        if (active) {
          setAiLoading(false);
        }
      }
    };

    void requestSuggestion();

    return () => {
      active = false;
      controller.abort();
    };
  }, [deployments, llmEnabled, loadError, loading, open, projectId, projectName]);

  const selectedDeployment = useMemo(
    () => deployments.find((deployment) => deployment.id === selectedDeploymentId) ?? null,
    [deployments, selectedDeploymentId],
  );

  const handleConfirm = () => {
    if (!selectedDeploymentId) return;
    void onConfirm(selectedDeploymentId);
  };

  const showAiLoading = loading || aiLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl p-0 overflow-hidden">
        <div className={cn('grid', llmEnabled ? 'md:grid-cols-[1.7fr_1fr]' : 'grid-cols-1')}>
          <div className="p-6 min-w-0">
            <DialogHeader>
              <DialogTitle>{t('rollback.title')}</DialogTitle>
              <DialogDescription>{t('rollback.selectVersion')}</DialogDescription>
            </DialogHeader>

            <div className="mt-4 rounded-lg border border-border bg-bg-app/70">
              <div className="flex items-center justify-between px-3 py-2 border-b border-border text-xs font-body text-muted-ol">
                <span className="flex items-center gap-1.5">
                  <History className="h-3.5 w-3.5" />
                  {projectName}
                </span>
                {currentEnvironment && <span>{currentEnvironment}</span>}
              </div>

              <div className="max-h-[320px] overflow-y-auto p-2 space-y-2">
                {loading && (
                  <div className="flex items-center justify-center py-10 text-sm text-muted-ol gap-2">
                    <Spinner className="h-4 w-4" />
                    <span>Loading deployments...</span>
                  </div>
                )}

                {!loading && loadError && (
                  <div className="flex items-center gap-2 rounded-md border border-error/30 bg-error/10 px-3 py-2 text-xs text-error">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {loadError}
                  </div>
                )}

                {!loading && !loadError && deployments.length === 0 && (
                  <div className="py-10 text-center text-sm text-muted-ol">
                    {t('rollback.noDeployments')}
                  </div>
                )}

                {!loading &&
                  !loadError &&
                  deployments.length > 0 &&
                  deployments.map((deployment) => {
                    const selected = deployment.id === selectedDeploymentId;
                    const triggerText = deployment.triggerDetail ?? deployment.trigger;

                    return (
                      <button
                        key={deployment.id}
                        type="button"
                        onClick={() => setSelectedDeploymentId(deployment.id)}
                        className={cn(
                          'w-full rounded-md border px-3 py-2 text-left transition-colors',
                          selected
                            ? 'border-agent bg-agent/10 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.35)]'
                            : 'border-border bg-bg-panel hover:border-agent/40 hover:bg-agent/5',
                        )}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0 flex items-center gap-2">
                            <span className="shrink-0 text-sm">
                              {getStatusGlyph(deployment.status)}
                            </span>
                            <span className="min-w-0 inline-flex items-center gap-1.5 text-xs text-secondary-ol">
                              <GitCommit className="h-3.5 w-3.5" />
                              <span className="font-mono truncate">
                                {deployment.commitSha?.slice(0, 7) ?? 'unknown'}
                              </span>
                            </span>
                          </div>
                          <span className="shrink-0 text-[11px] text-muted-ol">
                            {formatRelativeTime(deployment.createdAt)}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-muted-ol">{triggerText}</div>
                      </button>
                    );
                  })}
              </div>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('rollback.cancel')}
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={!selectedDeployment || loading || isSubmitting}
                className="bg-foreground text-background hover:bg-foreground/90"
              >
                {isSubmitting ? <Spinner className="h-4 w-4 mr-1.5" /> : null}
                {t('rollback.confirm')}
              </Button>
            </DialogFooter>
          </div>

          {llmEnabled && (
            <aside className="border-t md:border-t-0 md:border-l border-border bg-bg-app/60 p-6">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-agent/80">
                <Sparkles className="h-3.5 w-3.5" />
                {t('rollback.aiSuggestion')}
              </div>

              {showAiLoading && (
                <>
                  <p className="mt-2 text-sm text-secondary-ol">{t('rollback.aiAnalyzing')}</p>
                  <div className="mt-4 space-y-3">
                    <Skeleton className="h-4 w-[85%]" />
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-[90%]" />
                    <Skeleton className="h-3 w-[70%]" />
                  </div>
                </>
              )}

              {!showAiLoading && aiError && (
                <p className="mt-3 text-sm text-muted-ol">AI suggestion unavailable</p>
              )}

              {!showAiLoading && !aiError && aiSuggestion && (
                <div className="mt-3 space-y-4">
                  <p className="text-sm leading-relaxed text-secondary-ol whitespace-pre-line">
                    {aiSuggestion.text}
                  </p>
                  {aiSuggestion.suggestedDeploymentId && (
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        const suggestedId = aiSuggestion.suggestedDeploymentId;
                        if (suggestedId) {
                          setSelectedDeploymentId(suggestedId);
                        }
                      }}
                    >
                      {t('rollback.useSuggestion')} #{aiSuggestion.suggestedDeploymentId}
                    </Button>
                  )}
                </div>
              )}
            </aside>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
