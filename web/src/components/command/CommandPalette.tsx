import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjects } from '@/hooks/use-projects';
import { redeployProject, stopProject } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useLanguage } from '@/i18n/context';
import {
  Search,
  FolderOpen,
  RotateCw,
  Square,
  Settings,
  Plus,
  Command,
  Bot,
  Database,
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
  const { projects } = useProjects();

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
        label: 'Go to Dashboard',
        icon: <LayoutDashboard className="h-4 w-4" />,
        action: () => {
          navigate('/projects');
          close();
        },
        keywords: 'home projects overview',
      },
      {
        id: 'nav-agent',
        label: 'Agent Chat',
        icon: <Bot className="h-4 w-4" />,
        action: () => {
          navigate('/agent');
          close();
        },
        keywords: 'ai chat ask',
      },
      {
        id: 'nav-services',
        label: 'Services',
        icon: <Database className="h-4 w-4" />,
        action: () => {
          navigate('/services');
          close();
        },
        keywords: 'database redis postgres',
      },
      {
        id: 'settings',
        label: 'Settings',
        description: t('command.configureLlmGithub'),
        icon: <Settings className="h-4 w-4" />,
        action: () => {
          navigate('/settings');
          close();
        },
        keywords: 'config llm github api key',
      },
    ];

    const projectItems: CommandItem[] = [];
    for (const project of projects) {
      projectItems.push({
        id: `go-${project.id}`,
        label: project.name,
        description: `${'Go to'} ${project.name} (${project.status})`,
        icon: <FolderOpen className="h-4 w-4" />,
        action: () => {
          navigate(`/projects/${project.id}`);
          close();
        },
        keywords: `project ${project.status}`,
      });

      if (project.status === 'running' || project.status === 'error') {
        projectItems.push({
          id: `redeploy-${project.id}`,
          label: `${'Redeploy'} ${project.name}`,
          description: t('command.triggerFreshDeploy'),
          icon: <RotateCw className="h-4 w-4" />,
          action: () => {
            redeployProject(project.id);
            close();
          },
          keywords: 'rebuild restart',
        });
      }

      if (project.status === 'running') {
        projectItems.push({
          id: `stop-${project.id}`,
          label: `${'Stop'} ${project.name}`,
          description: t('command.stopContainer'),
          icon: <Square className="h-4 w-4" />,
          action: () => {
            stopProject(project.id);
            close();
          },
          keywords: 'halt shutdown',
        });

        projectItems.push({
          id: `logs-${project.id}`,
          label: `Logs: ${project.name}`,
          description: 'View container logs',
          icon: <Terminal className="h-4 w-4" />,
          action: () => {
            navigate(`/projects/${project.id}?tab=console`);
            close();
          },
          keywords: 'console output stderr',
        });
      }
    }

    const systemItems: CommandItem[] = [
      {
        id: 'new-project',
        label: 'New Project',
        description: t('command.deployNewRepo'),
        icon: <Plus className="h-4 w-4" />,
        action: () => {
          navigate('/new');
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
          heading: 'Recent',
          items: recentItems,
        });
        flatFilteredList.push(...recentItems);
      }

      resultGroups.push({ id: 'navigation', heading: 'Navigation', items: navItems });
      flatFilteredList.push(...navItems);

      if (projectItems.length > 0) {
        resultGroups.push({ id: 'projects', heading: 'Projects', items: projectItems });
        flatFilteredList.push(...projectItems);
      }

      resultGroups.push({ id: 'system', heading: 'System', items: systemItems });
      flatFilteredList.push(...systemItems);
    } else {
      // When querying, just group the filtered items
      const filteredNav = navItems.filter((item) => filteredItems.includes(item));
      const filteredProjects = projectItems.filter((item) => filteredItems.includes(item));
      const filteredSystem = systemItems.filter((item) => filteredItems.includes(item));

      if (filteredNav.length > 0) {
        resultGroups.push({ id: 'navigation', heading: 'Navigation', items: filteredNav });
        flatFilteredList.push(...filteredNav);
      }
      if (filteredProjects.length > 0) {
        resultGroups.push({ id: 'projects', heading: 'Projects', items: filteredProjects });
        flatFilteredList.push(...filteredProjects);
      }
      if (filteredSystem.length > 0) {
        resultGroups.push({ id: 'system', heading: 'System', items: filteredSystem });
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
        if (flatFiltered.length === 0 && query.trim()) {
          // AI fallback
          navigate(`/agent?prompt=${encodeURIComponent(query)}`);
          close();
        } else if (flatFiltered[selectedIndex]) {
          executeCommand(flatFiltered[selectedIndex]);
        }
      }
    },
    [flatFiltered, selectedIndex, query, navigate, close, executeCommand],
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
            <Search className="h-4 w-4 text-muted-ol shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('command.searchPlaceholder')}
              className="flex-1 py-3 bg-transparent text-sm font-body text-primary-ol placeholder:text-muted-ol focus:outline-none"
            />
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-mono text-muted-ol bg-bg-subtle border border-border">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[300px] overflow-y-auto py-2">
            {flatFiltered.length === 0 && query.trim() ? (
              <div className="py-2">
                <button
                  onClick={() => {
                    navigate(`/agent?prompt=${encodeURIComponent(query)}`);
                    close();
                  }}
                  onMouseEnter={() => setSelectedIndex(0)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    selectedIndex === 0
                      ? 'bg-agent/10 text-primary-ol'
                      : 'text-secondary-ol hover:bg-bg-subtle/50',
                  )}
                >
                  <Bot className={cn('h-4 w-4', selectedIndex === 0 ? 'text-agent' : 'text-ai')} />
                  <div className="flex-1">
                    <p className="text-sm">Ask AI: "{query}"</p>
                    <p className="text-xs text-muted-ol">Open Agent Chat with this query</p>
                  </div>
                  {selectedIndex === 0 && (
                    <span className="text-xs font-mono text-muted-ol">↵</span>
                  )}
                </button>
              </div>
            ) : flatFiltered.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-body text-muted-ol">{t('command.noResults')}</p>
              </div>
            ) : (
              groups.map((group) =>
                group.items.length > 0 ? (
                  <div key={group.id}>
                    <p className="px-4 py-1.5 text-xs uppercase tracking-[0.08em] font-mono text-muted-ol">
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
                              ? 'bg-agent/10 text-primary-ol'
                              : 'text-secondary-ol hover:bg-bg-subtle/50',
                          )}
                        >
                          <span
                            className={cn(
                              'shrink-0',
                              currentIndex === selectedIndex ? 'text-agent' : 'text-muted-ol',
                            )}
                          >
                            {item.icon}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-body truncate">{item.label}</p>
                            {item.description && (
                              <p className="text-xs font-body text-muted-ol truncate">
                                {item.description}
                              </p>
                            )}
                          </div>
                          {currentIndex === selectedIndex && (
                            <span className="text-xs font-mono text-muted-ol shrink-0">↵</span>
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
          <div className="flex items-center gap-4 px-4 py-2 border-t border-[hsl(var(--border))] text-xs font-mono text-muted-ol bg-bg-panel">
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-bg-subtle border border-border">↑↓</kbd>{' '}
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-bg-subtle border border-border">↵</kbd> select
            </span>
            <span className="flex items-center gap-1">
              <kbd className="px-1 py-0.5 rounded bg-bg-subtle border border-border">esc</kbd> close
            </span>
          </div>
        </div>
      </div>
    </>
  );
}
