import { useState, useEffect } from 'react';
import { useLanguage } from '@/i18n/context';
import {
  getServices,
  getServiceTemplates,
  createService,
  removeService,
  startService,
  stopService,
  type Service,
  type ServiceTemplate,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Database,
  Plus,
  Play,
  Square,
  Trash2,
  Copy,
  Check,
  Loader2,
  Container,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

export function ServicesPage() {
  const { t } = useLanguage();
  const [services, setServices] = useState<Service[]>([]);
  const [templates, setTemplates] = useState<ServiceTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});

  // Create form state
  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<'template' | 'custom'>('template');
  const [selectedTemplate, setSelectedTemplate] = useState<ServiceTemplate | null>(null);
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [port, setPort] = useState('');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  // Expanded connection info state
  const [expandedService, setExpandedService] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

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

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreating(true);

    try {
      if (createMode === 'template' && selectedTemplate) {
        await createService({
          name,
          template: selectedTemplate.id,
        });
      } else {
        await createService({
          name,
          image,
          port: port ? parseInt(port, 10) : undefined,
          env_vars: envVars.filter((v) => v.key.trim() !== ''),
        });
      }

      // Reset form
      setShowCreate(false);
      setName('');
      setImage('');
      setPort('');
      setEnvVars([]);
      setSelectedTemplate(null);

      await fetchServices();
    } catch (err: any) {
      setCreateError(err.message || 'Failed to create service');
    } finally {
      setCreating(false);
    }
  };

  const handleAction = async (id: string, action: 'start' | 'stop' | 'remove') => {
    if (action === 'remove' && !window.confirm('Are you sure you want to remove this service?')) {
      return;
    }

    setActionLoading((prev) => ({ ...prev, [`${id}-${action}`]: true }));
    try {
      if (action === 'start') await startService(id);
      else if (action === 'stop') await stopService(id);
      else if (action === 'remove') await removeService(id);

      await fetchServices();
    } catch (err) {
      console.error(`Failed to ${action} service:`, err);
      alert(`Failed to ${action} service`);
    } finally {
      setActionLoading((prev) => ({ ...prev, [`${id}-${action}`]: false }));
    }
  };

  const handleCopy = async (text: string, fieldId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldId);
      setTimeout(() => setCopiedField(null), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const addEnvVar = () => {
    setEnvVars([...envVars, { key: '', value: '' }]);
  };

  const updateEnvVar = (index: number, field: 'key' | 'value', val: string) => {
    const newVars = [...envVars];
    newVars[index][field] = val;
    setEnvVars(newVars);
  };

  const removeEnvVar = (index: number) => {
    setEnvVars(envVars.filter((_, i) => i !== index));
  };

  const openTemplate = (tmpl: ServiceTemplate) => {
    setCreateMode('template');
    setSelectedTemplate(tmpl);
    setName(`${tmpl.id}-${Math.random().toString(36).substring(2, 6)}`);
    setShowCreate(true);
  };

  const openCustom = () => {
    setCreateMode('custom');
    setSelectedTemplate(null);
    setName('');
    setImage('');
    setPort('');
    setEnvVars([]);
    setShowCreate(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-secondary-ol" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-bold text-primary-ol flex items-center gap-2">
            <Database className="h-6 w-6" />
            {t('services.title')}
          </h1>
          <p className="text-sm text-secondary-ol mt-1">{t('services.subtitle')}</p>
        </div>
        {!showCreate && (
          <Button onClick={openCustom} className="gap-2">
            <Plus className="h-4 w-4" />
            {t('services.createService')}
          </Button>
        )}
      </div>

      {/* Create Section */}
      {showCreate && (
        <div className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-display font-semibold text-primary-ol">
              {t('services.createService')}
            </h2>
            <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>
              {t('common.cancel')}
            </Button>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium text-primary-ol mb-3">
                {t('services.templates')}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {templates.map((tmpl) => (
                  <button
                    key={tmpl.id}
                    onClick={() => openTemplate(tmpl)}
                    className={cn(
                      'flex flex-col items-center justify-center p-4 rounded-lg border transition-all',
                      createMode === 'template' && selectedTemplate?.id === tmpl.id
                        ? 'border-primary-ol bg-primary-ol/5'
                        : 'border-[hsl(var(--border))] hover:border-primary-ol/50 hover:bg-bg-subtle',
                    )}
                  >
                    <Database className="h-6 w-6 mb-2 text-secondary-ol" />
                    <span className="text-sm font-medium text-primary-ol">{tmpl.name}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="relative py-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-[hsl(var(--border))]" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-bg-panel px-2 text-secondary-ol">{t('services.orCustom')}</span>
              </div>
            </div>

            <form onSubmit={handleCreate} className="space-y-4">
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-primary-ol mb-1">
                    {t('services.name')}
                  </label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t('services.namePlaceholder')}
                    required
                    className="max-w-md"
                  />
                </div>

                {createMode === 'custom' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                      <div>
                        <label className="block text-sm font-medium text-primary-ol mb-1">
                          {t('services.image')}
                        </label>
                        <Input
                          value={image}
                          onChange={(e) => setImage(e.target.value)}
                          placeholder={t('services.imagePlaceholder')}
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-primary-ol mb-1">
                          {t('services.port')}
                        </label>
                        <Input
                          value={port}
                          onChange={(e) => setPort(e.target.value)}
                          placeholder={t('services.portPlaceholder')}
                          type="number"
                        />
                      </div>
                    </div>

                    <div>
                      <div className="flex items-center justify-between max-w-2xl mb-2">
                        <label className="block text-sm font-medium text-primary-ol">
                          {t('services.envVars')}
                        </label>
                        <Button type="button" variant="outline" size="sm" onClick={addEnvVar}>
                          <Plus className="h-3 w-3 mr-1" />
                          {t('services.addEnvVar')}
                        </Button>
                      </div>
                      <div className="space-y-2 max-w-2xl">
                        {envVars.map((env, i) => (
                          <div key={i} className="flex gap-2">
                            <Input
                              value={env.key}
                              onChange={(e) => updateEnvVar(i, 'key', e.target.value)}
                              placeholder={t('services.keyPlaceholder')}
                              className="flex-1"
                            />
                            <Input
                              value={env.value}
                              onChange={(e) => updateEnvVar(i, 'value', e.target.value)}
                              placeholder={t('services.valuePlaceholder')}
                              className="flex-1"
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeEnvVar(i)}
                            >
                              <Trash2 className="h-4 w-4 text-error" />
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              {createError && (
                <div className="text-sm text-error bg-error/10 p-3 rounded-md">{createError}</div>
              )}

              <div className="pt-4">
                <Button
                  type="submit"
                  disabled={creating || !name || (createMode === 'custom' && !image)}
                >
                  {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  {creating ? t('services.creating') : t('services.createService')}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Services List */}
      <div className="space-y-4">
        {services.length === 0 && !showCreate ? (
          <div className="text-center py-12 border border-dashed border-[hsl(var(--border))] rounded-xl bg-bg-panel/50">
            <Database className="h-12 w-12 mx-auto text-secondary-ol/50 mb-3" />
            <h3 className="text-lg font-medium text-primary-ol">{t('services.noServices')}</h3>
            <p className="text-sm text-secondary-ol mt-1 mb-4">{t('services.getStarted')}</p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              {t('services.createService')}
            </Button>
          </div>
        ) : (
          services.map((service) => {
            const isRunning = service.status === 'running';
            const isError = service.status === 'error';
            const isExpanded = expandedService === service.id;

            let creds = null;
            try {
              if (service.credentials) creds = JSON.parse(service.credentials);
            } catch (e) {}

            let parsedEnv = null;
            try {
              if (service.env_vars) parsedEnv = JSON.parse(service.env_vars);
            } catch (e) {}

            const hasDetails = creds || (parsedEnv && Object.keys(parsedEnv).length > 0);

            return (
              <div
                key={service.id}
                className="rounded-xl border border-[hsl(var(--border))] bg-bg-panel overflow-hidden"
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
                    {hasDetails && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedService(isExpanded ? null : service.id)}
                        className="text-xs"
                      >
                        {t('services.connectionInfo')}
                        {isExpanded ? (
                          <ChevronUp className="h-3 w-3 ml-1" />
                        ) : (
                          <ChevronDown className="h-3 w-3 ml-1" />
                        )}
                      </Button>
                    )}

                    {isRunning ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleAction(service.id, 'stop')}
                        disabled={actionLoading[`${service.id}-stop`]}
                      >
                        {actionLoading[`${service.id}-stop`] ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Square className="h-3 w-3 mr-1" />
                        )}
                        {t('services.stop')}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleAction(service.id, 'start')}
                        disabled={actionLoading[`${service.id}-start`]}
                      >
                        {actionLoading[`${service.id}-start`] ? (
                          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                        ) : (
                          <Play className="h-3 w-3 mr-1" />
                        )}
                        {t('services.start')}
                      </Button>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleAction(service.id, 'remove')}
                      disabled={actionLoading[`${service.id}-remove`]}
                      className="text-error hover:text-error hover:bg-error/10"
                    >
                      {actionLoading[`${service.id}-remove`] ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {isExpanded && hasDetails && (
                  <div className="border-t border-[hsl(var(--border))] bg-bg-subtle p-4 text-sm">
                    {creds && (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
                        {Object.entries(creds).map(([key, value]) => {
                          const displayKey =
                            key === 'connectionString'
                              ? t('services.connectionString')
                              : key === 'host'
                                ? t('services.host')
                                : key === 'port'
                                  ? t('services.portLabel')
                                  : key === 'user'
                                    ? t('services.user')
                                    : key === 'password'
                                      ? t('services.password')
                                      : key === 'database'
                                        ? t('services.database')
                                        : key;

                          const fieldId = `${service.id}-${key}`;

                          return (
                            <div
                              key={key}
                              className={cn(
                                'flex flex-col',
                                key === 'connectionString' && 'md:col-span-2',
                              )}
                            >
                              <span className="text-xs text-secondary-ol mb-1">{displayKey}</span>
                              <div className="flex items-center gap-2">
                                <code className="flex-1 bg-bg-panel px-2 py-1 rounded border border-[hsl(var(--border))] font-mono text-xs truncate">
                                  {String(value)}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() => handleCopy(String(value), fieldId)}
                                >
                                  {copiedField === fieldId ? (
                                    <Check className="h-3 w-3 text-success" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {!creds && parsedEnv && Object.keys(parsedEnv).length > 0 && (
                      <div className="space-y-2">
                        <span className="text-xs text-secondary-ol">{t('services.envVars')}</span>
                        <div className="grid grid-cols-1 gap-2">
                          {Object.entries(parsedEnv).map(([key, value]) => {
                            const fieldId = `${service.id}-env-${key}`;
                            return (
                              <div key={key} className="flex items-center gap-2">
                                <code className="bg-bg-panel px-2 py-1 rounded border border-[hsl(var(--border))] font-mono text-xs text-primary-ol w-1/3 truncate">
                                  {key}
                                </code>
                                <code className="flex-1 bg-bg-panel px-2 py-1 rounded border border-[hsl(var(--border))] font-mono text-xs truncate">
                                  {String(value)}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-6 w-6 shrink-0"
                                  onClick={() => handleCopy(String(value), fieldId)}
                                >
                                  {copiedField === fieldId ? (
                                    <Check className="h-3 w-3 text-success" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
