import { useEffect, useState, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { LogPreview } from '@/components/timeline/LogPreview';
import { DeployTerminalSession } from '@/components/deploy-terminal/DeployTerminalSession';
import type { TimelineItem } from '@/lib/event-types';
import type { QuestionAnswerPayload } from '@/components/timeline/InputRequestCard';
import { SummaryDashboard } from '@/components/project/SummaryDashboard';
import { getProject } from '@/lib/api';
import type { Project } from '@/types';
import { cn } from '@/lib/utils';

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
  onSubmitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion: (questionId: string) => void;
  onInsightAction: (projectId: string, action: string) => Promise<void>;
  onOpenLogs: () => void;
}

export function OverviewTab({
  projectId,
  projectStatus,
  displayProject,
  timelineItems,
  isTimelineStreaming,
  onSubmitAnswer,
  onSkipQuestion,
  onOpenLogs,
}: OverviewTabProps) {
  const [project, setProject] = useState<Project | null>(null);
  const [wasBuilding, setWasBuilding] = useState(false);

  useEffect(() => {
    if (projectStatus === 'building') {
      setWasBuilding(true);
    }
  }, [projectStatus]);

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

  const showTimeline =
    projectStatus === 'building' ||
    projectStatus === 'error' ||
    (projectStatus === 'running' && wasBuilding);

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      <div
        className={cn(
          'flex-1 min-w-0 min-h-0 overflow-auto p-4 space-y-4 border-b md:border-b-0 border-[hsl(var(--border))]',
          !showTimeline && 'md:border-r',
        )}
      >
        {showTimeline ? (
          <>
            <section className="rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
              <LocalErrorBoundary>
                <DeployTerminalSession
                  projectName={displayProject?.name || project?.name || projectId}
                  branchName={displayProject?.branch || project?.branch}
                  projectStatus={projectStatus}
                  timelineItems={timelineItems}
                  isTimelineStreaming={isTimelineStreaming}
                  onSubmitAnswer={onSubmitAnswer}
                  onSkipQuestion={onSkipQuestion}
                />
              </LocalErrorBoundary>
            </section>

            {projectId && (
              <section className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden">
                <LogPreview projectId={projectId} status={projectStatus} onOpenLogs={onOpenLogs} />
              </section>
            )}
          </>
        ) : (
          <section className="flex flex-col">
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
        )}
      </div>
    </div>
  );
}
