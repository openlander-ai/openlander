import { Loader2, Settings, Shield, Globe, Github, Bot, Cable, Activity } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { useSetup } from '@/hooks/use-setup';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SystemSettingsTab } from '@/components/settings/SystemSettingsTab';
import { TraefikSettingsTab } from '@/components/settings/TraefikSettingsTab';
import { GithubSettingsTab } from '@/components/settings/GithubSettingsTab';

import { SecuritySettingsTab } from '@/components/settings/SecuritySettingsTab';
import { AiSettingsTab } from '@/components/settings/AiSettingsTab';
import { McpSettingsTab } from '@/components/settings/McpSettingsTab';
import { OperationsSettings } from '@/components/settings/OperationsSettings';
import { PageHeader } from '@/components/layout/PageHeader';

export function SettingsPage() {
  const { status, loading, refetch } = useSetup();
  const { t } = useLanguage();

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-agent" />
      </div>
    );
  }

  const triggerClass =
    'flex items-center gap-2 w-full !justify-start text-left px-3 py-2 rounded-md text-xs font-body transition-colors shadow-none data-[state=active]:shadow-none data-[state=active]:bg-bg-subtle data-[state=active]:text-foreground data-[state=active]:font-medium text-foreground/80 hover:text-foreground hover:bg-bg-subtle/50 whitespace-nowrap';

  return (
    <div className="flex flex-col h-full w-full">
      <PageHeader title={t('settings.title')} description={t('settings.description')} />
      <Tabs
        defaultValue="system"
        className="flex flex-col md:flex-row flex-1 min-h-0 overflow-hidden"
      >
        {/* Sidebar Tabs — matches ProjectDetail SettingsTab nav */}
        <TabsList className="flex flex-row md:flex-col h-auto md:h-full w-full md:w-48 bg-bg-panel p-3 gap-1 justify-start md:items-stretch shrink-0 overflow-x-auto md:overflow-y-auto border-b md:border-b-0 md:border-r border-[hsl(var(--border))]">
          <TabsTrigger value="system" className={triggerClass}>
            <Settings className="w-4 h-4 shrink-0" />
            {t('settings.tabs.system')}
          </TabsTrigger>
          <TabsTrigger value="security" className={triggerClass}>
            <Shield className="w-4 h-4 shrink-0" />
            {t('settings.tabs.security')}
          </TabsTrigger>
          <TabsTrigger value="proxy" className={triggerClass}>
            <Globe className="w-4 h-4 shrink-0" />
            {t('settings.tabs.proxy')}
          </TabsTrigger>
          <TabsTrigger value="github" className={triggerClass}>
            <Github className="w-4 h-4 shrink-0" />
            {t('settings.tabs.github')}
          </TabsTrigger>
          <TabsTrigger value="ai" className={triggerClass}>
            <Bot className="w-4 h-4 shrink-0" />
            {t('settings.ai.title')}
          </TabsTrigger>
          <TabsTrigger value="operations" className={triggerClass}>
            <Activity className="w-4 h-4 shrink-0" />
            {t('settings.tabs.operations')}
          </TabsTrigger>
          <TabsTrigger value="mcp" className={triggerClass}>
            <Cable className="w-4 h-4 shrink-0" />
            {t('settings.tabs.mcp')}
          </TabsTrigger>
        </TabsList>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0 overflow-auto p-6 xl:p-8">
          <TabsContent
            value="system"
            className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
          >
            <SystemSettingsTab />
          </TabsContent>
          <TabsContent
            value="security"
            className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
          >
            <SecuritySettingsTab />
          </TabsContent>
          <TabsContent
            value="proxy"
            className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
          >
            <TraefikSettingsTab />
          </TabsContent>
          <TabsContent
            value="github"
            className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
          >
            <GithubSettingsTab status={status} refetch={refetch} />
          </TabsContent>
          <TabsContent
            value="ai"
            className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
          >
            <AiSettingsTab />
          </TabsContent>
          <TabsContent
            value="operations"
            className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
          >
            <OperationsSettings />
          </TabsContent>
          <TabsContent
            value="mcp"
            className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
          >
            <McpSettingsTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
