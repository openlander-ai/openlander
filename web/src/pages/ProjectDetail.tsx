import { useState, useEffect, useCallback, useMemo } from 'react';
import { useLanguage } from '@/i18n/context';
import { useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
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
import { ShareDialog } from '@/components/layout/ShareDialog';
import type { EnvironmentType } from '@/types';
import { parseEnvContent } from '@/lib/parse-env';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

import { ProjectHeader } from '@/components/project/ProjectHeader';
import { ProjectDetailLoading } from '@/components/project/ProjectDetailLoading';
import { ProjectDetailTabs } from '@/components/project/ProjectDetailTabs';
import { RedeployEnvDialog } from '@/components/project/RedeployEnvDialog';
import { AddEnvironmentDialog } from '@/components/project/AddEnvironmentDialog';
import { RollbackDialog } from '@/components/project/RollbackDialog';
import { BlueGreenDialog } from '@/components/project/BlueGreenDialog';

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
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
  const [blueGreenDialogOpen, setBlueGreenDialogOpen] = useState(false);
  const [redeployVars, setRedeployVars] = useState<EnvVarInfo[]>([]);
  const [redeployPasteText, setRedeployPasteText] = useState('');
  const [addEnvSheet, setAddEnvSheet] = useState<{ open: boolean; type: EnvironmentType | null }>({
    open: false,
    type: null,
  });
  const [addEnvBranch, setAddEnvBranch] = useState('');
  const [confirmAction, setConfirmAction] = useState<{
    type: 'stop' | 'delete';
    handler: () => void;
  } | null>(null);
  const [envFade, setEnvFade] = useState(false);

  const validEnvs: EnvironmentType[] = ['production', 'development'];
  const envParam = searchParams.get('env') as EnvironmentType;
  const currentEnvType = validEnvs.includes(envParam) ? envParam : 'production';

  const environments = project?.environments;
  const selectedEnv = environments?.find((e) => e.type === currentEnvType);

  // Trigger opacity fade when environment changes
  useEffect(() => {
    setEnvFade(true);
    const timer = setTimeout(() => setEnvFade(false), 150);
    return () => clearTimeout(timer);
  }, [currentEnvType]);

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

  const {
    items,
    isStreaming,
    disconnected: timelineDisconnected,
  } = useTimeline({
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

  const handleStop = () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;
    setConfirmAction({
      type: 'stop',
      handler: async () => {
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
      },
    });
  };

  const handleRedeploySkip = async () => {
    setRedeploySheet(false);
    setActionLoading('redeploy');
    setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));
    try {
      await redeployProject(id!, undefined, currentEnvType);
      setTimelineRunKey((k) => k + 1);
      toast.success('Project redeploying');
    } catch (err) {
      toast.error('Redeploy failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setActionLoading(null);
    }
  };

  const handleRedeployWithEnv = async () => {
    const parsed = parseEnvContent(redeployPasteText);
    const vars: Record<string, string> = {};
    for (const { key, value } of parsed) {
      if (value.trim()) vars[key] = value.trim();
    }
    setRedeploySheet(false);
    setActionLoading('redeploy');
    setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));
    try {
      await redeployProject(id!, Object.keys(vars).length > 0 ? vars : undefined, currentEnvType);
      setTimelineRunKey((k) => k + 1);
      toast.success('Project deploying');
    } catch (err) {
      toast.error('Deploy failed: ' + (err instanceof Error ? err.message : String(err)));
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

  const handleRollback = () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) return;

    setRollbackDialogOpen(true);
  };

  const handleRollbackConfirm = async (deploymentId: string) => {
    if (!id || actionLoading) return;
    setActionLoading('rollback');
    setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));

    try {
      await rollbackProject(id, currentEnvType, deploymentId);
      setTimelineRunKey((k) => k + 1);
      setRollbackDialogOpen(false);
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

  const handleBlueGreen = () => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    if (!id || actionLoading) {
      return;
    }

    setBlueGreenDialogOpen(true);
  };

  const handleBlueGreenConfirm = async (healthCheckPath?: string) => {
    if (!id || actionLoading) {
      return;
    }

    setActionLoading('bluegreen');
    setProject((prev) => (prev ? { ...prev, status: 'building' } : prev));

    try {
      await blueGreenProject(id, healthCheckPath, currentEnvType);
      setTimelineRunKey((k) => k + 1);
      setBlueGreenDialogOpen(false);
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
      setConfirmAction({
        type: 'delete',
        handler: async () => {
          setActionLoading('delete');
          try {
            await deleteProject(id);
            window.location.href = '/projects';
          } catch (err) {
            toast.error('Delete failed: ' + (err instanceof Error ? err.message : String(err)));
          } finally {
            setActionLoading(null);
          }
        },
      });
      return;
    } else {
      if (!selectedEnv) return;
      setConfirmAction({
        type: 'delete',
        handler: async () => {
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
        },
      });
      return;
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
      url: selectedEnv.url || (currentEnvType === 'production' ? project.url : undefined),
      urls: selectedEnv.urls || (currentEnvType === 'production' ? project.urls : undefined),
      previousImageTag: selectedEnv.previousImageTag ?? project.previousImageTag,
    };
  }, [project, selectedEnv, currentEnvType]);

  if (loading) return <ProjectDetailLoading />;

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
          onOpenBlueGreenDialog={handleBlueGreen}
          onShare={() => setShareOpen(true)}
          onDelete={handleDelete}
        />

        <ProjectDetailTabs
          id={id}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          displayProject={displayProject}
          environments={environments}
          allTimelineItems={allTimelineItems}
          isStreaming={isStreaming}
          timelineDisconnected={timelineDisconnected}
          selectedEnvId={selectedEnv?.id}
          currentEnvType={currentEnvType}
          envFade={envFade}
          onRedeploy={handleRedeploy}
          onStop={handleStop}
          onRollback={handleRollback}
        />
      </div>

      <RedeployEnvDialog
        open={redeploySheet}
        onOpenChange={setRedeploySheet}
        redeployVars={redeployVars}
        redeployPasteText={redeployPasteText}
        onRedeployPasteTextChange={setRedeployPasteText}
        onSkip={handleRedeploySkip}
        onDeploy={handleRedeployWithEnv}
      />

      <AddEnvironmentDialog
        open={addEnvSheet.open}
        type={addEnvSheet.type}
        projectBranch={project?.branch}
        branchValue={addEnvBranch}
        onOpenChange={(open) => setAddEnvSheet((prev) => ({ ...prev, open }))}
        onBranchChange={setAddEnvBranch}
        onCancel={() => setAddEnvSheet({ open: false, type: null })}
        onConfirm={() => void confirmAddEnv()}
        isSubmitting={actionLoading === 'add-env'}
      />

      <RollbackDialog
        open={rollbackDialogOpen}
        onOpenChange={setRollbackDialogOpen}
        projectId={id!}
        projectName={project.name}
        currentEnvironment={currentEnvType}
        isSubmitting={actionLoading === 'rollback'}
        onConfirm={handleRollbackConfirm}
      />

      <BlueGreenDialog
        open={blueGreenDialogOpen}
        onOpenChange={setBlueGreenDialogOpen}
        projectName={project.name}
        isSubmitting={actionLoading === 'bluegreen'}
        onConfirm={handleBlueGreenConfirm}
      />

      <ShareDialog
        projectId={id!}
        projectName={project.name}
        isRunning={displayProject?.status === 'running'}
        visibility={project.visibility}
        publicUrl={displayProject?.publicUrl ?? null}
        open={shareOpen}
        onOpenChange={setShareOpen}
        onShareChange={fetchProject}
      />

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmAction(null);
        }}
        title={
          confirmAction?.type === 'delete'
            ? t('project.confirm.deleteTitle')
            : t('project.confirm.stopTitle')
        }
        description={
          confirmAction?.type === 'delete'
            ? t('project.confirm.deleteDescription')
            : t('project.confirm.stopDescription').replace('{env}', currentEnvType ?? 'production')
        }
        confirmLabel={t('project.confirm.confirm')}
        cancelLabel={t('project.confirm.cancel')}
        variant={confirmAction?.type === 'delete' ? 'destructive' : 'default'}
        onConfirm={() => {
          confirmAction?.handler();
          setConfirmAction(null);
        }}
      />
    </>
  );
}
