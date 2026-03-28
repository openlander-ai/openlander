import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { toast } from 'sonner';
import { useCopy } from '@/hooks/use-copy';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import {
  InputRequestCard,
  type QuestionAnswerPayload,
} from '@/components/timeline/InputRequestCard';
import {
  getProject,
  exposeProject,
  unexposeProject,
  getAllIps,
  type NetworkIp,
  getProjectDomains,
  getProjectTimeline,
  addProjectDomain,
  removeProjectDomain,
  type DomainMapping,
  getCloudflareStatus,
  getSetupStatus,
} from '@/lib/api';
import type { QuestionData } from '@/lib/event-types';
import { cn } from '@/lib/utils';
import {
  Globe,
  ExternalLink,
  Loader2,
  Copy,
  Check,
  Wifi,
  Monitor,
  Trash2,
  Plus,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { AISparkle } from '@/components/ui/AISparkle';

interface DomainsPanelProps {
  projectId: string;
  /** When this value changes, the panel re-fetches project data. */
  projectStatus?: string;
}

export function DomainsPanel({ projectId, projectStatus }: DomainsPanelProps) {
  const { t } = useLanguage();
  const { copy, isCopied } = useCopy();
  const [internalUrl, setInternalUrl] = useState<string | null>(null);
  const [publicUrl, setPublicUrl] = useState<string | null>(null);
  const [assignedPort, setAssignedPort] = useState<number | null>(null);
  const [networkIps, setNetworkIps] = useState<NetworkIp[]>([]);
  const [loading, setLoading] = useState(true);
  const [exposing, setExposing] = useState(false);
  const [unexposing, setUnexposing] = useState(false);
  const [domains, setDomains] = useState<DomainMapping[]>([]);
  const [newDomain, setNewDomain] = useState('');
  const [addingDomain, setAddingDomain] = useState(false);
  const [removingDomain, setRemovingDomain] = useState<string | null>(null);
  const [cfConfigured, setCfConfigured] = useState<boolean | null>(null);
  const [llmConfigured, setLlmConfigured] = useState(false);
  const [domainAiProgress, setDomainAiProgress] = useState<{
    domain: string;
    startedAt: number;
    message: string;
    questionId?: string;
    questions?: QuestionData[];
    answered?: boolean;
  } | null>(null);

  const refreshDomains = useCallback(async () => {
    const updated = await getProjectDomains(projectId);
    setDomains(updated);
  }, [projectId]);

  const finalizeDomainAnalysis = useCallback(async () => {
    await refreshDomains();
    setDomainAiProgress(null);
    toast.success('Domain added');
  }, [refreshDomains]);

  const fetchProject = useCallback(async () => {
    try {
      const [data, ips, domainsList, cfStatus, setupStatus] = await Promise.all([
        getProject(projectId),
        getAllIps(),
        getProjectDomains(projectId),
        getCloudflareStatus().catch(() => ({ configured: false })),
        getSetupStatus().catch(() => ({ llm: { ok: false } })),
      ]);
      setInternalUrl(data.url ?? null);
      setPublicUrl(data.publicUrl ?? null);
      setAssignedPort(data.port ?? null);
      setNetworkIps(ips);
      setDomains(domainsList);
      setCfConfigured(cfStatus.configured);
      setLlmConfigured(setupStatus.llm.ok === true);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchProject();
  }, [fetchProject, projectStatus]);

  useEffect(() => {
    if (!domainAiProgress) return;

    let cancelled = false;
    const seen = new Set<string>();
    let sawAiEvent = false;
    let lastEventAt = Date.now();

    const isTerminalStatusMessage = (message: string) => {
      return (
        message.includes('User skipped AI-suggested domain env updates') ||
        message.includes('Triggering redeploy') ||
        message.includes('Domain env update request timed out')
      );
    };

    const poll = async () => {
      if (cancelled) return;

      try {
        const events = await getProjectTimeline(projectId);
        let shouldFinalize = false;

        for (const event of events) {
          const eventTime = Date.parse(event.timestamp);
          if (!Number.isFinite(eventTime) || eventTime < domainAiProgress.startedAt - 1500) {
            continue;
          }

          const key = event.id ?? `${event.type}|${event.timestamp}|${event.message}`;
          if (seen.has(key)) continue;
          seen.add(key);

          if (
            event.type === 'agent_thinking' ||
            event.type === 'agent_tool_call' ||
            event.type === 'agent_message' ||
            event.type === 'agent_tool_result' ||
            event.type === 'question_pending'
          ) {
            sawAiEvent = true;
            lastEventAt = Date.now();
          }

          if (event.type === 'agent_thinking') {
            setDomainAiProgress((prev) =>
              prev
                ? {
                    ...prev,
                    message: event.message || 'AI 분석 중...',
                  }
                : prev,
            );
            continue;
          }

          if (event.type === 'question_pending' && event.questionId && event.questions) {
            setDomainAiProgress((prev) =>
              prev
                ? {
                    ...prev,
                    message: event.message,
                    questionId: event.questionId,
                    questions: event.questions,
                    answered: false,
                  }
                : prev,
            );
            continue;
          }

          if (event.type === 'status' && isTerminalStatusMessage(event.message)) {
            shouldFinalize = true;
            break;
          }

          if (event.type === 'error' && event.message.startsWith('AI analysis failed:')) {
            shouldFinalize = true;
            break;
          }
        }

        const elapsedFromStart = Date.now() - domainAiProgress.startedAt;
        const idleFor = Date.now() - lastEventAt;

        if (
          shouldFinalize ||
          (sawAiEvent && idleFor > 5000) ||
          (!sawAiEvent && elapsedFromStart > 8000)
        ) {
          await finalizeDomainAnalysis();
        }
      } catch {
        return;
      }
    };

    void poll();
    const interval = setInterval(() => {
      void poll();
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [domainAiProgress, projectId, finalizeDomainAnalysis]);

  const submitDomainQuestion = useCallback(
    async (questionId: string, answers: QuestionAnswerPayload[]) => {
      try {
        const res = await fetch('/api/question/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            request_id: questionId,
            answers: answers.map((answer) => ({
              questionIndex: answer.questionIndex,
              selectedLabels: answer.selectedLabels,
              customText: answer.customText,
            })),
          }),
        });
        if (res.ok) {
          setDomainAiProgress((prev) =>
            prev && prev.questionId === questionId
              ? {
                  ...prev,
                  answered: true,
                }
              : prev,
          );
        }
      } catch {
        return;
      }
    },
    [],
  );

  const skipDomainQuestion = useCallback(async (questionId: string) => {
    try {
      const res = await fetch('/api/question/dismiss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: questionId }),
      });
      if (res.ok) {
        setDomainAiProgress((prev) =>
          prev && prev.questionId === questionId
            ? {
                ...prev,
                answered: true,
              }
            : prev,
        );
      }
    } catch {
      return;
    }
  }, []);

  const handleExpose = async () => {
    setExposing(true);
    try {
      const result = await exposeProject(projectId);
      setPublicUrl(result.publicUrl);
      toast.success('Project exposed');
    } catch (err) {
      console.error('Expose failed:', err);
      toast.error('Failed to expose project');
    } finally {
      setExposing(false);
    }
  };

  const handleUnexpose = async () => {
    setUnexposing(true);
    try {
      await unexposeProject(projectId);
      setPublicUrl(null);
      toast.success('Project unexposed');
    } catch (err) {
      console.error('Unexpose failed:', err);
      toast.error('Failed to unexpose project');
    } finally {
      setUnexposing(false);
    }
  };

  const handleAddDomain = async () => {
    if (!newDomain.trim()) return;
    const domain = newDomain.trim();
    setAddingDomain(true);
    try {
      await addProjectDomain(projectId, domain);
      setNewDomain('');
      if (llmConfigured) {
        setDomainAiProgress({
          domain,
          startedAt: Date.now(),
          message: 'AI 분석 중...',
        });
      } else {
        await refreshDomains();
        toast.success('Domain added');
      }
    } catch (err) {
      console.error('Failed to add domain:', err);
      toast.error('Failed to add domain');
    } finally {
      setAddingDomain(false);
    }
  };

  const handleRemoveDomain = async (domain: string) => {
    setRemovingDomain(domain);
    try {
      await removeProjectDomain(projectId, domain);
      setDomains((prev) => prev.filter((d) => d.domain !== domain));
      toast.success('Domain removed');
    } catch (err) {
      console.error('Failed to remove domain:', err);
      toast.error('Failed to remove domain');
    } finally {
      setRemovingDomain(null);
    }
  };
  const copyToClipboard = (url: string, label: string) => {
    void copy(url, label);
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 space-y-3"
          >
            <div className="flex items-center gap-2">
              <Skeleton className="h-3.5 w-3.5" />
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-3 w-48" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Internal URL */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 space-y-2">
        <div className="flex items-center gap-2">
          <Wifi className="h-3.5 w-3.5 text-muted-ol" />
          <span className="text-xs font-body font-medium text-secondary-ol uppercase tracking-wider">
            {'Internal URL'}
          </span>
        </div>
        {internalUrl ? (
          <div className="flex items-center gap-2">
            <a
              href={internalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-blue-400 hover:text-blue-300 hover:underline underline-offset-2 transition-colors flex items-center gap-1"
            >
              {internalUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={() => copyToClipboard(internalUrl, 'internal')}
              className="p-1 rounded text-muted-ol hover:text-secondary-ol transition-colors"
            >
              {isCopied('internal') ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : (
          <p className="text-sm font-body text-muted-ol">{t('domains.notAvailable')}</p>
        )}
        <p className="text-sm font-body text-muted-ol">{t('domains.accessibleFrom')}</p>
      </div>

      {/* Direct Port Access */}
      {assignedPort && networkIps.length > 0 && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 space-y-2">
          <div className="flex items-center gap-2">
            <Monitor className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-xs font-body font-medium text-secondary-ol uppercase tracking-wider">
              {'Direct Access'}
            </span>
          </div>
          <div className="space-y-1.5">
            {networkIps.map((ip) => {
              const directUrl = `http://${ip.address}:${assignedPort}`;
              const label = ip.type === 'vpn' ? `${ip.interface} (VPN)` : ip.interface;
              return (
                <div key={ip.address} className="flex items-center gap-2">
                  <a
                    href={directUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-mono text-blue-400 hover:text-blue-300 hover:underline underline-offset-2 transition-colors flex items-center gap-1"
                  >
                    {directUrl}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <span className="text-xs font-body text-muted-ol px-1.5 py-0.5 rounded bg-bg-subtle border border-[hsl(var(--border))]">
                    {label}
                  </span>
                  <button
                    onClick={() => copyToClipboard(directUrl, ip.address)}
                    className="p-1 rounded text-muted-ol hover:text-secondary-ol transition-colors"
                  >
                    {isCopied(ip.address) ? (
                      <Check className="h-3.5 w-3.5 text-success" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
          <p className="text-sm font-body text-muted-ol">{t('domains.directPortAccess')}</p>
        </div>
      )}

      {/* Custom Domains */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-xs font-body font-medium text-secondary-ol uppercase tracking-wider">
              {'Custom Domains'}
            </span>
          </div>
        </div>

        {/* Domain list */}
        {domains.length > 0 ? (
          <div className="space-y-1.5">
            {domains.map((d) => (
              <div key={d.domain} className="flex items-center justify-between gap-2 py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <a
                    href={`https://${d.domain}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-mono text-blue-400 hover:text-blue-300 hover:underline underline-offset-2 transition-colors flex items-center gap-1 truncate"
                  >
                    {d.domain}
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-ol hover:text-error shrink-0"
                  onClick={() => handleRemoveDomain(d.domain)}
                  disabled={removingDomain === d.domain}
                >
                  {removingDomain === d.domain ? (
                    <Spinner className="h-3 w-3" />
                  ) : (
                    <Trash2 className="h-3 w-3" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm font-body text-muted-ol">{t('domains.noCustomDomains')}</p>
        )}

        {/* Add domain form */}
        {cfConfigured === false ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 p-2.5 space-y-1">
            <p className="text-sm font-body text-warning">{t('domains.cloudflareNotConfigured')}</p>
            <a
              href="/settings"
              className="text-xs font-body font-medium text-warning underline-offset-2 hover:underline flex items-center gap-1"
            >
              <span>{t('domains.cloudflareGoToSettings')}</span>
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newDomain}
                onChange={(e) =>
                  setNewDomain(e.target.value.replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddDomain();
                }}
                placeholder="example.com"
                className="flex-1 h-8 rounded-md border border-[hsl(var(--border))] bg-bg-panel px-3 text-sm font-mono text-primary-ol placeholder:text-muted-ol"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs font-body gap-1.5"
                onClick={handleAddDomain}
                disabled={!newDomain.trim() || addingDomain || !!domainAiProgress}
              >
                {addingDomain ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>
                    {llmConfigured && <AISparkle className="h-3.5 w-3.5" />}
                    <Plus className="h-3 w-3" />
                  </>
                )}
                {'Add Domain'}
              </Button>
            </div>

            {domainAiProgress && (
              <div className="border-0 border-l-2 border-agent bg-agent/[0.03] pl-3 py-2 my-2 rounded-l-none space-y-2">
                <p className="text-sm font-body text-agent/90">{domainAiProgress.message}</p>
                {domainAiProgress.questionId && domainAiProgress.questions && (
                  <InputRequestCard
                    questionId={domainAiProgress.questionId}
                    questions={domainAiProgress.questions}
                    answered={domainAiProgress.answered}
                    onSubmit={(questionId, answers) => {
                      void submitDomainQuestion(questionId, answers);
                    }}
                    onSkip={(questionId) => {
                      void skipDomainQuestion(questionId);
                    }}
                  />
                )}
                <p className="text-xs font-mono text-muted-ol">
                  {`domain: ${domainAiProgress.domain}`}
                </p>
              </div>
            )}

            <p className="text-sm font-body text-muted-ol">{t('domains.customDomainsHelp')}</p>
          </>
        )}
      </div>

      {/* Public URL */}
      <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="h-3.5 w-3.5 text-muted-ol" />
            <span className="text-xs font-body font-medium text-secondary-ol uppercase tracking-wider">
              {'Public URL'}
            </span>
          </div>

          {/* Toggle expose/unexpose */}
          {publicUrl ? (
            <button
              onClick={handleUnexpose}
              disabled={unexposing}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body',
                'border border-error/30 text-error hover:bg-error/10',
                'transition-colors',
                unexposing && 'opacity-50 cursor-not-allowed',
              )}
            >
              {unexposing && <Loader2 className="h-3 w-3 animate-spin" />}
              {'Remove'}
            </button>
          ) : (
            <button
              onClick={handleExpose}
              disabled={exposing || !internalUrl}
              className={cn(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-body',
                'bg-agent text-white hover:bg-agent/90',
                'transition-colors',
                (exposing || !internalUrl) && 'opacity-50 cursor-not-allowed',
              )}
            >
              {exposing && <Loader2 className="h-3 w-3 animate-spin" />}
              {t('domains.exposeToInternet')}
            </button>
          )}
        </div>

        {publicUrl ? (
          <div className="flex items-center gap-2">
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm font-mono text-blue-400 hover:text-blue-300 hover:underline underline-offset-2 transition-colors flex items-center gap-1"
            >
              {publicUrl}
              <ExternalLink className="h-3 w-3" />
            </a>
            <button
              onClick={() => copyToClipboard(publicUrl, 'public')}
              className="p-1 rounded text-muted-ol hover:text-secondary-ol transition-colors"
            >
              {isCopied('public') ? (
                <Check className="h-3.5 w-3.5 text-success" />
              ) : (
                <Copy className="h-3.5 w-3.5" />
              )}
            </button>
          </div>
        ) : (
          <p className="text-sm font-body text-muted-ol">{t('domains.notExposed')}</p>
        )}

        <p className="text-sm font-body text-muted-ol">
          {publicUrl ? t('domains.anyoneWithUrl') : t('domains.requiresRunning')}
        </p>
      </div>
    </div>
  );
}
