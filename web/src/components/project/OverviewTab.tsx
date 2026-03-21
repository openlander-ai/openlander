import { useEffect, useState, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { LogPreview } from '@/components/timeline/LogPreview';
import { DeployTerminalSession } from '@/components/deploy-terminal/DeployTerminalSession';
import type { TimelineItem } from '@/lib/event-types';
import { SummaryDashboard } from '@/components/project/SummaryDashboard';
import { getProject } from '@/lib/api';
import type { Project } from '@/types';

class LocalErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static getDerivedStateFromError(_error: Error) {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('DeployTerminalSession Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-sm text-error bg-error/10 border border-error/20 rounded-lg m-4">
          Failed to load deploy terminal. Please refresh the page.
        </div>
      );
    }
    return this.props.children;
  }
}

interface OverviewTabProps {
  projectId: string;
  projectStatus: string;
  displayProject?: Project;
  // Timeline props
  timelineItems: TimelineItem[];
  isTimelineStreaming: boolean;
  onOpenLogs: () => void;
}

export function OverviewTab({
  projectId,
  projectStatus,
  displayProject,
  timelineItems,
  isTimelineStreaming,
  onOpenLogs,
}: OverviewTabProps) {
  const [project, setProject] = useState<Project | null>(null);

  useEffect(() => {
    let mounted = true;
    getProject(projectId)
      .then((data) => {
        if (mounted) setProject(data);
      })
      .catch((err) => console.error('Failed to fetch project:', err));
    return () => {
      mounted = false;
    };
  }, [projectId]);

  return (
    <div className="flex flex-col h-full min-h-0 overflow-auto p-6 space-y-6 bg-bg-app">
      <section className="shrink-0">
        <SummaryDashboard
          projectId={projectId}
          project={
            displayProject || project
              ? { ...(displayProject || project), status: projectStatus }
              : { status: projectStatus }
          }
          recentEvents={timelineItems}
        />
      </section>

      <section className="flex-1 min-h-[400px] flex flex-col rounded-xl border border-[hsl(var(--border))] bg-bg-panel overflow-hidden shadow-sm">
        <LocalErrorBoundary>
          <DeployTerminalSession
            projectName={displayProject?.name || project?.name || projectId}
            branchName={displayProject?.branch || project?.branch}
            projectStatus={projectStatus}
            timelineItems={timelineItems}
            isTimelineStreaming={isTimelineStreaming}
          />
        </LocalErrorBoundary>
      </section>

      {projectId && (
        <section className="shrink-0 rounded-xl border border-[hsl(var(--border))] bg-bg-panel overflow-hidden shadow-sm">
          <LogPreview projectId={projectId} status={projectStatus} onOpenLogs={onOpenLogs} />
        </section>
      )}
    </div>
  );
}
