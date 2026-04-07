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
    'flex items-center gap-2 px-3 py-2.5 font-body text-sm rounded-md md:rounded-l-none md:rounded-r-md border-l-2 border-transparent data-[state=active]:bg-bg-subtle data-[state=active]:text-primary-ol data-[state=active]:font-medium data-[state=active]:border-primary-ol text-secondary-ol shadow-none transition-all hover:text-primary-ol hover:bg-bg-subtle/50 whitespace-nowrap w-full !justify-start';

  return (
    <div className="w-full max-w-[1200px] p-4 md:p-8 space-y-8">
      <div className="border-b border-[hsl(var(--border))] pb-6">
        <h1 className="font-display text-2xl font-bold text-primary-ol tracking-tight">
          {t('settings.title')}
        </h1>
        <p className="text-sm font-body text-secondary-ol mt-1">{t('settings.description')}</p>
      </div>

      <Tabs
        defaultValue="system"
        className="flex flex-col md:flex-row gap-6 md:gap-8 min-h-[600px] items-start relative"
      >
        {/* Sidebar Tabs */}
        <TabsList className="flex flex-row md:flex-col h-auto w-full md:w-56 bg-transparent p-0 gap-1 justify-start md:items-stretch shrink-0 overflow-x-auto md:overflow-visible border-b md:border-none md:border-r border-[hsl(var(--border))] pb-2 md:pb-0 md:pr-4 md:sticky md:top-10">
          <TabsTrigger value="system" className={triggerClass}>
            <Settings className="w-4 h-4 shrink-0" />
            {t('settings.tabs.system')}
          </TabsTrigger>
          <TabsTrigger value="security" className={triggerClass}>
            <Shield className="w-4 h-4 shrink-0" />
            Security
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
            Operations
          </TabsTrigger>
          <TabsTrigger value="mcp" className={triggerClass}>
            <Cable className="w-4 h-4 shrink-0" />
            {t('settings.tabs.mcp')}
          </TabsTrigger>
        </TabsList>

        {/* Main Content Area */}
        <div className="flex-1 w-full min-w-0">
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
