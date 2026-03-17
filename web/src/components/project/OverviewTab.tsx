import { useEffect, useState, Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { PostmortemCard } from '@/components/timeline/PostmortemCard';
import { LogPreview } from '@/components/timeline/LogPreview';
import { ChatMessageList } from '@/components/assistant/ChatMessageList';
import { UnifiedBriefingFeed } from '@/components/project/UnifiedBriefingFeed';
import type { AssistantItem } from '@/hooks/use-assistant';
import type { TimelineItem } from '@/lib/event-types';
import type { PostmortemData } from '@/lib/api';
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
    console.error('UnifiedBriefingFeed Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-sm text-error bg-error/10 border border-error/20 rounded-lg m-4">
          Failed to load briefing feed. Please refresh the page.
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
  postmortem: PostmortemData | null;
  fixingItemId: string | null;
  onSubmitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  onSkipQuestion: (questionId: string) => void;
  onInsightAction: (projectId: string, action: string) => Promise<void>;
  onFixWithAI: (errorMessage?: string, timelineItemId?: string) => void;
  onOpenLogs: () => void;
  // Assistant props
  assistantItems: AssistantItem[];
  isAssistantStreaming: boolean;
  onSendMessage: (message: string) => void;
}

export function OverviewTab({
  projectId,
  projectStatus,
  displayProject,
  timelineItems,
  isTimelineStreaming,
  postmortem,
  fixingItemId,
  onSubmitAnswer,
  onSkipQuestion,
  onInsightAction,
  onFixWithAI,
  onOpenLogs,
  assistantItems,
  isAssistantStreaming,
  onSendMessage,
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

  const showTimeline = projectStatus === 'building' || projectStatus === 'error';

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0">
      <div
        className={cn(
          'flex-1 min-w-0 min-h-0 overflow-auto p-4 space-y-4 border-b md:border-b-0 border-[hsl(var(--border))]',
          !showTimeline && 'md:border-r',
        )}
      >
        {postmortem && (
          <PostmortemCard
            projectId={postmortem.projectId}
            projectName={postmortem.projectName}
            markdown={postmortem.markdown}
            generatedAt={postmortem.generatedAt}
          />
        )}
        {showTimeline ? (
          <>
            <section className="rounded-lg border border-[hsl(var(--border))] bg-bg-panel overflow-hidden flex flex-col h-[500px]">
              <LocalErrorBoundary>
                <UnifiedBriefingFeed
                  timelineItems={timelineItems}
                  isTimelineStreaming={isTimelineStreaming}
                  projectStatus={projectStatus}
                  fixingItemId={fixingItemId}
                  onFixWithAI={onFixWithAI}
                  onSubmitAnswer={onSubmitAnswer}
                  onSkipQuestion={onSkipQuestion}
                  onInsightAction={onInsightAction}
                  assistantItems={assistantItems}
                  isAssistantStreaming={isAssistantStreaming}
                  onSendMessage={onSendMessage}
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

      {!showTimeline && (
        <ChatMessageList
          assistantItems={assistantItems}
          isStreaming={isAssistantStreaming}
          onSendMessage={onSendMessage}
          onSubmitAnswer={onSubmitAnswer}
          onSkipQuestion={onSkipQuestion}
        />
      )}
    </div>
  );
}
