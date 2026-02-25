import React, { useState, useCallback } from 'react';
import { Box, useInput } from 'ink';
import type { AppContext } from '../../app.js';
import { useProjects } from '../hooks/useProjects.js';
import { useSystemStats } from '../hooks/useSystemStats.js';
import { useChat } from '../hooks/useChat.js';
import { Header } from './Header.js';
import { ProjectList } from './ProjectList.js';
import { ProjectDetail } from './ProjectDetail.js';
import { SystemOverview } from './SystemOverview.js';
import { ChatInput } from './ChatInput.js';

interface DashboardProps {
  ctx: AppContext;
}

export function Dashboard({ ctx }: DashboardProps): React.ReactElement {
  const { projects } = useProjects(ctx.db);
  const { stats } = useSystemStats();
  const { messages, isLoading, sendMessage } = useChat(ctx.agent);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [viewingProject, setViewingProject] = useState(false);

  const lastAssistantMessage =
    messages.length > 0
      ? ([...messages].reverse().find((m) => m.role === 'assistant')?.content ?? null)
      : null;

  const handleChatSubmit = useCallback(
    (text: string) => {
      sendMessage(text);
    },
    [sendMessage],
  );

  useInput((input, key) => {
    if (viewingProject) {
      if (key.escape || input === 'q') {
        setViewingProject(false);
      }
      return;
    }

    if (key.upArrow && projects.length > 0) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : projects.length - 1));
    }
    if (key.downArrow && projects.length > 0) {
      setSelectedIndex((prev) => (prev < projects.length - 1 ? prev + 1 : 0));
    }
    if (key.return && projects.length > 0) {
      setViewingProject(true);
    }
  });

  const selectedProject = projects[selectedIndex] ?? null;

  return (
    <Box flexDirection="column" height="100%">
      <Header stats={stats} />

      <Box flexGrow={1}>
        {/* Left panel — Project list */}
        <Box
          width="30%"
          borderStyle="single"
          borderRight
          borderLeft={false}
          borderTop={false}
          borderBottom={false}
        >
          <ProjectList projects={projects} selectedIndex={selectedIndex} />
        </Box>

        {/* Right panel — Detail or overview */}
        <Box width="70%">
          {viewingProject && selectedProject ? (
            <ProjectDetail project={selectedProject} />
          ) : (
            <SystemOverview
              stats={stats}
              projects={projects}
              llmProvider={
                ctx.agent ? `${ctx.config.llm.provider} (${ctx.config.llm.model})` : null
              }
            />
          )}
        </Box>
      </Box>

      <ChatInput
        isLoading={isLoading}
        lastMessage={lastAssistantMessage}
        onSubmit={handleChatSubmit}
        agentAvailable={ctx.agent !== null}
      />
    </Box>
  );
}
