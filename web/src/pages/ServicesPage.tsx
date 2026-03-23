import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { getServices, getServiceTemplates, type Service, type ServiceTemplate } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';

import { CreateServiceDialog } from '@/components/service/CreateServiceDialog';

export function ServicesPage() {
  const navigate = useNavigate();
  const [services, setServices] = useState<Service[]>([]);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);

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

  const openCreate = () => {
    setCreateMode('template');
    setShowCreate(true);
  };

  const statusLabel = (status: string) => {
    if (status === 'running') return 'Running';
    if (status === 'error') return 'Error';
    return 'Stopped';
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
                <div className="flex items-center gap-2 mb-1.5">
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
                <p className="text-xs font-mono text-muted-ol truncate">{service.image}</p>
              </div>

              <div className="flex items-center justify-between text-xs text-muted-ol">
                <span
                  className={cn(
                    'font-body',
                    isRunning
                      ? 'text-success'
                      : isError
                        ? 'text-error'
                        : 'text-[var(--text-muted)]',
                  )}
                >
                  {statusLabel(service.status)}
                </span>
                <span className="font-mono">:{service.port}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
