import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getServices,
  getServiceTemplates,
  startService,
  stopService,
  type Service,
  type ServiceTemplate,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Database, Plus, Play, Square, Loader2, Container } from 'lucide-react';

import { CreateServiceDialog } from '@/components/service/CreateServiceDialog';

export function ServicesPage() {
  const navigate = useNavigate();
  const [services, setServices] = useState<Service[]>([]);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<'template' | 'custom'>('template');

  const fetchServices = async () => {
    try {
      const [svcs, tmpls] = await Promise.all([getServices(), getServiceTemplates()]);
      setServices(svcs);
      setTemplates(tmpls);
    } catch (err) {
      console.error('Failed to fetch services:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchServices();
  }, []);

  const handleAction = async (e: React.MouseEvent, id: string, action: 'start' | 'stop') => {
    e.stopPropagation();
    setActionLoading((prev) => ({ ...prev, [`${id}-${action}`]: true }));
    try {
      if (action === 'start') {
        await startService(id);
        toast.success('Service started');
      } else if (action === 'stop') {
        await stopService(id);
        toast.success('Service stopped');
      }

      await fetchServices();
    } catch (err) {
      console.error(`Failed to ${action} service:`, err);
      toast.error(`Failed to ${action} service`);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`${id}-${action}`]: false }));
    }
  };

  const openCreate = () => {
    setCreateMode('template');
    setShowCreate(true);
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Skeleton className="h-8 w-32 mb-2" />
            <Skeleton className="h-4 w-48" />
          </div>
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="space-y-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-4 flex flex-col md:flex-row md:items-center justify-between gap-4"
            >
              <div className="flex items-center gap-4">
                <Skeleton className="h-3 w-3 rounded-full" />
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </div>
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-3 w-24" />
                    <Skeleton className="h-3 w-16" />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Skeleton className="h-8 w-24" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-primary-ol flex items-center gap-2">
            <Database className="h-6 w-6" />
            Services
          </h1>
          <p className="text-sm text-secondary-ol mt-1">
            Manage shared infrastructure services like databases and caches
          </p>
        </div>
        {services.length > 0 && (
          <Button
            onClick={openCreate}
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs shrink-0 mt-0.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Create Service
          </Button>
        )}
      </div>

      <CreateServiceDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        templates={templates}
        onSuccess={fetchServices}
        initialMode={createMode}
      />

      {/* Services List */}
      <div className="space-y-4">
        {services.length === 0 ? (
          <div className="text-center py-12 border border-dashed border-[hsl(var(--border))] rounded-xl bg-bg-panel/50">
            <Database className="h-12 w-12 mx-auto text-secondary-ol/50 mb-3" />
            <h3 className="text-lg font-medium text-primary-ol">No services yet</h3>
            <p className="text-sm text-secondary-ol mt-1 mb-4">
              Create your first service to get started
            </p>
            <Button onClick={openCreate} variant="outline" size="sm" className="gap-1.5 text-xs">
              <Plus className="h-3.5 w-3.5" />
              Create Service
            </Button>
          </div>
        ) : (
          services.map((service) => {
            const isRunning = service.status === 'running';
            const isError = service.status === 'error';

            return (
              <div
                key={service.id}
                onClick={() => navigate(`/services/${service.id}`)}
                className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel overflow-hidden cursor-pointer hover:border-primary-ol/50 transition-colors"
              >
                <div className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div
                      className={cn(
                        'w-3 h-3 rounded-full shrink-0',
                        isRunning ? 'bg-success' : isError ? 'bg-error' : 'bg-[var(--text-muted)]',
                      )}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-medium text-primary-ol">{service.name}</h3>
                        <Badge variant="outline" className="text-xs font-mono">
                          {service.image}
                        </Badge>
                      </div>
                      <div className="text-xs text-secondary-ol mt-1 flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <Container className="h-3 w-3" />
                          {service.container_name}
                        </span>
                        {service.port && <span>Port: {service.port}</span>}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {isRunning ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => handleAction(e, service.id, 'stop')}
                        disabled={actionLoading[`${service.id}-stop`]}
                      >
                        {actionLoading[`${service.id}-stop`] ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Square className="h-3 w-3 mr-1" />
                        )}
                        {'Stop'}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => handleAction(e, service.id, 'start')}
                        disabled={actionLoading[`${service.id}-start`]}
                      >
                        {actionLoading[`${service.id}-start`] ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3 mr-1" />
                        )}
                        {'Start'}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
