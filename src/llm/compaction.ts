import { generateText } from 'ai';
import type { LanguageModel } from 'ai';
import type { ChatMessage } from './index.js';
import { withTracking } from './tracking-middleware.js';

const SUMMARY_PROMPT =
  'Summarize the following conversation in 3-5 sentences. Include: key decisions made, actions taken, results, and any unresolved issues.';

function formatMessages(messages: ChatMessage[]): string {
  return messages
    .map((message, index) => `${String(index + 1)}. [${message.role}] ${message.content}`)
    .join('\n');
}

export async function compactHistory(
  model: LanguageModel,
  messages: ChatMessage[],
): Promise<string> {
  const conversationText = formatMessages(messages);
  const result = await withTracking({ actionType: 'history_compaction', source: 'auto' }, () =>
    generateText({
      model,
      prompt: `${SUMMARY_PROMPT}\n\nConversation:\n${conversationText}`,
      maxOutputTokens: 500,
    }),
  );

  const summaryText = result.text.trim();
  return summaryText.startsWith('[Summary]') ? summaryText : `[Summary] ${summaryText}`;
}

export { SUMMARY_PROMPT };
