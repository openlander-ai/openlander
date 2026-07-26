// 1.0-rc.2 (data-model fullsplit): the palette searches across groups
// (formerly projects). Per-service drill-in stays under the legacy
// `/services/:id?project=:p` URL — App.tsx redirects to the canonical
// `/projects/:p/services/:s` shape since rc.1, so palette deep-links
// keep working without per-action rewires.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useProjectsContext } from '@/hooks/use-projects-context';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import {
  Search,
  FolderOpen,
  Plus,
  Code2,
  Command,
  Server,
  Terminal,
  LayoutDashboard,
} from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  keywords?: string;
}

interface CommandGroup {
  id: string;
  heading: string;
  items: CommandItem[];
}

const RECENT_KEY = 'openlander-recent-commands';
const MAX_RECENT = 5;

function getRecentCommands(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
  } catch {
    return [];
  }
}

function addRecentCommand(id: string) {
  const recent = getRecentCommands().filter((r) => r !== id);
  recent.unshift(id);
  localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { projects } = useProjectsContext();

  const { t } = useLanguage();
  // Cmd+K / Ctrl+K toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setOpen((prev) => !prev);
        setQuery('');
        setSelectedIndex(0);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Auto-focus input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelectedIndex(0);
  }, []);

  const executeCommand = useCallback((item: CommandItem) => {
    addRecentCommand(item.id);
    item.action();
  }, []);

  // Build command items and groups
  const { groups, flatFiltered } = useMemo(() => {
    const navItems: CommandItem[] = [
      {
        id: 'nav-dashboard',
        label: t('command.dashboard'),
        icon: <LayoutDashboard className="h-4 w-4" />,
        action: () => {
          navigate('/projects');
          close();
        },
        keywords: 'home projects overview',
      },
      // The legacy `Settings` quick-link was retired in PR #244 when the
      // multi-tab `/settings` host was narrowed to a GitHub-only handoff.
      // Replace it with the two v0.1 settings surfaces the sidebar
      // exposes — Web Server and Git Providers — so keyboard-first users
      // can still reach them via Cmd+K (Gemini CCG round-1 on #244).
      {
        id: 'nav-web-server',
        label: t('command.webServer'),
        icon: <Server className="h-4 w-4" />,
        action: () => {
          navigate('/settings/web-server');
          close();
        },
        // English + Korean tokens. CommandPalette labels are not yet
        // i18n-mapped, but the keyword search is plain string-contains
        // — Korean tokens here let users find the entry by typing
        // "웹 서버", "프록시", "도메인", etc. (Gemini CCG round-1).
        // `tls host domain` covers the additional vocab Codex flagged.
        keywords:
          'proxy traefik routes ports entrypoints tls host domain settings web server 웹 서버 프록시 도메인',
      },
      {
        id: 'nav-git-providers',
        label: t('command.gitProviders'),
        icon: <Code2 className="h-4 w-4" />,
        action: () => {
          navigate('/settings/git-providers');
          close();
        },
        // `pat token` covers the personal-access-token vocab Codex
        // flagged. Korean tokens (`깃허브`, `저장소`) per Gemini CCG.
        keywords: 'github oauth git providers settings repositories pat token 깃허브 저장소',
      },
    ];

    const projectItems: CommandItem[] = [];
    /* `project.status` here is the frontend Project wire-shape field
       (lib/api projects). The mapper hydrates it server-side from
       services.* post-0012, so reads on the client are wire-format,
       not dropped DB columns. */
    /* eslint-disable openlander-internal/no-dropped-columns */
    for (const project of projects) {
      const statusLabels: Record<string, string> = {
        running: t('services.status.running'),
        stopped: t('services.status.stopped'),
        error: t('services.status.error'),
      };
      const displayStatus = statusLabels[project.status] ?? project.status;
      projectItems.push({
        id: `go-${project.id}`,
        label: project.name,
        description: t('command.goToProject', {
          name: project.name,
          status: displayStatus,
        }),
        icon: <FolderOpen className="h-4 w-4" />,
        action: () => {
          navigate(`/projects/${project.id}`);
          close();
        },
        keywords: `project ${project.status}`,
      });

      if (project.status === 'running') {
        projectItems.push({
          id: `logs-${project.id}`,
          label: t('command.projectActivity', { name: project.name }),
          description: t('command.projectActivityDescription'),
          icon: <Terminal className="h-4 w-4" />,
          action: () => {
            // V2 takeover: ProjectViewV2 has Services / Activity tabs. The pre-V2
            // `?tab=console` deep-link no longer applies; route to the Activity
            // tab as the closest analog. Per-service runtime logs live under
            // /services/:id (Logs tab) — those are exposed by ServiceDetailV2.
            navigate(`/projects/${project.id}?tab=activity`);
            close();
          },
          keywords: 'console output stderr activity log',
        });
      }
    }
    /* eslint-enable openlander-internal/no-dropped-columns */

    const systemItems: CommandItem[] = [
      {
        // v5: the "New Project" wizard route was retired; the only human-side
        // entry point is the AgentGuideDialog on the Projects page. Keep the
        // command available but reroute so the "+ New Project" button is
        // immediately visible to the user.
        id: 'new-project',
        label: t('command.newProject'),
        description: t('command.deployNewRepo'),
        icon: <Plus className="h-4 w-4" />,
        action: () => {
          navigate('/projects');
          close();
        },
        keywords: 'deploy create add',
      },
    ];

    const allItems = [...navItems, ...projectItems, ...systemItems];

    // Filter by query
    let filteredItems = allItems;
    if (query.trim()) {
      const lower = query.toLowerCase();
      filteredItems = allItems.filter(
        (item) =>
          item.label.toLowerCase().includes(lower) ||
          item.description?.toLowerCase().includes(lower) ||
          item.keywords?.toLowerCase().includes(lower),
      );
    }

    // Grouping
    const resultGroups: CommandGroup[] = [];
    const flatFilteredList: CommandItem[] = [];

    if (!query.trim()) {
      // Show recent commands when no query
      const recentIds = getRecentCommands();
      const recentItems = recentIds
        .map((id) => allItems.find((item) => item.id === id))
        .filter((item): item is CommandItem => item !== undefined);

      if (recentItems.length > 0) {
        resultGroups.push({
          id: 'recent',
          heading: t('command.group.recent'),
          items: recentItems,
        });
        flatFilteredList.push(...recentItems);
      }

      resultGroups.push({
        id: 'navigation',
        heading: t('command.group.navigation'),
        items: navItems,
      });
      flatFilteredList.push(...navItems);

      if (projectItems.length > 0) {
        resultGroups.push({
          id: 'projects',
          heading: t('command.group.projects'),
          items: projectItems,
        });
        flatFilteredList.push(...projectItems);
      }

      resultGroups.push({
        id: 'system',
        heading: t('command.group.system'),
        items: systemItems,
      });
      flatFilteredList.push(...systemItems);
    } else {
      // When querying, just group the filtered items
      const filteredNav = navItems.filter((item) => filteredItems.includes(item));
      const filteredProjects = projectItems.filter((item) => filteredItems.includes(item));
      const filteredSystem = systemItems.filter((item) => filteredItems.includes(item));

      if (filteredNav.length > 0) {
        resultGroups.push({
          id: 'navigation',
          heading: t('command.group.navigation'),
          items: filteredNav,
        });
        flatFilteredList.push(...filteredNav);
      }
      if (filteredProjects.length > 0) {
        resultGroups.push({
          id: 'projects',
          heading: t('command.group.projects'),
          items: filteredProjects,
        });
        flatFilteredList.push(...filteredProjects);
      }
      if (filteredSystem.length > 0) {
        resultGroups.push({
          id: 'system',
          heading: t('command.group.system'),
          items: filteredSystem,
        });
        flatFilteredList.push(...filteredSystem);
      }
    }

    return { groups: resultGroups, flatFiltered: flatFilteredList };
  }, [projects, navigate, close, t, query]);

  // Clamp selected index
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, flatFiltered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (flatFiltered[selectedIndex]) {
          executeCommand(flatFiltered[selectedIndex]);
        }
      }
    },
    [flatFiltered, selectedIndex, executeCommand],
  );

  if (!open) return null;

  // Calculate global index for selection
  let globalIndex = 0;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/20 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={close}
      />

      {/* Palette */}
      <div className="fixed inset-x-0 top-[20%] z-50 mx-auto w-full max-w-lg animate-in fade-in slide-in-from-top-4 duration-200">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel shadow-2xl shadow-black/10 overflow-hidden flex flex-col">
          {/* Search input */}
          <div className="flex items-center gap-3 px-4 border-b border-[hsl(var(--border))]">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('command.searchPlaceholder')}
              className="flex-1 py-3 bg-transparent text-sm font-body text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-mono text-muted-foreground bg-bg-subtle border border-border">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[300px] overflow-y-auto py-2">
            {flatFiltered.length === 0 && query.trim() ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-body text-muted-foreground">{t('command.noResults')}</p>
              </div>
            ) : flatFiltered.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-body text-muted-foreground">{t('command.noResults')}</p>
              </div>
            ) : (
              groups.map((group) =>
                group.items.length > 0 ? (
                  <div key={group.id}>
                    <p className="px-4 py-1.5 text-xs uppercase tracking-[0.08em] font-mono text-muted-foreground">
                      {group.heading}
                    </p>
                    {group.items.map((item) => {
                      const currentIndex = globalIndex++;
                      return (
                        <button
                          key={item.id}
                          onClick={() => executeCommand(item)}
                          onMouseEnter={() => setSelectedIndex(currentIndex)}
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                            currentIndex === selectedIndex
                              ? 'bg-agent/10 text-foreground'
                              : 'text-foreground/80 hover:bg-bg-subtle/50',
                          )}
                        >
                          <span
                            className={cn(
                              'shrink-0',
                              currentIndex === selectedIndex
                                ? 'text-agent'
                                : 'text-muted-foreground',
                            )}
                          >
                            {item.icon}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-body truncate">{item.label}</p>
                            {item.description && (
                              <p className="text-xs font-body text-muted-foreground truncate">
                                {item.description}
                              </p>
                            )}
                          </div>
                          {currentIndex === selectedIndex && (
                            <span className="text-xs font-mono text-muted-foreground shrink-0">
                              ↵
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                ) : null,
              )
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-4 px-4 py-2 border-t border-[hsl(var(--border))] text-xs font-mono text-muted-foreground bg-bg-panel">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-bg-subtle border border-border">↑↓</kbd>{' '}
              {t('command.keyboard.navigate')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-bg-subtle border border-border">↵</kbd>{' '}
              {t('command.keyboard.select')}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-bg-subtle border border-border">esc</kbd>{' '}
              {t('command.keyboard.close')}
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
