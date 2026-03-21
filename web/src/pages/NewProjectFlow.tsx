import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { useNavigate } from 'react-router-dom';
import { deployProject } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { useEnvScanFlow } from '@/hooks/use-env-scan-flow';
import { Input } from '@/components/ui/input';
import { Search, ArrowLeft } from 'lucide-react';
import { DeployingOverlay } from '@/components/new-project/DeployingOverlay';
import { RepoListStep } from '@/components/new-project/RepoListStep';
import type { GitRepo, Tab } from '@/components/new-project/RepoListStep';
import { ConfigureDeployStep } from '@/components/new-project/ConfigureDeployStep';

export function NewProjectFlow() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>('repos');
  const [repos, setRepos] = useState<GitRepo[]>([]);
  const [searchResults, setSearchResults] = useState<GitRepo[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ghError, setGhError] = useState<string | null>(null);
  const [deployStatus, setDeployStatus] = useState<string | null>(null);

  const [selectedRepo, setSelectedRepo] = useState<GitRepo | null>(null);
  const [environment, setEnvironment] = useState<string>('production');
  const [branch, setBranch] = useState<string>('main');

  const envScan = useEnvScanFlow();

  const handleEnvironmentChange = (value: string) => {
    setEnvironment(value);
    if (value === 'production') setBranch('main');
    else if (value === 'development') setBranch('develop');
  };

  const fetchRepos = useCallback(async (pageNum: number) => {
    setLoading(true);
    setGhError(null);
    try {
      const res = await fetch(`/api/repos?page=${pageNum}`);
      if (!res.ok) {
        const data = await res.json();
        if (data.error === 'GITHUB_NOT_CONFIGURED') {
          setGhError(t('newProject.githubNotConnected'));
          return;
        }
        throw new Error(data.message ?? t('newProject.fetchFailed'));
      }
      const data = await res.json();
      setRepos((prev) => (pageNum === 1 ? data.repos : [...prev, ...data.repos]));
      setHasMore(data.hasMore);
    } catch (err) {
      setGhError(err instanceof Error ? err.message : t('newProject.fetchFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRepos(1);
  }, [fetchRepos]);

  useEffect(() => {
    if (tab !== 'search' || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/repos/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.repos);
        }
      } catch {
        // silent
      } finally {
        setSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchQuery, tab]);

  const handleDeployClick = (repo: GitRepo) => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    setSelectedRepo(repo);
    setEnvironment('production');
    setBranch(repo.defaultBranch || 'main');
    envScan.reset();
  };

  const handleConfirmDeploy = async () => {
    if (!selectedRepo) return;
    setError(null);
    const hasEnvVars = await envScan.startScan(selectedRepo.cloneUrl, branch);
    if (!hasEnvVars) {
      await doDeploy({});
    }
  };

  const doDeploy = async (vars: Record<string, string>) => {
    if (!selectedRepo) return;
    setDeploying(true);
    setError(null);
    setDeployStatus('Starting deployment...');
    try {
      const filtered: Record<string, string> = {};
      for (const [k, v] of Object.entries(vars)) {
        if (v.trim()) filtered[k] = v.trim();
      }
      const result = await deployProject(
        selectedRepo.cloneUrl,
        branch,
        selectedRepo.name,
        Object.keys(filtered).length > 0 ? filtered : undefined,
        environment,
      );
      if (result.success && result.projectId) {
        navigate(`/projects/${result.projectId}?env=${environment}`);
      } else {
        setError(result.error ?? 'Deploy failed');
        setDeploying(false);
        setDeployStatus(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deploy failed');
      setDeploying(false);
      setDeployStatus(null);
    }
  };

  const displayedRepos = tab === 'search' ? searchResults : repos;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel/50 px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => navigate('/projects')}
            className="p-1 rounded hover:bg-bg-subtle transition-colors text-secondary-ol hover:text-primary-ol"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="font-display font-bold text-lg text-primary-ol tracking-tight">
              {'New Project'}
            </h1>
            <p className="text-xs font-body text-secondary-ol">{t('newProject.selectRepo')}</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-0.5 bg-bg-subtle rounded-md p-0.5">
            <button
              onClick={() => setTab('repos')}
              className={cn(
                'px-3 py-1 rounded text-xs font-body transition-colors',
                tab === 'repos'
                  ? 'bg-bg-panel text-primary-ol'
                  : 'text-secondary-ol hover:text-primary-ol',
              )}
            >
              {'My Repos'}
            </button>
            <button
              onClick={() => setTab('search')}
              className={cn(
                'px-3 py-1 rounded text-xs font-body transition-colors',
                tab === 'search'
                  ? 'bg-bg-panel text-primary-ol'
                  : 'text-secondary-ol hover:text-primary-ol',
              )}
            >
              {'Search'}
            </button>
          </div>

          {tab === 'search' && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-ol" />
              <Input
                placeholder={'Search repositories...'}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs font-body bg-bg-subtle border-[hsl(var(--border))]"
                autoFocus
              />
            </div>
          )}
        </div>
      </div>

      {(error || ghError) && (
        <div className="mx-6 mt-4 px-3 py-2 rounded border border-error/30 bg-error/10 text-error text-xs font-body">
          {error ?? ghError}
        </div>
      )}

      {deploying && <DeployingOverlay deployStatus={deployStatus} />}

      {!deploying && !selectedRepo && (
        <RepoListStep
          displayedRepos={displayedRepos}
          loading={loading}
          searching={searching}
          tab={tab}
          searchQuery={searchQuery}
          deploying={deploying}
          hasMore={hasMore}
          page={page}
          onPageChange={setPage}
          onFetchRepos={fetchRepos}
          onDeployClick={handleDeployClick}
          t={t}
        />
      )}

      {!deploying && selectedRepo && (
        <ConfigureDeployStep
          selectedRepo={selectedRepo}
          environment={environment}
          branch={branch}
          onBranchChange={setBranch}
          onEnvironmentChange={handleEnvironmentChange}
          onCancel={() => {
            setSelectedRepo(null);
            envScan.reset();
          }}
          onConfirmDeploy={handleConfirmDeploy}
          onDeployWithVars={doDeploy}
          envScan={envScan}
          t={t}
        />
      )}
    </div>
  );
}
