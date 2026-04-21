import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { useNavigate } from 'react-router-dom';
import { deployProject } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useEnvScanFlow } from '@/hooks/use-env-scan-flow';
import { Input } from '@/components/ui/input';
import { Search, ArrowLeft, Container } from 'lucide-react';
import { DeployingOverlay } from '@/components/new-project/DeployingOverlay';
import { RepoListStep } from '@/components/new-project/RepoListStep';
import type { GitRepo, Tab } from '@/components/new-project/RepoListStep';
import { ConfigureDeployStep } from '@/components/new-project/ConfigureDeployStep';

export function NewProjectFlow() {
  const navigate = useNavigate();
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

  const [imageUrl, setImageUrl] = useState('');
  const [port, setPort] = useState('');
  const [imageCmd, setImageCmd] = useState('');
  const [imageName, setImageName] = useState('');

  const [selectedRepo, setSelectedRepo] = useState<GitRepo | null>(null);
  const [branch, setBranch] = useState<string>('main');

  const envScan = useEnvScanFlow();

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
    setSelectedRepo(repo);
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
        'git',
      );
      if (result.success && result.projectId) {
        navigate(`/projects/${result.projectId}`);
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

  const handleDeployImage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!imageUrl) return;
    setDeploying(true);
    setError(null);
    setDeployStatus('Starting deployment...');
    try {
      const result = await deployProject(
        undefined,
        undefined,
        imageName || undefined,
        undefined,
        'image',
        imageUrl,
        imageCmd || undefined,
        port ? parseInt(port, 10) : undefined,
      );
      if (result.success && result.projectId) {
        navigate(`/projects/${result.projectId}`);
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
      <div className="shrink-0 border-b border-[hsl(var(--border))] bg-bg-panel px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={() => navigate('/projects')}
            className="p-1 rounded hover:bg-bg-subtle transition-colors text-secondary-ol hover:text-primary-ol"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <h1 className="font-display font-bold text-lg text-primary-ol tracking-tight">
              {t('newProject.title')}
            </h1>
            <p className="text-sm font-body text-secondary-ol">{t('newProject.selectRepo')}</p>
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
              {t('newProject.myRepos')}
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
              {t('newProject.search')}
            </button>
            <button
              onClick={() => setTab('docker')}
              className={cn(
                'px-3 py-1 rounded text-xs font-body transition-colors flex items-center gap-1.5',
                tab === 'docker'
                  ? 'bg-bg-panel text-primary-ol'
                  : 'text-secondary-ol hover:text-primary-ol',
              )}
            >
              <Container className="h-3.5 w-3.5" />
              {t('newProject.dockerImage')}
            </button>
          </div>

          {tab === 'search' && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-ol" />
              <Input
                placeholder={t('newProject.searchPlaceholder')}
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
        <div className="mx-6 mt-4 px-3 py-2 rounded border border-error/30 bg-error/10 text-error text-sm font-body">
          {error ?? ghError}
        </div>
      )}

      {deploying && <DeployingOverlay deployStatus={deployStatus} />}

      {!deploying && !selectedRepo && tab !== 'docker' && (
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

      {!deploying && tab === 'docker' && (
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-xl mx-auto space-y-6">
            <form onSubmit={handleDeployImage} className="space-y-4">
              <div className="space-y-2">
                <label
                  htmlFor="image-url"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-primary-ol"
                >
                  {t('newProject.dockerImage')}
                </label>
                <Input
                  id="image-url"
                  placeholder={t('newProject.imagePlaceholder')}
                  value={imageUrl}
                  onChange={(e) => {
                    setImageUrl(e.target.value);
                    if (e.target.value) {
                      const parts = e.target.value.split('/');
                      const lastPart = parts[parts.length - 1].split(':')[0];
                      if (lastPart) setImageName(lastPart);
                    } else {
                      setImageName('');
                    }
                  }}
                  required
                  className="bg-bg-subtle border-[hsl(var(--border))] text-primary-ol"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label
                    htmlFor="port"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-primary-ol"
                  >
                    {t('newProject.portLabel')}
                  </label>
                  <Input
                    id="port"
                    type="number"
                    placeholder={t('newProject.portPlaceholder')}
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="bg-bg-subtle border-[hsl(var(--border))] text-primary-ol"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="image-cmd"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-primary-ol"
                >
                  {t('newProject.commandLabel')}
                </label>
                <Input
                  id="image-cmd"
                  placeholder={t('newProject.commandPlaceholder')}
                  value={imageCmd}
                  onChange={(e) => setImageCmd(e.target.value)}
                  className="bg-bg-subtle border-[hsl(var(--border))] text-primary-ol"
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="name-image"
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-primary-ol"
                >
                  {t('deploy.dialog.projectName')}
                </label>
                <Input
                  id="name-image"
                  placeholder={t('deploy.dialog.autoDetected')}
                  value={imageName}
                  onChange={(e) => setImageName(e.target.value)}
                  className="bg-bg-subtle border-[hsl(var(--border))] text-primary-ol"
                />
              </div>
              <div className="pt-4">
                <button
                  type="submit"
                  disabled={deploying || !imageUrl}
                  className="w-full inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-foreground text-background hover:bg-foreground/90 h-10 px-4 py-2"
                >
                  {t('newProject.deployImage')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {!deploying && selectedRepo && (
        <ConfigureDeployStep
          selectedRepo={selectedRepo}
          branch={branch}
          onBranchChange={setBranch}
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
