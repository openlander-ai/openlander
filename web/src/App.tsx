import { LanguageProvider } from '@/i18n/context';
import {
  Component,
  type ErrorInfo,
  type ReactNode,
  Suspense,
  lazy,
  useEffect,
  useState,
} from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from 'react-router-dom';
import { AppShell } from '@/components/Shell/AppShell';
import { SetupScreen } from '@/components/setup/SetupScreen';
import { NewProjectFlow } from '@/pages/NewProjectFlow';
import { ProjectsGrid } from '@/pages/ProjectsGrid';
import { SettingsPage } from '@/pages/SettingsPage';
import { ServicesPage } from '@/pages/ServicesPage';
import { DeploymentsList } from '@/pages/DeploymentsList';
import { Home } from '@/pages/Home';
import { Activity } from '@/pages/Activity';
import { MCPServer } from '@/pages/MCPServer';
import { MonitoringPage } from '@/pages/MonitoringPage';
import { LogsPage } from '@/pages/LogsPage';
import { WebServerSettings } from '@/pages/settings/WebServer';
import { GitProvidersSettings } from '@/pages/settings/GitProviders';
import { SSHKeysSettings } from '@/pages/settings/SSHKeys';
import { NotificationsSettings } from '@/pages/settings/Notifications';
import { useAgentPanel } from '@/contexts/agent-panel';
import { LoginPage } from '@/pages/LoginPage';
import { AuthProvider, useAuth } from '@/contexts/auth';
import './App.css';
import { getSetupStatus } from '@/lib/api';
import { Toaster } from 'sonner';

/*
 * PR8: route-split the four heaviest pages so the initial bundle
 * doesn't ship `@xyflow/react` (~217 kB gzipped) or the LogViewer's
 * virtualizer to users who land on /home, /projects, /services, etc.
 *
 * Pages chosen:
 *   - ProjectView + ServiceDetailV2 → both mount InfraMap (react-flow)
 *   - OpsCenterV2 → mounts DependencyGraph (react-flow) + heavy chart
 *   - DeploymentDetail → mounts LogViewer (@tanstack/react-virtual)
 *
 * The Suspense fallback below is a thin centered spinner; the heavy
 * chunks load on-demand under 500 ms on local Wi-Fi.
 */
const ProjectView = lazy(() =>
  import('@/pages/ProjectView').then((m) => ({ default: m.ProjectView })),
);
const ServiceDetailV2 = lazy(() =>
  import('@/pages/ServiceDetailV2').then((m) => ({ default: m.ServiceDetailV2 })),
);
const OpsCenterV2 = lazy(() =>
  import('@/pages/OpsCenterV2').then((m) => ({ default: m.OpsCenterV2 })),
);
const DeploymentDetail = lazy(() =>
  import('@/pages/DeploymentDetail').then((m) => ({ default: m.DeploymentDetail })),
);

function RouteSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="flex h-full items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-agent border-t-transparent" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

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
  const [setupStatus, setSetupStatus] = useState<{
    loading: boolean;
    hasPassword: boolean;
    ready: boolean;
  }>({ loading: true, hasPassword: false, ready: false });
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  useEffect(() => {
    getSetupStatus()
      .then((s) =>
        setSetupStatus({
          loading: false,
          hasPassword: s.hasPassword ?? false,
          ready: s.ready ?? false,
        }),
      )
      .catch(() => setSetupStatus({ loading: false, hasPassword: true, ready: true }));
  }, []);

  if (setupStatus.loading || authLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-app">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-agent border-t-transparent" />
      </div>
    );
  }

  if (!setupStatus.hasPassword) {
    return <Navigate to="/setup" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!setupStatus.ready) {
    return <Navigate to="/setup" replace />;
  }

  return <Outlet />;
}

function AgentRouteRedirect() {
  const navigate = useNavigate();
  const { openPanel } = useAgentPanel();

  useEffect(() => {
    openPanel();
    navigate('/projects', { replace: true });
  }, [openPanel, navigate]);

  return null;
}

function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <ErrorBoundary>
          <Toaster
            toastOptions={{
              className: 'bg-bg-panel border-border text-primary-ol font-body',
              descriptionClassName: 'text-muted-foreground',
            }}
          />
          <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                path="/setup"
                element={<SetupScreen onComplete={() => (window.location.href = '/home')} />}
              />
              <Route element={<SetupGuard />}>
                {/* Single shell for all authenticated routes (Round 4 PR4
                    takeover). Legacy AppLayout was deleted; AppShell now
                    carries CommandPalette / AgentPanel / ApprovalDialog
                    that the old shell owned. */}
                <Route element={<AppShell />}>
                  {/* V2 surfaces */}
                  <Route path="/home" element={<Home />} />
                  <Route path="/activity" element={<Activity />} />
                  <Route path="/mcp" element={<MCPServer />} />
                  <Route path="/monitoring" element={<MonitoringPage />} />
                  <Route path="/logs" element={<LogsPage />} />
                  <Route
                    path="/projects/:id"
                    element={
                      <RouteSuspense>
                        <ProjectView />
                      </RouteSuspense>
                    }
                  />
                  <Route
                    path="/services/:id"
                    element={
                      <RouteSuspense>
                        <ServiceDetailV2 />
                      </RouteSuspense>
                    }
                  />
                  <Route path="/settings/web-server" element={<WebServerSettings />} />
                  <Route path="/settings/git-providers" element={<GitProvidersSettings />} />
                  <Route path="/settings/ssh-keys" element={<SSHKeysSettings />} />
                  <Route path="/settings/notifications" element={<NotificationsSettings />} />

                  {/* Legacy pages — kept under V2 chrome until each is
                      individually rewritten. The visual mismatch is the
                      acceptable transition state for one launch cycle. */}
                  <Route path="/overview" element={<Navigate to="/home" replace />} />
                  <Route path="/deployments" element={<DeploymentsList />} />
                  <Route path="/projects" element={<ProjectsGrid />} />
                  <Route path="/projects/new" element={<NewProjectFlow />} />
                  <Route
                    path="/projects/:id/deployments/:deployId"
                    element={
                      <RouteSuspense>
                        <DeploymentDetail />
                      </RouteSuspense>
                    }
                  />
                  <Route path="/services" element={<ServicesPage />} />
                  <Route
                    path="/operations"
                    element={
                      <RouteSuspense>
                        <OpsCenterV2 />
                      </RouteSuspense>
                    }
                  />
                  <Route path="/ops-v1" element={<Navigate to="/operations" replace />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/agent" element={<AgentRouteRedirect />} />
                </Route>
              </Route>
              <Route path="/" element={<Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
          </BrowserRouter>
        </ErrorBoundary>
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
