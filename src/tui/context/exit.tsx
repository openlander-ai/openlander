/**
 * ExitContext - Replacement for Ink's useApp().exit()
 * Provides a way for components to trigger app exit in OpenTUI.
 */
import { createContext, useContext, type ParentProps } from 'solid-js';

interface ExitContextValue {
  exit: () => void;
}

const ExitContext = createContext<ExitContextValue>();

export interface ExitProviderProps extends ParentProps {
  onExit: () => void;
}

export function ExitProvider(props: ExitProviderProps) {
  const value: ExitContextValue = {
    exit: () => props.onExit(),
  };

  return <ExitContext.Provider value={value}>{props.children}</ExitContext.Provider>;
}

export function useExit(): ExitContextValue {
  const ctx = useContext(ExitContext);
  if (!ctx) {
    throw new Error('useExit must be used within ExitProvider');
  }
  return ctx;
}
