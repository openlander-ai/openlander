import React, { useState } from 'react';
import type { AppContext } from '../app.js';
import { isOnboarded } from '../config/index.js';
import { SetupFlow } from './components/SetupFlow.js';
import { Dashboard } from './components/Dashboard.js';

interface AppProps {
  ctx: AppContext;
}

export function App({ ctx }: AppProps): React.ReactElement {
  const [mode, setMode] = useState<'setup' | 'dashboard'>(() =>
    isOnboarded() ? 'dashboard' : 'setup',
  );

  const handleSetupComplete = () => {
    setMode('dashboard');
  };

  if (mode === 'setup') {
    return <SetupFlow ctx={ctx} onComplete={handleSetupComplete} />;
  }

  return <Dashboard ctx={ctx} />;
}
