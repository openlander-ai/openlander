import { Loader2 } from 'lucide-react';
import { useLanguage } from '@/i18n/context';
import { useSetup } from '@/hooks/use-setup';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SystemSettingsTab } from '@/components/settings/SystemSettingsTab';
import { TraefikSettingsTab } from '@/components/settings/TraefikSettingsTab';
import { GithubSettingsTab } from '@/components/settings/GithubSettingsTab';
import { LlmSettingsTab } from '@/components/settings/LlmSettingsTab';
import { SecuritySettingsTab } from '@/components/settings/SecuritySettingsTab';
import { AiSettingsTab } from '@/components/settings/AiSettingsTab';

export function SettingsPage() {
  const { status, loading, refetch } = useSetup();
  const { t } = useLanguage();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-agent" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-primary-ol tracking-tight">
          {t('settings.title')}
        </h1>
        <p className="text-sm font-body text-secondary-ol mt-1">{t('settings.description')}</p>
      </div>

      <Tabs defaultValue="system" className="space-y-6 min-h-[480px]">
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-6 h-auto gap-1 bg-bg-subtle/50 p-1">
          <TabsTrigger value="system" className="font-body text-xs sm:text-sm">
            {t('settings.tabs.system')}
          </TabsTrigger>
          <TabsTrigger value="security" className="font-body text-xs sm:text-sm">
            Security
          </TabsTrigger>
          <TabsTrigger value="proxy" className="font-body text-xs sm:text-sm">
            {t('settings.tabs.proxy')}
          </TabsTrigger>
          <TabsTrigger value="github" className="font-body text-xs sm:text-sm">
            {t('settings.tabs.github')}
          </TabsTrigger>
          <TabsTrigger value="llm" className="font-body text-xs sm:text-sm">
            {t('settings.tabs.llm')}
          </TabsTrigger>
          <TabsTrigger value="ai" className="font-body text-xs sm:text-sm">
            {t('settings.ai.title')}
          </TabsTrigger>
        </TabsList>

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
          value="llm"
          className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
        >
          <LlmSettingsTab status={status} refetch={refetch} />
        </TabsContent>
        <TabsContent
          value="ai"
          className="mt-0 data-[state=inactive]:!animate-none data-[state=active]:!animate-none"
        >
          <AiSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
