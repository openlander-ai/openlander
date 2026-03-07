import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { deployProject } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useIsMobile, showMobileToast } from '@/hooks/use-mobile';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
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

  const fetchRepos = useCallback(async (pageNum: number) => {
    setLoading(true);
    setGhError(null);
    try {
      const res = await fetch(`/api/repos?page=${pageNum}`);
      if (!res.ok) {
        const data = await res.json();
        if (data.error === 'GITHUB_NOT_CONFIGURED') {
          setGhError('GitHub not connected. Go to Settings to add your account.');
          return;
        }
        throw new Error(data.message ?? 'Failed to fetch repos');
      }
      const data = await res.json();
      setRepos((prev) => (pageNum === 1 ? data.repos : [...prev, ...data.repos]));
      setHasMore(data.hasMore);
    } catch (err) {
      setGhError(err instanceof Error ? err.message : 'Failed to fetch repos');
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

  const handleDeploy = async (repo: GitRepo) => {
    if (isMobile) {
      showMobileToast();
      return;
    }
    setDeploying(true);
    setError(null);
    setDeployStatus('Starting deployment...');
    try {
      const result = await deployProject(repo.cloneUrl, repo.defaultBranch, repo.name);
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
              New Project
            </h1>
            <p className="text-xs font-body text-secondary-ol">Select a repository to deploy</p>
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
              My Repos
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
              Search
            </button>
          </div>

          {tab === 'search' && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-ol" />
              <Input
                placeholder="Search repositories..."
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
      {!deploying && (
        <ScrollArea className="flex-1">
          <div className="p-6 space-y-1">
            {(loading && repos.length === 0) || (searching && searchResults.length === 0) ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-5 w-5 animate-spin text-agent" />
              </div>
            ) : displayedRepos.length === 0 && tab === 'search' && searchQuery ? (
              <div className="text-center py-12 text-secondary-ol text-xs font-body">
                No repositories found for \"{searchQuery}\"
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
                      onClick={() => handleDeploy(repo)}
                      disabled={deploying}
                    >
                      <Rocket className="h-3 w-3" />
                      Deploy
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
                      Load more
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
