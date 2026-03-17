import { useState, useEffect, useCallback } from 'react';
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

export function ServiceDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
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
        toast.error('Service not found');
        navigate('/services');
      }
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    void fetchService();
    const interval = setInterval(() => {
      void fetchService();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchService]);

  const handleStart = async () => {
    if (!id) return;
    setActionLoading('start');
    try {
      await startService(id);
      toast.success('Service started');
      await fetchService();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start service');
    } finally {
      setActionLoading(null);
    }
  };

  const handleStop = async () => {
    if (!id) return;
    setActionLoading('stop');
    try {
      await stopService(id);
      toast.success('Service stopped');
      await fetchService();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to stop service');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    setActionLoading('delete');
    try {
      await removeService(id);
      toast.success('Service deleted');
      navigate('/services');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete service');
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
        <p className="text-sm font-body text-secondary-ol">Service not found</p>
      </div>
    );
  }

  const supportsDatabases = service.type === 'postgresql' || service.type === 'mysql';

  return (
    <div className="flex flex-col h-full">
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
            Overview
          </TabsTrigger>
          <TabsTrigger
            value="connection"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <LinkIcon className="h-3.5 w-3.5" />
            Connection
          </TabsTrigger>
          {supportsDatabases && (
            <TabsTrigger
              value="databases"
              className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
            >
              <Database className="h-3.5 w-3.5" />
              Databases
            </TabsTrigger>
          )}
          <TabsTrigger
            value="logs"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <SquareTerminal className="h-3.5 w-3.5" />
            Logs
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="gap-1.5 text-xs font-body data-[state=active]:text-agent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-agent rounded-none"
          >
            <Settings className="h-3.5 w-3.5" />
            Settings
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
