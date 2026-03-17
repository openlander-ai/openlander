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
import { Plus, Play, Square, Loader2 } from 'lucide-react';

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
        <h2 className="text-sm font-body font-medium text-secondary-ol tracking-wide uppercase">
          Services
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-5 h-36"
            >
              <Skeleton className="h-4 w-24 mb-3" />
              <Skeleton className="h-3 w-32 mb-2" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <h2 className="text-sm font-body font-medium text-secondary-ol tracking-wide uppercase">
        Services
      </h2>

      <CreateServiceDialog
        open={showCreate}
        onOpenChange={setShowCreate}
        templates={templates}
        onSuccess={fetchServices}
        initialMode={createMode}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <button
          onClick={openCreate}
          className="rounded-xl border-2 border-dashed border-[hsl(var(--border))] bg-bg-panel/30 p-5 h-36 flex flex-col items-center justify-center gap-2 text-secondary-ol hover:border-primary-ol/40 hover:text-primary-ol hover:bg-bg-panel/60 transition-all cursor-pointer group"
        >
          <div className="h-10 w-10 rounded-full border-2 border-dashed border-current flex items-center justify-center group-hover:border-solid transition-all">
            <Plus className="h-5 w-5" />
          </div>
          <span className="text-sm font-body font-medium">Create Service</span>
        </button>

        {services.map((service) => {
          const isRunning = service.status === 'running';
          const isError = service.status === 'error';

          return (
            <div
              key={service.id}
              onClick={() => navigate(`/services/${service.id}`)}
              className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-5 h-36 flex flex-col justify-between cursor-pointer hover:border-primary-ol/50 transition-colors card-hover"
            >
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      isRunning ? 'bg-success' : isError ? 'bg-error' : 'bg-[var(--text-muted)]',
                    )}
                  />
                  <h3 className="text-sm font-display font-semibold text-primary-ol truncate">
                    {service.name}
                  </h3>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono">
                  {service.image}
                </Badge>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-ol">Port {service.port}</span>
                {isRunning ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={(e) => handleAction(e, service.id, 'stop')}
                    disabled={actionLoading[`${service.id}-stop`]}
                  >
                    {actionLoading[`${service.id}-stop`] ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Square className="h-3 w-3" />
                    )}
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={(e) => handleAction(e, service.id, 'start')}
                    disabled={actionLoading[`${service.id}-start`]}
                  >
                    {actionLoading[`${service.id}-start`] ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Play className="h-3 w-3" />
                    )}
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
