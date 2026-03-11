import { useEffect, useState } from 'react';
import { TimelineFeed } from '@/components/timeline/TimelineFeed';
import { PostmortemCard } from '@/components/timeline/PostmortemCard';
import { LogPreview } from '@/components/timeline/LogPreview';
import { ChatMessageList } from '@/components/assistant/ChatMessageList';
import type { AssistantItem } from '@/hooks/use-assistant';
import type { TimelineItem } from '@/lib/event-types';
import type { PostmortemData } from '@/lib/api';
import type { QuestionAnswerPayload } from '@/components/timeline/InputRequestCard';
import { SummaryDashboard } from '@/components/project/SummaryDashboard';
import { getProject } from '@/lib/api';
import type { Project } from '@/types';

interface OverviewTabProps {
  projectId: string;
  projectStatus: string;
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
      {/* Left pane: Timeline + Log Preview */}
      <div className="flex-1 min-w-0 min-h-0 overflow-auto p-4 space-y-4 border-b md:border-b-0 md:border-r border-[hsl(var(--border))]">
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
              <TimelineFeed
                items={timelineItems}
                isStreaming={isTimelineStreaming}
                projectStatus={projectStatus}
                onSubmitAnswer={onSubmitAnswer}
                onSkipQuestion={onSkipQuestion}
                onInsightAction={onInsightAction}
                onFixWithAI={onFixWithAI}
                fixingItemId={fixingItemId}
              />
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
              project={project || { status: projectStatus }}
              recentEvents={timelineItems}
            />
          </section>
        )}
      </div>

      {/* Right pane: AI Assistant */}
      <ChatMessageList
        assistantItems={assistantItems}
        isStreaming={isAssistantStreaming}
        onSendMessage={onSendMessage}
        onSubmitAnswer={onSubmitAnswer}
        onSkipQuestion={onSkipQuestion}
      />
    </div>
  );
}
