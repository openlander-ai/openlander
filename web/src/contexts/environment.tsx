import { createContext, useContext, useState, type ReactNode } from 'react';
import type { EnvironmentType } from '@/types';

interface EnvironmentContextType {
  environment: EnvironmentType;
  setEnvironment: (env: EnvironmentType) => void;
}

const EnvironmentContext = createContext<EnvironmentContextType | undefined>(undefined);

const VALID_ENVS: ReadonlySet<string> = new Set(['production', 'development']);

export function EnvironmentProvider({ children }: { children: ReactNode }) {
  const [environment, setEnvironmentState] = useState<EnvironmentType>(() => {
    try {
      const saved = localStorage.getItem('openlander_environment');
      if (saved && VALID_ENVS.has(saved)) return saved as EnvironmentType;
    } catch {
      /* SSR or restricted storage */
    }
    return 'production';
  });

  const setEnvironment = (env: EnvironmentType) => {
    setEnvironmentState(env);
    localStorage.setItem('openlander_environment', env);
  };

  return (
    <EnvironmentContext.Provider value={{ environment, setEnvironment }}>
      {children}
    </EnvironmentContext.Provider>
  );
}

export function useEnvironment() {
  const context = useContext(EnvironmentContext);
  if (context === undefined) {
    throw new Error('useEnvironment must be used within an EnvironmentProvider');
  }
  return context;
}
