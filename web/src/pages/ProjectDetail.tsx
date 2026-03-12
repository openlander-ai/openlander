import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/i18n/context';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getProject,
  redeployProject,
  startProject,
  stopProject,
  rollbackProject,
  blueGreenProject,
  debugBuild,
  scanProjectEnvVars,
  deleteProject,
  deleteEnvironment,
  createEnvironment,
  type BuildDiagnosis,
  type PostmortemData,
  type EnvVarInfo,
  type ProjectWithOptionalEnvironments,
} from '@/lib/api';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { useTimeline } from '@/hooks/use-timeline';
import { ShareDialog } from '@/components/sidebar/ShareDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { EnvironmentType } from '@/types';
import { useAssistant } from '@/hooks/use-assistant';
import { Activity, History, SquareTerminal, Settings, GitBranch } from 'lucide-react';
import type { TimelineItem } from '@/lib/event-types';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

// Wave 2 tab components
import { OverviewTab } from '@/components/project/OverviewTab';
import { DeploymentsTab } from '@/components/project/DeploymentsTab';
import { ConsoleTab } from '@/components/project/ConsoleTab';
import { SettingsTab } from '@/components/project/SettingsTab';
import { ProjectHeader } from '@/components/project/ProjectHeader';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function formatBuildDiagnosisDetail(diagnosis: BuildDiagnosis, t: (key: string) => string): string {
  const lines = ['Root cause:' + '\n' + diagnosis.rootCause, ''];

  if (diagnosis.suggestedFixes.length > 0) {
    lines.push('Suggested fixes:');
    diagnosis.suggestedFixes.forEach((fix, index) => {
      const location = fix.location ? ' (' + fix.location + ')' : '';
      lines.push(String(index + 1) + '. [' + fix.confidence + '] ' + fix.description + location);
    });
  } else {
    lines.push(t('projectDetail.diagnosis.noFixes'));
  }

  if (diagnosis.rawAnalysis.trim()) {
    lines.push('', 'Raw analysis:' + '\n' + diagnosis.rawAnalysis);
  }

  return lines.join('\n');
}

export function ProjectDetail() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguage();
  const [project, setProject] = useState<ProjectWithOptionalEnvironments | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [timelineRunKey, setTimelineRunKey] = useState(0);
  const [fixWithAIItems, setFixWithAIItems] = useState<TimelineItem[]>([]);
  const [fixingItemId, setFixingItemId] = useState<string | null>(null);
  const [postmortem, setPostmortem] = useState<PostmortemData | null>(null);
  const isMobile = useIsMobile();
  const [shareOpen, setShareOpen] = useState(false);
  const [redeploySheet, setRedeploySheet] = useState(false);
  const [redeployVars, setRedeployVars] = useState<EnvVarInfo[]>([]);
  const [redeployValues, setRedeployValues] = useState<Record<string, string>>({});
  const assistant = useAssistant(id);
  const [addEnvSheet, setAddEnvSheet] = useState<{ open: boolean; type: EnvironmentType | null }>({
    open: false,
    type: null,
  });
  const [addEnvBranch, setAddEnvBranch] = useState('');

  const validEnvs: EnvironmentType[] = ['production', 'staging', 'development'];
  const envParam = searchParams.get('env') as EnvironmentType;
  const currentEnvType = validEnvs.includes(envParam) ? envParam : 'production';

  const environments = project?.environments;
  const selectedEnv = environments?.find((e) => e.type === currentEnvType);

  const handleEnvChange = (env: EnvironmentType) => {
    setSearchParams({ env });
  };

  const handleAddEnv = (env: EnvironmentType) => {
    setAddEnvBranch(project?.branch ?? 'main');
    setAddEnvSheet({ open: true, type: env });
  };

  const confirmAddEnv = async () => {
    const envType = addEnvSheet.type;
    if (!id || !envType || actionLoading) return;
    setActionLoading('add-env');
    try {
      await createEnvironment(id, envType, addEnvBranch.trim() || undefined);
      await fetchProject();
      toast.success(`Created ${envType} environment`);
      setSearchParams({ env: envType });
      setAddEnvSheet({ open: false, type: null });
    } catch (err) {
      console.error('Failed to create environment:', err);
      toast.error(
        'Failed to create environment: ' + (err instanceof Error ? err.message : String(err)),
      );
    } finally {
      setActionLoading(null);
    }
  };

  // Fetch project details
  const fetchProject = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getProject(id);
      setProject(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProject();
    const interval = setInterval(fetchProject, 5000);
    return () => clearInterval(interval);
  }, [fetchProject]);

  useEffect(() => {
    if (!id || (project?.status !== 'running' && project?.status !== 'error')) {
      return;
    }

    const controller = new AbortController();

    const fetchPostmortem = async () => {
      try {
        const res = await fetch(`/api/projects/${id}/postmortem/latest`, {
          signal: controller.signal,
        });
        if (res.status === 204) {
          setPostmortem(null);
          return;
        }
        if (!res.ok) {
          setPostmortem(null);
          return;
        }
        const data = (await res.json()) as PostmortemData;
        setPostmortem(data);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return;
        }
        setPostmortem(null);
      }
    };

    void fetchPostmortem();

    return () => {
      controller.abort();
    };
  }, [id, project?.status]);

  const { items, isStreaming, submitAnswer, skipQuestion, executeAction } = useTimeline({
    projectId: id,
    enabled: !!id,
    runKey: timelineRunKey,
    onSettled: fetchProject,
    onRawEvent: assistant.addDeployEvent,
  });

  const allTimelineItems = useMemo(() => [...items, ...fixWithAIItems], [items, fixWithAIItems]);

  useEffect(() => {
    setFixWithAIItems([]);
    setFixingItemId(null);
  }, [id, timelineRunKey]);

  const handleFixWithAI = async (_errorMessage?: string, timelineItemId?: string) => {
    if (!id || fixingItemId) return;

    const sourceItemId = timelineItemId ?? 'manual-' + Date.now();
    setFixingItemId(sourceItemId);

    try {
      const diagnosis = await debugBuild(id);
      setFixWithAIItems((prev) => [
        ...prev,
        {
          id: 'ai-fix-' + sourceItemId + '-' + Date.now(),
          type: 'insight',
          timestamp: new Date().toISOString(),
          title: 'AI diagnosis:' + ' ' + diagnosis.summary,
          detail: formatBuildDiagnosisDetail(diagnosis, t),
          percent: -1,
          severity: 'warning',
        },
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to analyze build failure';
      setFixWithAIItems((prev) => [
        ...prev,
        {
          id: 'ai-fix-' + sourceItemId + '-' + Date.now() + '-error',
          type: 'insight',
          timestamp: new Date().toISOString(),
          title: t('projectDetail.diagnosis.fixFailed'),
          detail: message,
          percent: -1,
          severity: 'error',
        },
      ]);
      console.error('Fix with AI failed:', err);
    } finally {
      setFixingItemId(null);
    }
  };

  const handleRedeploy = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('redeploy');

    try {
      const scan = await scanProjectEnvVars(id);
      if (scan.newVars.length > 0) {
        setRedeployVars(scan.newVars);
        const initial: Record<string, string> = {};
        for (const v of scan.newVars) initial[v.key] = '';
        setRedeployValues(initial);
        setRedeploySheet(true);
        setActionLoading(null);
        return;
      }
    } catch {
      // scan failed, proceed without env vars
    }

    setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));
    try {
      await redeployProject(id, undefined, currentEnvType);
      setTimelineRunKey((k) => k + 1);
      toast.success('Project redeploying');
    } catch (err) {
      console.error('Redeploy failed:', err);
      toast.error('Redeploy failed: ' + (err instanceof Error ? err.message : String(err)));
      try {
        const data = await getProject(id);
        setProject(data);
      } catch {
        // silent
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('stop');
    try {
      await stopProject(id, currentEnvType);
      toast.success('Project stopped');
    } catch (err) {
      console.error('Stop failed:', err);
      toast.error('Stop failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setActionLoading(null);
    }
  };

  const handleStart = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('start');
    try {
      await startProject(id, currentEnvType);
      await fetchProject();
      toast.success('Project started');
    } catch (err) {
      console.error('Start failed:', err);
      toast.error('Start failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRollback = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    if (!project?.previousImageTag) return;

    setActionLoading('rollback');
    setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));

    try {
      await rollbackProject(id, currentEnvType);
      setTimelineRunKey((k) => k + 1);
      toast.success('Project rolling back');
    } catch (err) {
      console.error('Rollback failed:', err);
      toast.error('Rollback failed: ' + (err instanceof Error ? err.message : String(err)));
      try {
        const data = await getProject(id);
        setProject(data);
      } catch {
        // silent
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleBlueGreen = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('bluegreen');
    setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));
    try {
      await blueGreenProject(id, undefined, currentEnvType);
      setTimelineRunKey((k) => k + 1);
      toast.success('Blue-green deploy started');
    } catch (err) {
      console.error('Blue-green deploy failed:', err);
      toast.error(
        'Blue-green deploy failed: ' + (err instanceof Error ? err.message : String(err)),
      );
      try {
        const data = await getProject(id);
        setProject(data);
      } catch {
        /* silent */
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!id || actionLoading) return;
    if (currentEnvType === 'production') {
      if (!confirm('Are you sure you want to delete this project?')) return;
      setActionLoading('delete');
      try {
        await deleteProject(id);
        window.location.href = '/projects';
      } catch (err) {
        toast.error('Delete failed: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setActionLoading(null);
      }
    } else {
      if (!selectedEnv) return;
      if (!confirm(`Are you sure you want to delete the ${currentEnvType} environment?`)) return;
      setActionLoading('delete');
      try {
        await deleteEnvironment(id, selectedEnv.id);
        toast.success('Environment deleted');
        handleEnvChange('production');
        await fetchProject();
      } catch (err) {
        toast.error('Delete failed: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setActionLoading(null);
      }
    }
  };

  const displayProject = useMemo(() => {
    if (!project) return null;
    if (!selectedEnv) return project;
    return {
      ...project,
      status: selectedEnv.status,
      branch: selectedEnv.branch,
      publicUrl: selectedEnv.publicUrl,
      port: selectedEnv.assignedPort ?? project.port,
      url: currentEnvType === 'production' ? project.url : undefined,
    };
  }, [project, selectedEnv, currentEnvType]);

  if (loading) {
    return (
      <div className="flex flex-col h-full">
        <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel/50 px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Skeleton className="h-3 w-3 rounded-full" />
              <div>
                <Skeleton className="h-6 w-48 mb-2" />
                <div className="flex items-center gap-3">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-7 w-7" />
            </div>
          </div>
        </div>
        <div className="flex-1 p-4">
          <Skeleton className="h-10 w-full max-w-md mb-4" />
          <Skeleton className="h-[600px] w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm font-body text-secondary-ol">{t('projectDetail.notFound')}</p>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col h-full">
        <ProjectHeader
          project={project}
          environments={environments}
          currentEnvType={currentEnvType}
          onEnvChange={handleEnvChange}
          onAddEnv={handleAddEnv}
          actionLoading={actionLoading}
          onRedeploy={handleRedeploy}
          onStop={handleStop}
          onStart={handleStart}
          onRollback={handleRollback}
          onBlueGreen={handleBlueGreen}
          onShare={() => setShareOpen(true)}
          onDelete={handleDelete}
        />

        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex-1 flex flex-col min-h-0"
        >
          <TabsList className="shrink-0 w-full justify-start rounded-none border-b border-[hsl(var(--border))] bg-transparent px-6 h-10">
            <TabsTrigger
              value="overview"
              className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
            >
              <Activity className="h-3.5 w-3.5" />
              Overview
            </TabsTrigger>
            <TabsTrigger
              value="deployments"
              className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
            >
              <History className="h-3.5 w-3.5" />
              Deployments
            </TabsTrigger>
            <TabsTrigger
              value="console"
              className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
            >
              <SquareTerminal className="h-3.5 w-3.5" />
              Console
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
            >
              <Settings className="h-3.5 w-3.5" />
              Settings
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 min-h-0 mt-0">
            {id && displayProject && (
              <OverviewTab
                projectId={id}
                projectStatus={displayProject.status}
                displayProject={displayProject}
                timelineItems={allTimelineItems}
                isTimelineStreaming={isStreaming}
                postmortem={postmortem}
                fixingItemId={fixingItemId}
                onSubmitAnswer={submitAnswer}
                onSkipQuestion={skipQuestion}
                onInsightAction={executeAction}
                onFixWithAI={handleFixWithAI}
                onOpenLogs={() => setActiveTab('console')}
                assistantItems={assistant.items}
                isAssistantStreaming={assistant.isStreaming}
                onSendMessage={assistant.sendMessage}
              />
            )}
          </TabsContent>

          <TabsContent value="deployments" className="flex-1 min-h-0 mt-0">
            {id && displayProject && (
              <DeploymentsTab
                projectId={id}
                projectStatus={displayProject.status}
                projectBranch={displayProject.branch}
              />
            )}
          </TabsContent>

          <TabsContent value="console" className="flex-1 min-h-0 mt-0">
            {id && displayProject && (
              <ConsoleTab
                projectId={id}
                isActive={activeTab === 'console'}
                projectStatus={displayProject.status}
              />
            )}
          </TabsContent>

          <TabsContent value="settings" className="flex-1 min-h-0 mt-0">
            {id && displayProject && (
              <SettingsTab projectId={id} projectStatus={displayProject.status} />
            )}
          </TabsContent>
        </Tabs>
      </div>

      <Sheet open={redeploySheet} onOpenChange={setRedeploySheet}>
        <SheetContent side="left" className="w-[400px] sm:w-[540px]">
          <SheetHeader>
            <SheetTitle>{'New Environment Variables'}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              {`Found ${String(redeployVars.length)} new environment variable${redeployVars.length !== 1 ? 's' : ''}.`}
            </div>
            <div className="space-y-3 max-h-64 overflow-y-auto pr-1">
              {redeployVars.map((v) => (
                <div key={v.key} className="space-y-1">
                  <label className="text-sm font-medium font-mono">{v.key}</label>
                  <Input
                    placeholder={`Value for ${v.key}`}
                    value={redeployValues[v.key] ?? ''}
                    onChange={(e) =>
                      setRedeployValues((prev) => ({ ...prev, [v.key]: e.target.value }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setRedeploySheet(false)}>
              {'Cancel'}
            </Button>
            <Button
              className="bg-foreground text-background hover:bg-foreground/90"
              onClick={async () => {
                setRedeploySheet(false);
                setActionLoading('redeploy');
                setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));
                try {
                  await redeployProject(id!, redeployValues, currentEnvType);
                  setTimelineRunKey((k) => k + 1);
                  toast.success('Project redeploying');
                } catch (err) {
                  toast.error(
                    'Redeploy failed: ' + (err instanceof Error ? err.message : String(err)),
                  );
                } finally {
                  setActionLoading(null);
                }
              }}
            >
              {'Redeploy'}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Dialog
        open={addEnvSheet.open}
        onOpenChange={(open) => setAddEnvSheet((prev) => ({ ...prev, open }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {addEnvSheet.type ? `Create ${addEnvSheet.type} environment` : 'Create environment'}
            </DialogTitle>
            <DialogDescription>
              {'Choose which branch this environment should track.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 pt-2">
            <label
              htmlFor="env-branch"
              className="text-xs font-medium leading-none flex items-center gap-1.5 text-secondary-ol"
            >
              <GitBranch className="h-3 w-3" />
              {'Branch'}
            </label>
            <Input
              id="env-branch"
              placeholder={project?.branch ?? 'main'}
              value={addEnvBranch}
              onChange={(e) => setAddEnvBranch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void confirmAddEnv();
                }
              }}
              className="h-8 text-sm"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddEnvSheet({ open: false, type: null })}
            >
              {'Cancel'}
            </Button>
            <Button
              size="sm"
              className="bg-foreground text-background hover:bg-foreground/90"
              disabled={actionLoading === 'add-env'}
              onClick={() => void confirmAddEnv()}
            >
              {'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShareDialog
        projectId={id!}
        projectName={project.name}
        isRunning={project.status === 'running'}
        visibility={project.visibility}
        publicUrl={project.publicUrl ?? null}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onShareChange={fetchProject}
      />
    </>
  );
}
