import { useState } from 'react';
import { EnvVarsTable } from '@/components/config/EnvVarsTable';
import { DomainsPanel } from '@/components/config/DomainsPanel';
import { WebhookPanel } from '@/components/config/WebhookPanel';
import { DeploymentSourcePanel } from '@/components/project/DeploymentSourcePanel';
import { ResourceLimitsPanel } from '@/components/config/ResourceLimitsPanel';
import { useLanguage } from '@/i18n/context';
import { cn } from '@/lib/utils';

type SettingsSection = 'source' | 'env' | 'domains' | 'webhooks' | 'resources';

interface SettingsTabProps {
  projectId: string;
  projectStatus?: string;
  isCompose?: boolean;
}

export function SettingsTab({ projectId, projectStatus, isCompose }: SettingsTabProps) {
  const { t } = useLanguage();
  const [activeSection, setActiveSection] = useState<SettingsSection>('source');

  const navItems: { id: SettingsSection; label: string }[] = [
    { id: 'source', label: t('settings.nav.source') },
    { id: 'env', label: t('settings.nav.env') },
    { id: 'domains', label: t('settings.nav.domains') },
    { id: 'webhooks', label: t('settings.nav.webhooks') },
    { id: 'resources', label: t('resources.title') },
  ];

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0 overflow-hidden">
      {/* Left nav: horizontal on mobile, vertical on desktop */}
      <div className="shrink-0 md:w-48 border-b md:border-b-0 md:border-r border-[hsl(var(--border))] bg-bg-panel">
        {/* Mobile: horizontal scroll row */}
        <div className="flex md:hidden overflow-x-auto px-3 py-2 gap-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={cn(
                'shrink-0 px-3 py-1.5 rounded-md text-xs font-body transition-colors whitespace-nowrap',
                activeSection === item.id
                  ? 'bg-bg-subtle text-primary-ol font-medium'
                  : 'text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle/50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Desktop: vertical list */}
        <div className="hidden md:flex flex-col p-3 gap-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              className={cn(
                'w-full text-left px-3 py-2 rounded-md text-xs font-body transition-colors',
                activeSection === item.id
                  ? 'bg-bg-subtle text-primary-ol font-medium'
                  : 'text-secondary-ol hover:text-primary-ol hover:bg-bg-subtle/50',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Right pane: settings form */}
      <div className="flex-1 min-w-0 overflow-auto p-4">
        {activeSection === 'source' && <DeploymentSourcePanel projectId={projectId} />}
        {activeSection === 'env' && <EnvVarsTable projectId={projectId} />}
        {activeSection === 'domains' && (
          <DomainsPanel projectId={projectId} projectStatus={projectStatus} />
        )}
        {activeSection === 'webhooks' && <WebhookPanel projectId={projectId} />}
        {activeSection === 'resources' && (
          <ResourceLimitsPanel projectId={projectId} isCompose={isCompose} />
        )}
      </div>
    </div>
  );
}
