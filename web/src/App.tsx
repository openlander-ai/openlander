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
import { BrowserRouter, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/Shell/AppShell';
import { SetupScreen } from '@/components/setup/SetupScreen';
import { ProjectsGrid } from '@/pages/ProjectsGrid';
import { SettingsPage } from '@/pages/SettingsPage';
import { ServicesPage } from '@/pages/ServicesPage';
import { Home } from '@/pages/Home';
import { Activity } from '@/pages/Activity';
import { MCPServer } from '@/pages/MCPServer';
import { MonitoringPage } from '@/pages/MonitoringPage';
import { WebServerSettings } from '@/pages/settings/WebServer';
import { GitProvidersSettings } from '@/pages/settings/GitProviders';
import { SSHKeysSettings } from '@/pages/settings/SSHKeys';
import { NotificationsSettings } from '@/pages/settings/Notifications';
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
    return <Navigate to="/login" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!setupStatus.ready) {
    return <Navigate to="/setup" replace />;
  }

  return <Outlet />;
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
                    carries CommandPalette and mobile shell state that the old shell owned. */}
                <Route element={<AppShell />}>
                  {/* V2 surfaces */}
                  <Route path="/home" element={<Home />} />
                  <Route path="/activity" element={<Activity />} />
                  {/* /mcp-server because the backend's MCP JSON-RPC endpoint
                      sits at /mcp (no content-negotiation). */}
                  <Route path="/mcp-server" element={<MCPServer />} />
                  <Route path="/monitoring" element={<MonitoringPage />} />
                  {/* /logs retired in Phase 3a (ralplan-monitoring-logs).
                      Stale bookmarks land on /activity, where the new Kind
                      filter chip surfaces deploy/runtime events. */}
                  <Route path="/logs" element={<Navigate to="/activity" replace />} />
                  <Route
                    path="/projects/:id"
                    element={
                      <RouteSuspense>
                        <ProjectView />
                      </RouteSuspense>
                    }
                  />
                  {/* ── 1.0-rc.1: canonical deployable-service URL ─────────────
                      `/projects/:p/services/:s` is the canonical route per
                      docs/design/v1.0/GUIDE-01-IA-principles.md §4 vocabulary (Project = group,
                      Service = deployable unit). ServiceDetailV2 dispatcher
                      normalises both URL shapes via useParams() — when this
                      path matches, params are { p, s }; legacy path gives
                      { id } plus ?project= query.
                      rc.2 will deprecate `/services/:id?project=:p` once all
                      internal callers are migrated to the canonical form. */}
                  <Route
                    path="/projects/:p/services/:s"
                    element={
                      <RouteSuspense>
                        <ServiceDetailV2 />
                      </RouteSuspense>
                    }
                  />
                  {/* Legacy deployable-detail URL — kept live in rc.1 for
                      bookmark continuity. ServiceDetailV2 accepts ?project=
                      query param as a fallback. Deprecation: rc.2 will add
                      a `Deprecation` response header and redirect callers to
                      the canonical `/projects/:p/services/:s` form. */}
                  <Route
                    path="/services/:id"
                    element={
                      <RouteSuspense>
                        <ServiceDetailV2 />
                      </RouteSuspense>
                    }
                  />
                  {/* Managed services (postgres / mysql / redis / mongo) —
                      separate from `/services/:id` (deployable detail) so
                      `services.id` and `projects.id` no longer share a
                      route prefix. Canonical replacement (`/projects/:p/
                      services/:s` with kind=database discriminator) lands
                      in rc.2 once managed services merge into the `services`
                      table per the schema-split migration. */}
                  <Route path="/managed-services" element={<ServicesPage />} />
                  <Route
                    path="/managed-services/:id"
                    element={
                      <RouteSuspense>
                        <ServiceDetailV2 />
                      </RouteSuspense>
                    }
                  />
                  <Route path="/settings/web-server" element={<WebServerSettings />} />
                  <Route path="/settings/git-providers" element={<GitProvidersSettings />} />
                  {/* SSH Keys + Notifications are hidden in the v0.1
                      sidebar but the routes stay mounted: the SSH Keys
                      page is a deliberate "lands in v0.2" stub (the file
                      docstring pins this), and Notifications has a live
                      backend at `/api/settings/notifications/webhook`
                      that v0.2 will resurface. Direct-URL bookmarks keep
                      working. */}
                  <Route path="/settings/ssh-keys" element={<SSHKeysSettings />} />
                  <Route path="/settings/notifications" element={<NotificationsSettings />} />

                  {/* Legacy pages — kept under V2 chrome until each is
                      individually rewritten. The visual mismatch is the
                      acceptable transition state for one launch cycle. */}
                  <Route path="/overview" element={<Navigate to="/home" replace />} />
                  <Route
                    path="/deployments"
                    element={<Navigate to="/activity?type=deploy" replace />}
                  />
                  <Route path="/projects" element={<ProjectsGrid />} />
                  {/* v5: New-project wizard retired — humans hit the
                      AgentGuideDialog from /projects. Stale links still resolve. */}
                  <Route path="/projects/new" element={<Navigate to="/projects" replace />} />
                  <Route
                    path="/projects/:id/deployments/:deployId"
                    element={
                      <RouteSuspense>
                        <DeploymentDetail />
                      </RouteSuspense>
                    }
                  />
                  {/* /services list → /managed-services for vocabulary
                      alignment (1.0 routing fix). The list page is
                      managed-services-only; deployables are reached via
                      a project's Services tab, not a top-level list. */}
                  <Route path="/services" element={<Navigate to="/managed-services" replace />} />
                  {/* /operations + /ops-v1 retired in Phase 1 hardening.
                      Built-in AI Ops surfaces are disabled in 0.1; passive
                      backend ops history can remain for activity/status data.
                      Stale bookmarks land on /home via the catch-all redirect. */}
                  {/* /settings is now a single-tab GitHub-only host —
                      the destination of the `Re-authorize` and
                      `Connect GitHub` CTAs on /settings/git-providers
                      until the device flow is inlined there directly.
                      Stale ?tab=system / ?tab=proxy params are
                      silently ignored. */}
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/agent" element={<Navigate to="/home" replace />} />
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
