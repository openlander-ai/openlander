import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { useNavigate } from 'react-router-dom';
import { deployProject } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { useEnvScanFlow } from '@/hooks/use-env-scan-flow';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, GitBranch, Star, Lock, Loader2, Rocket, ArrowLeft, Globe } from 'lucide-react';

interface GitRepo {
  name: string;
  fullName: string;
  description: string | null;
  htmlUrl: string;
  cloneUrl: string;
  isPrivate: boolean;
  defaultBranch: string;
  language: string | null;
  updatedAt: string;
  stars: number;
}

type Tab = 'repos' | 'search';

const langColors: Record<string, string> = {
  TypeScript: 'bg-[#3178c6]',
  JavaScript: 'bg-[#f1e05a]',
  Python: 'bg-[#3572A5]',
  Go: 'bg-[#00ADD8]',
  Rust: 'bg-[#dea584]',
  Java: 'bg-[#b07219]',
  Ruby: 'bg-[#701516]',
  PHP: 'bg-[#4F5D95]',
  'C++': 'bg-[#f34b7d]',
  C: 'bg-[#555555]',
};

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

  // Debounced search
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

        {/* Tabs + Search */}
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

      {/* Error */}
      {(error || ghError) && (
        <div className="mx-6 mt-4 px-3 py-2 rounded border border-error/30 bg-error/10 text-error text-xs font-body">
          {error ?? ghError}
        </div>
      )}

      {/* Deploying Overlay */}
      {deploying && (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-agent" />
            <p className="text-sm font-body text-secondary-ol">
              {deployStatus ?? 'Starting deployment...'}
            </p>
          </div>
        </div>
      )}

      {/* Repo List */}
      {!deploying && !selectedRepo && (
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-1">
            {(loading && repos.length === 0) || (searching && searchResults.length === 0) ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-agent" />
              </div>
            ) : displayedRepos.length === 0 && tab === 'search' && searchQuery ? (
              <div className="text-center py-12 text-secondary-ol text-xs font-body">
                {t('newProject.noReposFound')} "{searchQuery}"
              </div>
            ) : (
              <>
                {displayedRepos.map((repo) => (
                  <div
                    key={repo.fullName}
                    className={cn(
                      'flex items-center justify-between gap-4 px-4 py-3 rounded-md transition-all duration-150 group',
                      'hover:bg-bg-subtle',
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-body text-sm text-primary-ol truncate font-medium">
                          {repo.fullName}
                        </span>
                        {repo.isPrivate ? (
                          <Lock className="h-3 w-3 text-muted-ol shrink-0" />
                        ) : (
                          <Globe className="h-3 w-3 text-muted-ol shrink-0" />
                        )}
                      </div>
                      {repo.description && (
                        <p className="text-[11px] text-secondary-ol font-body truncate mt-0.5">
                          {repo.description}
                        </p>
                      )}
                      <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-ol font-body">
                        {repo.language && (
                          <span className="flex items-center gap-1">
                            <span
                              className={cn(
                                'h-2 w-2 rounded-full',
                                langColors[repo.language] ?? 'bg-[var(--text-muted)]',
                              )}
                            />
                            {repo.language}
                          </span>
                        )}
                        {repo.stars > 0 && (
                          <span className="flex items-center gap-0.5">
                            <Star className="h-2.5 w-2.5" />
                            {repo.stars}
                          </span>
                        )}
                        <span className="flex items-center gap-0.5">
                          <GitBranch className="h-2.5 w-2.5" />
                          {repo.defaultBranch}
                        </span>
                      </div>
                    </div>

                    <Button
                      size="sm"
                      className="h-7 px-3 text-[11px] font-body gap-1.5 bg-foreground text-background hover:bg-foreground/90 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                      onClick={() => handleDeployClick(repo)}
                      disabled={deploying}
                    >
                      <Rocket className="h-3 w-3" />
                      {'Deploy'}
                    </Button>
                  </div>
                ))}

                {/* Load More */}
                {tab === 'repos' && hasMore && (
                  <div className="flex justify-center pt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs font-body text-secondary-ol"
                      onClick={() => {
                        const nextPage = page + 1;
                        setPage(nextPage);
                        fetchRepos(nextPage);
                      }}
                      disabled={loading}
                    >
                      {loading && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
                      {'Load more'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      )}

      {/* Configure Deployment */}
      {!deploying && selectedRepo && (
        <div className="flex-1 p-6 flex flex-col">
          <div className="max-w-xl mx-auto w-full bg-bg-panel border border-[hsl(var(--border))] rounded-lg p-6 space-y-6">
            <div>
              <h2 className="text-base font-display font-bold text-primary-ol flex items-center gap-2">
                <Rocket className="h-4 w-4" />
                Deploy {selectedRepo.name}
              </h2>
              <p className="text-xs text-secondary-ol font-body mt-1">{selectedRepo.fullName}</p>
            </div>

            {envScan.envStep === 'scanning' && (
              <div className="py-8 flex flex-col items-center justify-center space-y-3">
                <Loader2 className="h-6 w-6 animate-spin text-agent" />
                <p className="text-xs text-secondary-ol font-body">
                  Scanning for environment variables...
                </p>
              </div>
            )}

            {envScan.envStep === 'paste' && (
              <div className="space-y-4">
                <div className="text-xs text-secondary-ol font-body">
                  {`Found ${String(envScan.envVars.length)} environment variable${envScan.envVars.length !== 1 ? 's' : ''} used in this project.`}
                </div>
                <textarea
                  className="w-full rounded-md px-3 py-2 text-xs font-mono bg-bg-app border border-[hsl(var(--border))] text-primary-ol placeholder:text-muted-ol resize-none focus:outline-none focus:ring-1 focus:ring-agent/40"
                  rows={8}
                  placeholder={t('deploy.dialog.pasteEnvPlaceholder')}
                  value={envScan.pasteText}
                  onChange={(e) => envScan.setPasteText(e.target.value)}
                />
                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    className="text-xs text-secondary-ol hover:text-primary-ol transition-colors font-body"
                    onClick={() => void doDeploy({})}
                  >
                    {t('deploy.dialog.skipEnvVars')}
                  </button>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => envScan.reset()}
                      className="h-8 text-xs font-body"
                    >
                      Back
                    </Button>
                    <Button
                      type="button"
                      className="h-8 text-xs font-body bg-foreground text-background hover:bg-foreground/90"
                      onClick={() => {
                        if (!envScan.parseAndMap()) {
                          toast.error(t('deploy.dialog.noValidPairs'));
                        }
                      }}
                    >
                      {t('deploy.dialog.parseAndMap')}
                    </Button>
                  </div>
                </div>
              </div>
            )}

            {envScan.envStep === 'summary' && (
              <div className="space-y-4">
                <div className="max-h-64 overflow-y-auto space-y-4 pr-1">
                  {/* Matched section */}
                  {envScan.matchedVars.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-green-500">
                        <span>✓</span>
                        <span>
                          {envScan.matchedVars.length} {t('deploy.dialog.varsMatched')}
                        </span>
                      </div>
                      {envScan.matchedVars.map((v) => (
                        <div key={v.key} className="flex items-center gap-2">
                          <label className="text-xs font-mono text-secondary-ol min-w-0 shrink-0 max-w-[140px] truncate">
                            {v.key}
                          </label>
                          <Input
                            className="h-7 text-xs font-mono flex-1 bg-bg-subtle border-[hsl(var(--border))]"
                            value={envScan.editedValues[v.key] ?? v.value}
                            onChange={(e) =>
                              envScan.setEditedValues((prev) => ({
                                ...prev,
                                [v.key]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Missing section */}
                  {envScan.missingVars.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-500">
                        <span>⚠</span>
                        <span>
                          {envScan.missingVars.length} {t('deploy.dialog.varsMissing')}
                        </span>
                      </div>
                      {envScan.missingVars.map((v) => (
                        <div key={v.key} className="flex items-center gap-2">
                          <label className="text-xs font-mono text-secondary-ol min-w-0 shrink-0 max-w-[140px] truncate">
                            {v.key}
                          </label>
                          <Input
                            className="h-7 text-xs font-mono flex-1 bg-bg-subtle border-[hsl(var(--border))]"
                            placeholder={`Value for ${v.key}`}
                            value={envScan.missingValues[v.key] ?? ''}
                            onChange={(e) =>
                              envScan.setMissingValues((prev) => ({
                                ...prev,
                                [v.key]: e.target.value,
                              }))
                            }
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Extra section */}
                  {envScan.extraVars.length > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-secondary-ol">
                        <span>+</span>
                        <span>
                          {envScan.extraVars.length} {t('deploy.dialog.varsExtra')}
                        </span>
                      </div>
                      {envScan.extraVars.map((v) => (
                        <div key={v.key} className="flex items-center gap-2">
                          <label className="text-xs font-mono text-secondary-ol min-w-0 shrink-0 max-w-[140px] truncate">
                            {v.key}
                          </label>
                          <span className="text-xs font-mono text-secondary-ol truncate flex-1">
                            {v.value || '(empty)'}
                          </span>
                          <button
                            type="button"
                            className="text-xs text-secondary-ol hover:text-error transition-colors shrink-0"
                            onClick={() => envScan.removeExtra(v.key)}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => envScan.goBackToPaste()}
                    className="flex-1 h-8 text-xs font-body"
                  >
                    {t('deploy.dialog.rePaste')}
                  </Button>
                  <Button
                    onClick={() => void doDeploy(envScan.buildFinalVars())}
                    className="flex-1 h-8 text-xs font-body bg-foreground text-background hover:bg-foreground/90"
                  >
                    Deploy
                  </Button>
                </div>
              </div>
            )}

            {envScan.envStep === 'idle' && (
              <>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-primary-ol">Environment</label>
                    <Select value={environment} onValueChange={handleEnvironmentChange}>
                      <SelectTrigger className="h-8 text-xs bg-bg-subtle border-[hsl(var(--border))]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="production">Production</SelectItem>
                        <SelectItem value="development">Development</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-primary-ol">Branch</label>
                    <Input
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      className="h-8 text-xs bg-bg-subtle border-[hsl(var(--border))]"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSelectedRepo(null);
                      envScan.reset();
                    }}
                    className="flex-1 h-8 text-xs font-body"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirmDeploy}
                    className="flex-1 h-8 text-xs font-body bg-foreground text-background hover:bg-foreground/90"
                  >
                    Deploy Project
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
