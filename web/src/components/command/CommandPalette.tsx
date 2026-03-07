import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useProjects } from '@/hooks/use-projects';
import { redeployProject, stopProject } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Search, FolderOpen, RotateCw, Square, Settings, Plus, Command } from 'lucide-react';

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  icon: React.ReactNode;
  action: () => void;
  keywords?: string;
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

  // Build command items
  const items = useMemo((): CommandItem[] => {
    const commands: CommandItem[] = [
      {
        id: 'new-project',
        label: t('nav.newProject'),
        description: t('command.deployNewRepo'),
        icon: <Plus className="h-4 w-4" />,
        action: () => {
          navigate('/new');
          close();
        },
        keywords: 'deploy create add',
      },
      {
        id: 'settings',
        label: t('nav.settings'),
        description: t('command.configureLlmGithub'),
        icon: <Settings className="h-4 w-4" />,
        action: () => {
          navigate('/settings');
          close();
        },
        keywords: 'config llm github api key',
      },
    ];

    // Add project-specific commands
    for (const project of projects) {
      commands.push({
        id: `go-${project.id}`,
        label: project.name,
        description: `${t('command.goTo')} ${project.name} (${project.status})`,
        icon: <FolderOpen className="h-4 w-4" />,
        action: () => {
          navigate(`/projects/${project.id}`);
          close();
        },
        keywords: `project ${project.status}`,
      });

      if (project.status === 'running' || project.status === 'error') {
        commands.push({
          id: `redeploy-${project.id}`,
          label: `${t('command.redeploy')} ${project.name}`,
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
        commands.push({
          id: `stop-${project.id}`,
          label: `${t('command.stop')} ${project.name}`,
          description: t('command.stopContainer'),
          icon: <Square className="h-4 w-4" />,
          action: () => {
            stopProject(project.id);
            close();
          },
          keywords: 'halt shutdown',
        });
      }
    }

    return commands;
  }, [projects, navigate, close]);

  // Filter by query
  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const lower = query.toLowerCase();
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(lower) ||
        item.description?.toLowerCase().includes(lower) ||
        item.keywords?.toLowerCase().includes(lower),
    );
  }, [items, query]);

  // Clamp selected index
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && filtered[selectedIndex]) {
        e.preventDefault();
        filtered[selectedIndex].action();
      }
    },
    [filtered, selectedIndex],
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={close}
      />

      {/* Palette */}
      <div className="fixed inset-x-0 top-[20%] z-50 mx-auto w-full max-w-lg animate-in fade-in slide-in-from-top-4 duration-200">
        <div className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel shadow-2xl shadow-black/30 overflow-hidden">
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
            <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-muted-ol bg-bg-subtle border border-border">
              <Command className="h-2.5 w-2.5" />K
            </kbd>
          </div>

          {/* Results */}
          <div className="max-h-[300px] overflow-y-auto py-2">
            {filtered.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm font-body text-muted-ol">{t('command.noResults')}</p>
              </div>
            ) : (
              filtered.map((item, index) => (
                <button
                  key={item.id}
                  onClick={item.action}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    'w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors',
                    index === selectedIndex
                      ? 'bg-agent/10 text-primary-ol'
                      : 'text-secondary-ol hover:bg-bg-subtle/50',
                  )}
                >
                  <span
                    className={cn(
                      'shrink-0',
                      index === selectedIndex ? 'text-agent' : 'text-muted-ol',
                    )}
                  >
                    {item.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-body truncate">{item.label}</p>
                    {item.description && (
                      <p className="text-[11px] font-body text-muted-ol truncate">
                        {item.description}
                      </p>
                    )}
                  </div>
                  {index === selectedIndex && (
                    <span className="text-[10px] font-mono text-muted-ol shrink-0">↵</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </>
  );
}
