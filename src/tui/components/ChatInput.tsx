import React, { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import Spinner from 'ink-spinner';

interface ChatInputProps {
  isLoading: boolean;
  lastMessage: string | null;
  onSubmit: (text: string) => void;
  agentAvailable: boolean;
}

export function ChatInput({
  isLoading,
  lastMessage,
  onSubmit,
  agentAvailable,
}: ChatInputProps): React.ReactElement {
  const [value, setValue] = useState('');

  const handleSubmit = (text: string) => {
    if (!text.trim()) return;
    onSubmit(text);
    setValue('');
  };

  if (!agentAvailable) {
    return (
      <Box
        borderStyle="single"
        borderTop
        borderBottom={false}
        borderLeft={false}
        borderRight={false}
        paddingX={1}
      >
        <Text dimColor>💬 Chat unavailable — configure LLM in setup</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
    >
      {lastMessage && (
        <Box paddingX={1}>
          <Text color="green">🤖 </Text>
          <Text>{lastMessage.length > 200 ? lastMessage.slice(0, 200) + '...' : lastMessage}</Text>
        </Box>
      )}
      <Box paddingX={1}>
        {isLoading ? (
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text dimColor> Thinking...</Text>
          </Box>
        ) : (
          <Box>
            <Text color="cyan">💬 </Text>
            <TextInput
              value={value}
              onChange={setValue}
              onSubmit={handleSubmit}
              placeholder="Ask the agent anything..."
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
