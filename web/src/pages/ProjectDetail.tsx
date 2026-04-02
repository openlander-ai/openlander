import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { useParams } from 'react-router-dom';
import { toast } from 'sonner';
import {
  getProject,
  redeployProject,
  startProject,
  stopProject,
  rollbackProject,
  blueGreenProject,
  scanProjectEnvVars,
  archiveProject,
  unarchiveProject,
  purgeProject,
  type EnvVarInfo,
  type ProjectWithOptionalEnvironments,
} from '@/lib/api';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { useTimeline } from '@/hooks/use-timeline';
import { ShareDialog } from '@/components/layout/ShareDialog';
import { parseEnvContent } from '@/lib/parse-env';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

import { ProjectHeader } from '@/components/project/ProjectHeader';
import { ProjectDetailLoading } from '@/components/project/ProjectDetailLoading';
import { ProjectDetailTabs } from '@/components/project/ProjectDetailTabs';
import { RedeployEnvDialog } from '@/components/project/RedeployEnvDialog';
import { RollbackDialog } from '@/components/project/RollbackDialog';
import { BlueGreenDialog } from '@/components/project/BlueGreenDialog';

export function ProjectDetail() {
  const { id } = useParams();
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
  const [confirmAction, setConfirmAction] = useState<{
    type: 'stop' | 'archive';
    handler: () => void;
  } | null>(null);
  const [purgeDialogOpen, setPurgeDialogOpen] = useState(false);
  const [purgeInput, setPurgeInput] = useState('');

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

  const allTimelineItems = items;

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
      await redeployProject(id, undefined);
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
          await stopProject(id);
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
      await redeployProject(id!, undefined);
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
      await redeployProject(id!, Object.keys(vars).length > 0 ? vars : undefined);
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
      await startProject(id);
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
      await rollbackProject(id, deploymentId);
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
      await blueGreenProject(id, healthCheckPath);
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

  const handleArchive = async () => {
    if (!id || actionLoading) return;
    setConfirmAction({
      type: 'archive',
      handler: async () => {
        setActionLoading('archive');
        try {
          await archiveProject(id);
          toast.success(t('projects.archive.success'));
          window.location.href = '/projects';
        } catch (err) {
          toast.error('Archive failed: ' + (err instanceof Error ? err.message : String(err)));
        } finally {
          setActionLoading(null);
        }
      },
    });
  };

  const handleUnarchive = async () => {
    if (!id || actionLoading) return;
    setActionLoading('unarchive');
    try {
      await unarchiveProject(id);
      toast.success(t('projects.unarchive.success'));
      await fetchProject();
    } catch (err) {
      toast.error('Unarchive failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setActionLoading(null);
    }
  };

  const handlePurge = () => {
    if (!id || actionLoading) return;
    setPurgeInput('');
    setPurgeDialogOpen(true);
  };

  const handlePurgeConfirm = async () => {
    if (!id || actionLoading) return;
    setActionLoading('purge');
    try {
      await purgeProject(id);
      window.location.href = '/projects';
    } catch (err) {
      toast.error('Purge failed: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setActionLoading(null);
      setPurgeDialogOpen(false);
    }
  };

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
          actionLoading={actionLoading}
          onRedeploy={handleRedeploy}
          onStop={handleStop}
          onStart={handleStart}
          onRollback={handleRollback}
          onOpenBlueGreenDialog={handleBlueGreen}
          onShare={() => setShareOpen(true)}
          onArchive={handleArchive}
          onUnarchive={handleUnarchive}
          onPurge={handlePurge}
        />

        <ProjectDetailTabs
          id={id}
          activeTab={activeTab}
          onActiveTabChange={setActiveTab}
          displayProject={project}
          allTimelineItems={allTimelineItems}
          isStreaming={isStreaming}
          timelineDisconnected={timelineDisconnected}
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

      <RollbackDialog
        open={rollbackDialogOpen}
        onOpenChange={setRollbackDialogOpen}
        projectId={id!}
        projectName={project.name}
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
        isRunning={project.status === 'running'}
        visibility={project.visibility}
        publicUrl={project.publicUrl ?? null}
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
          confirmAction?.type === 'archive'
            ? t('projects.archive.button')
            : t('project.confirm.stopTitle')
        }
        description={
          confirmAction?.type === 'archive'
            ? t('projects.archive.description')
            : t('project.confirm.stopDescription').replace('{env}', 'production')
        }
        confirmLabel={t('project.confirm.confirm')}
        cancelLabel={t('project.confirm.cancel')}
        variant={confirmAction?.type === 'archive' ? 'destructive' : 'default'}
        onConfirm={() => {
          confirmAction?.handler();
          setConfirmAction(null);
        }}
      />

      <Dialog open={purgeDialogOpen} onOpenChange={setPurgeDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-error">{t('projects.purge.title')}</DialogTitle>
            <DialogDescription>{t('projects.purge.description')}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={purgeInput}
              onChange={(e) => setPurgeInput(e.target.value)}
              placeholder={t('projects.purge.inputPlaceholder')}
              className="w-full"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPurgeDialogOpen(false)}>
              {t('project.confirm.cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handlePurgeConfirm}
              disabled={purgeInput !== project.name || actionLoading === 'purge'}
            >
              {actionLoading === 'purge' ? <Spinner className="mr-2 h-4 w-4" /> : null}
              {t('projects.purge.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
