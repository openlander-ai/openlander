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
  scanProjectEnvVars,
  deleteProject,
  deleteEnvironment,
  createEnvironment,
  type EnvVarInfo,
  type ProjectWithOptionalEnvironments,
} from '@/lib/api';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { useTimeline } from '@/hooks/use-timeline';
import { ShareDialog } from '@/components/sidebar/ShareDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { EnvironmentType } from '@/types';
import { parseEnvContent } from '@/lib/parse-env';

import { Activity, History, SquareTerminal, Settings, GitBranch } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ProjectDetail() {
  const { id } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const { t } = useLanguage();
  const [project, setProject] = useState<ProjectWithOptionalEnvironments | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');
  const [timelineRunKey, setTimelineRunKey] = useState(0);
  const isMobile = useIsMobile();
  const [shareOpen, setShareOpen] = useState(false);
  const [redeploySheet, setRedeploySheet] = useState(false);
  const [redeployVars, setRedeployVars] = useState<EnvVarInfo[]>([]);
  const [redeployPasteText, setRedeployPasteText] = useState('');
  const [addEnvSheet, setAddEnvSheet] = useState<{ open: boolean; type: EnvironmentType | null }>({
    open: false,
    type: null,
  });
  const [addEnvBranch, setAddEnvBranch] = useState('');

  const validEnvs: EnvironmentType[] = ['production', 'development'];
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

  const { items, isStreaming } = useTimeline({
    projectId: id,
    enabled: !!id,
    runKey: timelineRunKey,
    onSettled: fetchProject,
  });

  const allTimelineItems = useMemo(() => items, [items]);

  const handleRedeploy = async () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setActionLoading('redeploy');

    try {
      const scan = await scanProjectEnvVars(id, currentEnvType);
      if (scan.newVars.length > 0) {
        setRedeployVars(scan.newVars);
        setRedeployPasteText('');
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
                onOpenLogs={() => setActiveTab('console')}
                onRedeploy={handleRedeploy}
                onStop={handleStop}
                onRollback={handleRollback}
              />
            )}
          </TabsContent>

          <TabsContent value="deployments" className="flex-1 min-h-0 mt-0">
            {id && displayProject && (
              <DeploymentsTab
                projectId={id}
                projectStatus={displayProject.status}
                projectBranch={displayProject.branch}
                environmentId={selectedEnv?.id}
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

      <Dialog open={redeploySheet} onOpenChange={setRedeploySheet}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{'Environment Variables'}</DialogTitle>
            <DialogDescription>
              {`Found ${String(redeployVars.length)} new environment variable${redeployVars.length !== 1 ? 's' : ''}. Paste your .env file below.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <textarea
              className="w-full rounded-md px-3 py-2 text-xs font-mono bg-bg-app border border-border text-primary-ol placeholder:text-muted-ol resize-none focus:outline-none focus:ring-1 focus:ring-agent/40"
              rows={10}
              placeholder={redeployVars.map((v) => v.key + '=').join('\n')}
              value={redeployPasteText}
              onChange={(e) => setRedeployPasteText(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRedeploySheet(false)}>
              {'Cancel'}
            </Button>
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-primary-ol transition-colors"
              onClick={async () => {
                setRedeploySheet(false);
                setActionLoading('redeploy');
                setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));
                try {
                  await redeployProject(id!, undefined, currentEnvType);
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
              {'Skip'}
            </button>
            <Button
              className="bg-foreground text-background hover:bg-foreground/90"
              onClick={async () => {
                const parsed = parseEnvContent(redeployPasteText);
                const vars: Record<string, string> = {};
                for (const { key, value } of parsed) {
                  if (value.trim()) vars[key] = value.trim();
                }
                setRedeploySheet(false);
                setActionLoading('redeploy');
                setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));
                try {
                  await redeployProject(
                    id!,
                    Object.keys(vars).length > 0 ? vars : undefined,
                    currentEnvType,
                  );
                  setTimelineRunKey((k) => k + 1);
                  toast.success('Project deploying');
                } catch (err) {
                  toast.error(
                    'Deploy failed: ' + (err instanceof Error ? err.message : String(err)),
                  );
                } finally {
                  setActionLoading(null);
                }
              }}
            >
              {'Deploy'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
