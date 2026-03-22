import { createContext, useContext } from 'react';

export interface AgentPanelInitialContext {
  projectId?: string;
  deployId?: string;
  errorMessage?: string;
  logLines?: string[];
}

interface AgentPanelContextValue {
  isOpen: boolean;
  openPanel: (initialContext?: AgentPanelInitialContext) => void;
  closePanel: () => void;
}

export const AgentPanelContext = createContext<AgentPanelContextValue | null>(null);

export function useAgentPanel(): AgentPanelContextValue {
  const ctx = useContext(AgentPanelContext);
  if (!ctx) {
    throw new Error('useAgentPanel must be used within an AgentPanelContext provider');
  }
  return ctx;
}
