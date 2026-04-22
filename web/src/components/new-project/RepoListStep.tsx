import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { GitBranch, Star, Lock, Loader2, Rocket, Globe } from 'lucide-react';

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

type Tab = 'repos' | 'search' | 'docker';

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

interface RepoListStepProps {
  displayedRepos: GitRepo[];
  loading: boolean;
  searching: boolean;
  tab: Tab;
  searchQuery: string;
  deploying: boolean;
  hasMore: boolean;
  page: number;
  onPageChange: (nextPage: number) => void;
  onFetchRepos: (page: number) => void;
  onDeployClick: (repo: GitRepo) => void;
  t: (key: string) => string;
}

export type { GitRepo, Tab };

export function RepoListStep({
  displayedRepos,
  loading,
  searching,
  tab,
  searchQuery,
  deploying,
  hasMore,
  page,
  onPageChange,
  onFetchRepos,
  onDeployClick,
  t,
}: RepoListStepProps) {
  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-1">
        {(loading && displayedRepos.length === 0) || (searching && displayedRepos.length === 0) ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-agent" />
          </div>
        ) : displayedRepos.length === 0 && tab === 'search' && searchQuery ? (
          <div className="text-center py-12 text-foreground/80 text-sm font-body">
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
                    <span className="font-body text-sm text-foreground truncate font-medium">
                      {repo.fullName}
                    </span>
                    {repo.isPrivate ? (
                      <Lock className="h-3 w-3 text-muted-foreground shrink-0" />
                    ) : (
                      <Globe className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-xs text-foreground/80 font-body truncate mt-0.5">
                      {repo.description}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground font-body">
                    {repo.language && (
                      <span className="flex items-center gap-1">
                        <span
                          className={cn(
                            'h-2 w-2 rounded-full',
                            langColors[repo.language] ?? 'bg-muted-foreground/40',
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
                  className="h-7 px-3 text-xs font-body gap-1.5 bg-foreground text-background hover:bg-foreground/90 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                  onClick={() => onDeployClick(repo)}
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
                  className="text-xs font-body text-foreground/80"
                  onClick={() => {
                    const nextPage = page + 1;
                    onPageChange(nextPage);
                    onFetchRepos(nextPage);
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
  );
}
