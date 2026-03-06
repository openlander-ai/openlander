import { useEffect, useRef } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import type { UIChatMessage as Message } from '@/hooks/use-chat';
import { Bot, Terminal } from 'lucide-react';
import {
  InputRequestCard,
  type QuestionAnswerPayload,
} from '@/components/timeline/InputRequestCard';
interface ChatPanelProps {
  messages: Message[];
  isStreaming: boolean;
  sendMessage: (content: string) => void;
  error: string | null;
  submitAnswer: (questionId: string, answers: QuestionAnswerPayload[]) => void;
  skipQuestion: (questionId: string) => void;
}

export function ChatPanel({
  messages,
  isStreaming,
  sendMessage,
  error,
  submitAnswer,
  skipQuestion,
}: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    const scrollContainer = scrollRef.current?.querySelector(
      '[data-radix-scroll-area-viewport]',
    ) as HTMLElement;
    if (scrollContainer) {
      // Use requestAnimationFrame to ensure DOM is updated
      requestAnimationFrame(() => {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      });
    }
  }, [messages, isStreaming]);

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      <div className="flex-1 min-h-0 relative">
        <ScrollArea className="h-full w-full" ref={scrollRef}>
          <div className="flex flex-col p-4 gap-4 min-h-full">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center flex-1 h-full min-h-[400px] text-center space-y-6 text-muted-foreground p-8">
                <div className="bg-primary/10 p-6 rounded-full ring-1 ring-primary/20">
                  <Bot className="h-12 w-12 text-primary" />
                </div>
                <div className="space-y-2">
                  <h3 className="text-2xl font-semibold text-foreground tracking-tight">
                    OpenLander
                  </h3>
                  <p className="max-w-sm text-sm text-muted-foreground">
                    Your AI deployment agent. Give me a repo, and I'll handle the rest.
                  </p>
                </div>

                <div className="grid gap-3 w-full max-w-sm">
                  <button
                    onClick={() => sendMessage('Deploy https://github.com/example/repo')}
                    className="flex items-center gap-3 text-sm bg-card hover:bg-accent/50 p-3 rounded-lg border transition-all hover:shadow-sm group text-left"
                  >
                    <Terminal className="h-4 w-4 text-primary group-hover:text-primary/80" />
                    <span>Deploy a repository...</span>
                  </button>
                  <button
                    onClick={() => sendMessage('List my running projects')}
                    className="flex items-center gap-3 text-sm bg-card hover:bg-accent/50 p-3 rounded-lg border transition-all hover:shadow-sm group text-left"
                  >
                    <Terminal className="h-4 w-4 text-primary group-hover:text-primary/80" />
                    <span>List running projects</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col pb-4">
                {messages.map((msg) => (
                  <div key={msg.id}>
                    <ChatMessage message={msg} />
                    {msg.questionData && (
                      <div className="flex w-full mb-4 justify-start">
                        <div className="max-w-[85%]">
                          <InputRequestCard
                            questionId={msg.questionData.questionId}
                            questions={msg.questionData.questions}
                            answered={msg.questionData.answered}
                            onSubmit={submitAnswer}
                            onSkip={skipQuestion}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                {error && (
                  <div className="p-4 mb-4 text-sm text-red-500 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-200 dark:border-red-900/20">
                    Error: {error}
                  </div>
                )}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
      <ChatInput onSend={sendMessage} isStreaming={isStreaming} />
    </div>
  );
}
