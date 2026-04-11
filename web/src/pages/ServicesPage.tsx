import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { getServices, getServiceTemplates, type Service, type ServiceTemplate } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Plus } from 'lucide-react';
import { useLanguage } from '@/i18n/context';

import { CreateServiceDialog } from '@/components/service/CreateServiceDialog';

function getRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Date.now() - date.getTime();
  const days = Math.floor(diff / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(diff / 3600000);
  if (hours > 0) return `${hours}h`;
  const mins = Math.floor(diff / 60000);
  return `${mins}m`;
}

function getTypeColor(type: string) {
  const t = type.toLowerCase();
  if (t === 'postgres' || t === 'postgresql')
    return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
  if (t === 'redis') return 'bg-red-500/10 text-red-500 border-red-500/20';
  if (t === 'mysql') return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
  return 'bg-gray-500/10 text-gray-500 border-gray-500/20';
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${Math.max(mins, 0)}m`;
}

export function ServicesPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
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
    if (status === 'running') return t('services.status.running');
    if (status === 'error') return t('services.status.error');
    return t('services.status.stopped');
  };

  const healthLabel = (healthStatus: string | null) => {
    if (healthStatus === 'healthy') return t('services.health.healthy');
    if (healthStatus === 'unhealthy') return t('services.health.unhealthy');
    if (healthStatus === 'starting') return t('services.health.starting');
    return '—';
  };

  if (loading) {
    return (
      <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
        <h2 className="text-lg font-semibold text-primary-ol">{t('services.title')}</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-5 min-h-[144px]"
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
        {t('services.title')}
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
          className="rounded-xl border-2 border-dashed border-[hsl(var(--border))] bg-bg-panel/30 p-5 min-h-[144px] flex flex-col items-center justify-center gap-2 text-secondary-ol hover:border-primary-ol/40 hover:text-primary-ol hover:bg-bg-panel/60 transition-all cursor-pointer group"
        >
          <div className="h-10 w-10 rounded-full border-2 border-dashed border-current flex items-center justify-center group-hover:border-solid transition-all">
            <Plus className="h-5 w-5" />
          </div>
          <span className="text-sm font-body font-medium">{t('services.createService')}</span>
        </button>

        {services.map((service) => {
          const isRunning = service.status === 'running';
          const isError = service.status === 'error';

          return (
            <div
              key={service.id}
              onClick={() => navigate(`/services/${service.id}`)}
              className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-5 min-h-[176px] flex flex-col justify-between cursor-pointer hover:border-primary-ol/50 transition-colors card-hover"
            >
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={cn(
                          'w-2 h-2 rounded-full shrink-0',
                          isRunning
                            ? 'bg-success'
                            : isError
                              ? 'bg-error'
                              : 'bg-[var(--text-muted)]',
                        )}
                      />
                      <h3 className="text-sm font-display font-semibold text-primary-ol truncate">
                        {service.name}
                      </h3>
                    </div>
                    {service.type && (
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-md text-[10px] font-medium uppercase tracking-wider border shrink-0 ml-2',
                          getTypeColor(service.type),
                        )}
                      >
                        {service.type.toLowerCase()}
                      </span>
                    )}
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

                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="rounded-md border border-[hsl(var(--border))]/60 bg-bg-app/20 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-muted-ol">
                      {t('services.metrics.health')}
                    </div>
                    <div className="font-mono text-primary-ol">
                      {healthLabel(service.summary?.healthStatus ?? null)}
                    </div>
                  </div>
                  <div className="rounded-md border border-[hsl(var(--border))]/60 bg-bg-app/20 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-muted-ol">
                      {t('services.metrics.uptime')}
                    </div>
                    <div className="font-mono text-primary-ol">
                      {service.summary?.uptimeSeconds != null
                        ? formatUptime(service.summary.uptimeSeconds)
                        : '—'}
                    </div>
                  </div>
                  <div className="rounded-md border border-[hsl(var(--border))]/60 bg-bg-app/20 px-2 py-1.5">
                    <div className="text-[10px] uppercase tracking-wider text-muted-ol">
                      {t('services.metrics.restarts')}
                    </div>
                    <div className="font-mono text-primary-ol">
                      {service.summary?.restartCount != null ? service.summary.restartCount : '—'}
                    </div>
                  </div>
                </div>
              </div>

              {service.updated_at && getRelativeTime(service.updated_at) && (
                <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]/50 flex items-center text-[11px] text-muted-ol font-body">
                  {t('services.updatedAgo', { time: getRelativeTime(service.updated_at) })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
