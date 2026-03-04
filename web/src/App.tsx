import { Component, type ErrorInfo, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { SetupScreen } from '@/components/setup/SetupScreen';
import { NewProjectFlow } from '@/pages/NewProjectFlow';
import { ProjectDetail } from '@/pages/ProjectDetail';
import { ProjectsGrid } from '@/pages/ProjectsGrid';
import { SettingsPage } from '@/pages/SettingsPage';
import './App.css';

class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(_: Error) {
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

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route
            path="/setup"
            element={<SetupScreen onComplete={() => (window.location.href = '/projects')} />}
          />
          <Route element={<AppLayout />}>
            <Route path="/projects" element={<ProjectsGrid />} />
            <Route path="/projects/new" element={<NewProjectFlow />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/projects" replace />} />
          <Route path="*" element={<Navigate to="/projects" replace />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
