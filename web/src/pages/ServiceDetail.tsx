import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { getService, startService, stopService, removeService, type Service } from '@/lib/api';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Activity, Link as LinkIcon, SquareTerminal, Settings, Database } from 'lucide-react';
import { ServiceHeader } from '@/components/service/ServiceHeader';
import { ServiceOverviewTab } from '@/components/service/ServiceOverviewTab';
import { ServiceConnectionTab } from '@/components/service/ServiceConnectionTab';
import { ServiceDatabasesTab } from '@/components/service/ServiceDatabasesTab';
import { ServiceLogsTab } from '@/components/service/ServiceLogsTab';
import { ServiceSettingsTab } from '@/components/service/ServiceSettingsTab';
import { useLanguage } from '@/i18n/context';
import { usePollingTask } from '@/hooks/use-polling-task';

export function ServiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [service, setService] = useState<Service | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('overview');

  const fetchService = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getService(id);
      setService(data);
    } catch (err) {
      console.error('Failed to fetch service:', err);
      if (err instanceof Error && err.message.includes('404')) {
        toast.error(t('services.detail.notFound'));
        navigate('/services');
      }
    } finally {
      setLoading(false);
    }
  }, [id, navigate, t]);

  usePollingTask(fetchService, {
    enabled: Boolean(id),
    intervalMs: 5000,
  });

  const handleStart = async () => {
    if (!id) return;
    setActionLoading('start');
    try {
      await startService(id);
      toast.success(t('services.detail.toasts.started'));
      await fetchService();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('services.detail.toasts.startFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    if (!id) return;
    setActionLoading('stop');
    try {
      await stopService(id);
      toast.success(t('services.detail.toasts.stopped'));
      await fetchService();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('services.detail.toasts.stopFailed'));
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setActionLoading('delete');
    try {
      await removeService(id);
      toast.success(t('services.detail.toasts.deleted'));
      navigate('/services');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('services.detail.toasts.deleteFailed'));
      setActionLoading(null);
    }
  };

  if (loading && !service) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!service) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm font-body text-foreground/80">{t('services.detail.notFound')}</p>
      </div>
    );
  }

  const supportsDatabases =
    service.type === 'postgresql' || service.type === 'mysql' || service.type === 'mongodb';

  return (
    <div className="flex flex-col h-full max-w-8xl mx-auto w-full">
      <ServiceHeader
        service={service}
        actionLoading={actionLoading}
        onStart={handleStart}
        onStop={handleStop}
        onDelete={handleDelete}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col min-h-0">
        <TabsList className="shrink-0 w-full justify-start rounded-none border-b border-[hsl(var(--border))] bg-transparent px-6 h-10">
          <TabsTrigger
            value="overview"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <Activity className="h-3.5 w-3.5" />
            {t('services.detail.tabs.overview')}
          </TabsTrigger>
          <TabsTrigger
            value="connection"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <LinkIcon className="h-3.5 w-3.5" />
            {t('services.detail.tabs.connection')}
          </TabsTrigger>
          {supportsDatabases && (
            <TabsTrigger
              value="databases"
              className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
            >
              <Database className="h-3.5 w-3.5" />
              {t('services.detail.tabs.databases')}
            </TabsTrigger>
          )}
          <TabsTrigger
            value="logs"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <SquareTerminal className="h-3.5 w-3.5" />
            {t('services.detail.tabs.logs')}
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <Settings className="h-3.5 w-3.5" />
            {t('services.detail.tabs.settings')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 min-h-0 mt-0 p-6 overflow-auto">
          <ServiceOverviewTab service={service} />
        </TabsContent>

        <TabsContent value="connection" className="flex-1 min-h-0 mt-0 p-6 overflow-auto">
          <ServiceConnectionTab service={service} />
        </TabsContent>

        {supportsDatabases && (
          <TabsContent value="databases" className="flex-1 min-h-0 mt-0 p-6 overflow-auto">
            <ServiceDatabasesTab service={service} />
          </TabsContent>
        )}

        <TabsContent value="logs" className="flex-1 min-h-0 mt-0 overflow-auto">
          <ServiceLogsTab service={service} />
        </TabsContent>

        <TabsContent value="settings" className="flex-1 min-h-0 mt-0 p-6 overflow-auto">
          <ServiceSettingsTab service={service} onDeleteClick={handleDelete} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
