import { LanguageProvider } from '@/i18n/context';
import { Component, type ErrorInfo, type ReactNode, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SetupScreen } from '@/components/setup/SetupScreen';
import { NewProjectFlow } from '@/pages/NewProjectFlow';
import { ProjectDetail } from '@/pages/ProjectDetail';
import { ProjectsGrid } from '@/pages/ProjectsGrid';
import { DeploymentDetail } from '@/pages/DeploymentDetail';
import { SettingsPage } from '@/pages/SettingsPage';
import { ServicesPage } from '@/pages/ServicesPage';
import { ServiceDetail } from '@/pages/ServiceDetail';
import './App.css';
import { getSetupStatus } from '@/lib/api';
import { Toaster } from 'sonner';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen items-center justify-center bg-background text-foreground">
          <div className="text-center">
            <h1 className="text-2xl font-bold">Something went wrong.</h1>
            <p className="text-muted-foreground">Please refresh the page.</p>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Route guard: redirects to /setup when Docker is not ready.
 * On API error, passes through (don't block existing users).
 */
function SetupGuard() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'needs-setup'>('loading');

  useEffect(() => {
    getSetupStatus()
      .then((s) => setStatus(s.ready ? 'ready' : 'needs-setup'))
      .catch(() => setStatus('ready'));
  }, []);

  if (status === 'loading') {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-app">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-agent border-t-transparent" />
      </div>
    );
  }

  if (status === 'needs-setup') return <Navigate to="/setup" replace />;

  return <Outlet />;
}

function App() {
  return (
    <LanguageProvider>
      <ErrorBoundary>
        <Toaster
          toastOptions={{
            className: 'bg-bg-panel border-border text-primary-ol font-body',
            descriptionClassName: 'text-muted-ol',
          }}
        />
        <BrowserRouter>
          <Routes>
            <Route
              path="/setup"
              element={<SetupScreen onComplete={() => (window.location.href = '/projects')} />}
            />
            <Route element={<SetupGuard />}>
              <Route element={<AppLayout />}>
                <Route path="/projects" element={<ProjectsGrid />} />
                <Route path="/projects/new" element={<NewProjectFlow />} />
                <Route path="/projects/:id/deployments/:deployId" element={<DeploymentDetail />} />
                <Route path="/projects/:id" element={<ProjectDetail />} />
                <Route path="/services" element={<ServicesPage />} />
                <Route path="/services/:id" element={<ServiceDetail />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Route>
            </Route>
            <Route path="/" element={<Navigate to="/projects" replace />} />
            <Route path="*" element={<Navigate to="/projects" replace />} />
          </Routes>
        </BrowserRouter>
      </ErrorBoundary>
    </LanguageProvider>
  );
}

export default App;
