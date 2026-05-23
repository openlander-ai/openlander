/**
 * Tabs primitive — Shell V2.
 *
 * WAI-ARIA "automatic activation" tablist:
 *   - role="tablist" / role="tab" / role="tabpanel"
 *   - tabIndex roving (active = 0, others = -1)
 *   - Left/Right cycle the active tab
 *   - Home / End jump to first / last
 *   - Activation follows focus (arrow press both moves focus AND
 *     selects the tab — matches the "automatic activation" pattern
 *     defined in the WAI-ARIA Authoring Practices)
 *
 * Used by:
 *   - ProjectViewV2  (Services / Activity)
 *   - ServiceDetailV2 (Overview / Logs / Deployments / Monitoring / Environment / Domains)
 */
import { useCallback, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface TabDef<Id extends string = string> {
  id: Id;
  label: ReactNode;
  icon?: LucideIcon;
  /** Optional right-aligned count chip */
  count?: number;
}

interface ProjectTabsProps<Id extends string> {
  tabs: TabDef<Id>[];
  active: Id;
  onChange: (id: Id) => void;
  /** Used to namespace `id` attributes when multiple tablists co-exist on the page */
  idPrefix?: string;
  ariaLabel?: string;
  className?: string;
}

export function ProjectTabs<Id extends string>({
  tabs,
  active,
  onChange,
  idPrefix = 'tab',
  ariaLabel = 'Sections',
  className,
}: ProjectTabsProps<Id>) {
  const ids = tabs.map((t) => t.id);

  const onKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const idx = ids.indexOf(active);
      if (idx < 0) return;
      let nextId: Id | null = null;
      if (e.key === 'ArrowRight') nextId = ids[(idx + 1) % ids.length];
      else if (e.key === 'ArrowLeft') nextId = ids[(idx - 1 + ids.length) % ids.length];
      else if (e.key === 'Home') nextId = ids[0];
      else if (e.key === 'End') nextId = ids[ids.length - 1];
      if (nextId != null && nextId !== active) {
        e.preventDefault();
        onChange(nextId);
        // Move focus to the newly-active tab so keyboard nav reads naturally.
        requestAnimationFrame(() => {
          const el = document.getElementById(`${idPrefix}-${String(nextId)}`);
          el?.focus();
        });
      }
    },
    [ids, active, onChange, idPrefix],
  );

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'flex items-center gap-1 border-b border-[color:var(--ol-border-subtle)] px-4',
        // Mobile: horizontal scroll with a visible thin scrollbar so clipped
        // tabs are discoverable on narrow screens.
        'overflow-x-auto scroll-smooth pb-1 [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5',
        className,
      )}
    >
      {tabs.map((t) => {
        const Icon = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${idPrefix}-${String(t.id)}`}
            aria-selected={isActive}
            aria-controls={`${idPrefix}panel-${String(t.id)}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md border-b-2 px-3 py-2.5 text-[12.5px] transition-colors',
              isActive
                ? 'border-[color:var(--ol-primary)] font-semibold text-[color:var(--ol-fg)]'
                : 'border-transparent text-[color:var(--ol-fg-muted)] hover:text-[color:var(--ol-fg)]',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ol-primary)]',
            )}
          >
            {Icon && <Icon className="h-3.5 w-3.5" />}
            <span>{t.label}</span>
            {t.count != null && (
              <span
                className={cn(
                  'ol-mono rounded-full px-1.5 py-0.5 text-[10px]',
                  isActive
                    ? 'bg-[color:var(--ol-primary-soft)] text-[color:var(--ol-primary)]'
                    : 'bg-[color:var(--ol-panel-2)] text-[color:var(--ol-fg-muted)]',
                )}
              >
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  active: boolean;
  panelId: string;
  labelledBy: string;
  className?: string;
  children: ReactNode;
}

/**
 * Renders only when active. Carries `role="tabpanel"`, the matching id
 * (so `aria-controls` on the tab actually points somewhere), and
 * `aria-labelledby`.
 */
export function TabPanel({ active, panelId, labelledBy, className, children }: TabPanelProps) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={panelId}
      aria-labelledby={labelledBy}
      tabIndex={0}
      className={cn('focus-visible:outline-none', className)}
    >
      {children}
    </div>
  );
}

export default ProjectTabs;
