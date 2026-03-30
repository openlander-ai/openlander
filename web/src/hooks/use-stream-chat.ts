import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { streamChat } from '@/lib/api';
import type {
  ChatMessage,
  ChatStreamEvent,
  QuestionRequest,
  ToolCallInfo,
  ToolResult,
} from '@/lib/chat-types';

interface UseStreamChatReturn {
  messages: ChatMessage[];
  isStreaming: boolean;
  pendingQuestion: QuestionRequest | null;
  error: string | null;
  sendMessage: (message: string) => void;
  abort: () => void;
  clearMessages: () => void;
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>;
}

function createMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function parseEventLine(line: string): ChatStreamEvent | null {
  if (!line.trim()) return null;
  try {
    return JSON.parse(line) as ChatStreamEvent;
  } catch {
    return null;
  }
}

export function useStreamChat(): UseStreamChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<QuestionRequest | null>(null);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const sendMessage = useCallback(
    (message: string) => {
      const trimmedMessage = message.trim();
      if (!trimmedMessage || isStreaming) {
        return;
      }

      const userMessage: ChatMessage = {
        id: createMessageId(),
        role: 'user',
        content: trimmedMessage,
        createdAt: new Date().toISOString(),
      };

      const assistantMessageId = createMessageId();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        toolCalls: [],
        createdAt: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, userMessage, assistantMessage]);
      setIsStreaming(true);
      setError(null);
      setPendingQuestion(null);

      const controller = new AbortController();
      abortRef.current = controller;

      const updateAssistantMessage = (updater: (draft: ChatMessage) => ChatMessage): void => {
        setMessages((prev) =>
          prev.map((item) => {
            if (item.id !== assistantMessageId) {
              return item;
            }
            return updater(item);
          }),
        );
      };

      const updateToolCallResult = (toolName: string, toolResult: ToolResult): void => {
        updateAssistantMessage((draft) => {
          const toolCalls = [...(draft.toolCalls ?? [])];
          for (let i = toolCalls.length - 1; i >= 0; i -= 1) {
            if (toolCalls[i].toolName === toolName && !toolCalls[i].toolResult) {
              toolCalls[i] = { ...toolCalls[i], toolResult };
              return { ...draft, toolCalls };
            }
          }
          toolCalls.push({ toolName, arguments: {}, toolResult });
          return { ...draft, toolCalls };
        });
      };

      const applyDoneToolResults = (toolResults: ToolResult[] | undefined): void => {
        if (!toolResults?.length) {
          return;
        }

        updateAssistantMessage((draft) => {
          const toolCalls = [...(draft.toolCalls ?? [])];
          for (const result of toolResults) {
            const index = toolCalls.findIndex(
              (toolCall) => toolCall.toolName === result.toolName && !toolCall.toolResult,
            );
            if (index >= 0) {
              toolCalls[index] = { ...toolCalls[index], toolResult: result };
            } else {
              toolCalls.push({ toolName: result.toolName, arguments: {}, toolResult: result });
            }
          }
          return { ...draft, toolCalls };
        });
      };

      const handleEvent = (event: ChatStreamEvent): void => {
        switch (event.type) {
          case 'session':
          case 'thinking': {
            break;
          }
          case 'tool_call': {
            const toolCall: ToolCallInfo = {
              toolName: event.toolName,
              arguments: event.arguments,
              stepIndex: event.stepIndex,
            };
            updateAssistantMessage((draft) => ({
              ...draft,
              toolCalls: [...(draft.toolCalls ?? []), toolCall],
            }));
            break;
          }
          case 'tool_result': {
            updateToolCallResult(event.toolName, {
              toolName: event.toolName,
              success: event.success,
              result: event.result,
              error: event.error,
            });
            break;
          }
          case 'message': {
            updateAssistantMessage((draft) => ({ ...draft, content: event.content }));
            break;
          }
          case 'question': {
            setPendingQuestion(event.request);
            break;
          }
          case 'done': {
            applyDoneToolResults(event.toolResults);
            break;
          }
          case 'error': {
            setError(event.error);
            break;
          }
          default:
            break;
        }
      };

      void (async () => {
        try {
          const response = await streamChat(trimmedMessage, controller.signal);

          if (!response.body) {
            throw new Error('Response body is null');
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            for (const line of lines) {
              const event = parseEventLine(line);
              if (!event) continue;
              handleEvent(event);
            }
          }

          const trailingEvent = parseEventLine(buffer);
          if (trailingEvent) {
            handleEvent(trailingEvent);
          }
        } catch (err) {
          if (!controller.signal.aborted) {
            const messageText = err instanceof Error ? err.message : 'Stream failed';
            setError(messageText);
          }
        } finally {
          if (abortRef.current === controller) {
            abortRef.current = null;
          }
          setIsStreaming(false);
        }
      })();
    },
    [isStreaming],
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setIsStreaming(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setPendingQuestion(null);
  }, []);

  return {
    messages,
    isStreaming,
    pendingQuestion,
    error,
    sendMessage,
    abort,
    clearMessages,
    setMessages,
  };
}
