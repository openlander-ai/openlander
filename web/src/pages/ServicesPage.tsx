import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Skeleton } from '@/components/ui/skeleton';
import { PageEmptyState } from '@/components/ui/page-empty-state';
import { Badge } from '@/components/ui/badge';
import { getServices, getServiceTemplates, type Service, type ServiceTemplate } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Plus, Database } from 'lucide-react';
import { useLanguage } from '@/i18n/context';

import { CreateServiceDialog } from '@/components/service/CreateServiceDialog';
import { PageHeader } from '@/components/layout/PageHeader';

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

function getTypeVariant(type: string): 'blue' | 'red' | 'orange' | 'neutral' {
  const t = type.toLowerCase();
  if (t === 'postgres' || t === 'postgresql') return 'blue';
  if (t === 'redis') return 'red';
  if (t === 'mysql') return 'orange';
  return 'neutral';
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
      <div className="flex flex-col h-full w-full">
        <PageHeader title={t('services.title')} />
        <div className="p-6 xl:p-8 space-y-6">
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
      </div>
    );
  }

  if (services.length === 0) {
    return (
      <div className="flex flex-col h-full w-full">
        <PageHeader title={t('services.title')} />
        <div className="p-6 xl:p-8 space-y-6">
          <PageEmptyState
            icon={Database}
            title={t('services.empty.title')}
            description={t('services.empty.description')}
            action={
              <button
                onClick={() => {
                  setCreateMode('template');
                  setShowCreate(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-agent text-white font-medium hover:bg-agent/90 transition-colors"
              >
                <Plus className="h-4 w-4" />
                {t('services.createService')}
              </button>
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      <PageHeader title={t('services.title')} />
      <div className="p-6 xl:p-8 space-y-6">
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
            className="rounded-xl border-2 border-dashed border-[hsl(var(--border))] bg-bg-panel/30 p-5 min-h-[144px] flex flex-col items-center justify-center gap-2 text-foreground/80 hover:border-foreground/40 hover:text-foreground hover:bg-bg-panel/60 transition-all cursor-pointer group"
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
                className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-5 min-h-[176px] flex flex-col justify-between cursor-pointer hover:border-foreground/50 transition-colors card-hover"
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
                                : 'bg-muted-foreground/40',
                          )}
                        />
                        <h3 className="text-sm font-display font-semibold text-foreground truncate">
                          {service.name}
                        </h3>
                      </div>
                      {service.type && (
                        <Badge
                          variant={getTypeVariant(service.type)}
                          className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider shrink-0 ml-2"
                        >
                          {service.type.toLowerCase()}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs font-mono text-muted-foreground truncate">
                      {service.image}
                    </p>
                  </div>

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
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
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t('services.metrics.health')}
                      </div>
                      <div className="font-mono text-foreground">
                        {healthLabel(service.summary?.healthStatus ?? null)}
                      </div>
                    </div>
                    <div className="rounded-md border border-[hsl(var(--border))]/60 bg-bg-app/20 px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t('services.metrics.uptime')}
                      </div>
                      <div className="font-mono text-foreground">
                        {service.summary?.uptimeSeconds != null
                          ? formatUptime(service.summary.uptimeSeconds)
                          : '—'}
                      </div>
                    </div>
                    <div className="rounded-md border border-[hsl(var(--border))]/60 bg-bg-app/20 px-2 py-1.5">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {t('services.metrics.restarts')}
                      </div>
                      <div className="font-mono text-foreground">
                        {service.summary?.restartCount != null ? service.summary.restartCount : '—'}
                      </div>
                    </div>
                  </div>
                </div>

                {service.updated_at && getRelativeTime(service.updated_at) && (
                  <div className="mt-3 pt-3 border-t border-[hsl(var(--border))]/50 flex items-center text-[11px] text-muted-foreground font-body">
                    {t('services.updatedAgo', { time: getRelativeTime(service.updated_at) })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
