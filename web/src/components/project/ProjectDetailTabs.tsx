import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, History, SquareTerminal, Settings } from 'lucide-react';
import { OverviewTab } from '@/components/project/OverviewTab';
import { DeploymentsTab } from '@/components/project/DeploymentsTab';
import { ConsoleTab } from '@/components/project/ConsoleTab';
import { SettingsTab } from '@/components/project/SettingsTab';
import type { ProjectWithOptionalEnvironments } from '@/lib/api';
import type { TimelineItem } from '@/lib/event-types';
import type { Environment } from '@/types';
import { cn } from '@/lib/utils';

interface ProjectDetailTabsProps {
  id?: string;
  activeTab: string;
  onActiveTabChange: (value: string) => void;
  displayProject: ProjectWithOptionalEnvironments | null;
  environments?: Environment[];
  allTimelineItems: TimelineItem[];
  isStreaming: boolean;
  timelineDisconnected?: boolean;
  selectedEnvId?: string;
  currentEnvType?: string;
  envFade?: boolean;
  onRedeploy: () => void;
  onStop: () => void;
  onRollback: () => void;
}

export function ProjectDetailTabs({
  id,
  activeTab,
  onActiveTabChange,
  displayProject,
  environments,
  allTimelineItems,
  isStreaming,
  selectedEnvId,
  currentEnvType,
  envFade,
  onRedeploy,
  onStop,
  onRollback,
}: ProjectDetailTabsProps) {
  return (
    <Tabs
      value={activeTab}
      onValueChange={onActiveTabChange}
      className="flex-1 flex flex-col min-h-0"
      style={{ opacity: envFade ? 0.5 : 1, transition: 'opacity 150ms ease-in-out' }}
    >
      <TabsList
        className={cn(
          'shrink-0 w-full justify-start rounded-none border-b border-[hsl(var(--border))] bg-transparent px-6 h-10',
          currentEnvType === 'development' &&
            '[&_[data-state=active]]:text-blue-500 [&_[data-state=active]]:border-blue-500',
        )}
      >
        <TabsTrigger
          value="overview"
          className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
        >
          <Activity className="h-3.5 w-3.5" />
          Overview
        </TabsTrigger>
        <TabsTrigger
          value="deployments"
          className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
        >
          <History className="h-3.5 w-3.5" />
          Deployments
        </TabsTrigger>
        <TabsTrigger
          value="console"
          className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
        >
          <SquareTerminal className="h-3.5 w-3.5" />
          Console
        </TabsTrigger>
        <TabsTrigger
          value="settings"
          className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="flex-1 min-h-0 mt-0">
        {id && displayProject && (
          <OverviewTab
            projectId={id}
            projectStatus={displayProject.status}
            displayProject={displayProject}
            environments={environments}
            timelineItems={allTimelineItems}
            isTimelineStreaming={isStreaming}
            onOpenLogs={() => onActiveTabChange('console')}
            onOpenDeployments={() => onActiveTabChange('deployments')}
            onOpenSettings={() => onActiveTabChange('settings')}
            onRedeploy={onRedeploy}
            onStop={onStop}
            onRollback={onRollback}
          />
        )}
      </TabsContent>

      <TabsContent value="deployments" className="flex-1 min-h-0 mt-0">
        {id && displayProject && (
          <DeploymentsTab
            projectId={id}
            projectStatus={displayProject.status}
            projectBranch={displayProject.branch}
            environmentId={selectedEnvId}
          />
        )}
      </TabsContent>

      <TabsContent value="console" className="flex-1 min-h-0 mt-0">
        {id && displayProject && (
          <ConsoleTab
            projectId={id}
            isActive={activeTab === 'console'}
            projectStatus={displayProject.status}
            environmentType={currentEnvType}
          />
        )}
      </TabsContent>

      <TabsContent value="settings" className="flex-1 min-h-0 mt-0">
        {id && displayProject && (
          <SettingsTab projectId={id} projectStatus={displayProject.status} />
        )}
      </TabsContent>
    </Tabs>
  );
}
