import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import { createService, type ServiceTemplate } from '@/lib/api';
import { useLanguage } from '@/i18n/context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { Database, Plus, Trash2, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

interface CreateServiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  templates: ServiceTemplate[];
  onSuccess: () => void;
  initialMode?: 'template' | 'custom';
}

export function CreateServiceDialog({
  open,
  onOpenChange,
  templates,
  onSuccess,
  initialMode = 'template',
}: CreateServiceDialogProps) {
  const [createMode, setCreateMode] = useState<'template' | 'custom'>(initialMode);
  const [selectedTemplate, setSelectedTemplate] = useState<ServiceTemplate | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string>('');
  const [name, setName] = useState('');
  const [image, setImage] = useState('');
  const [port, setPort] = useState('');
  const [envVars, setEnvVars] = useState<Array<{ key: string; value: string }>>([]);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const { t } = useLanguage();

  useEffect(() => {
    if (open) {
      setCreateMode(initialMode);
      setSelectedTemplate(null);
      setSelectedVersion('');
      setName('');
      setImage('');
      setPort('');
      setEnvVars([]);
      setCreateError('');
    }
  }, [open, initialMode]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreateError('');
    setCreating(true);

    try {
      if (createMode === 'template' && selectedTemplate) {
        await createService({
          name,
          template: selectedTemplate.id,
          version: selectedVersion || undefined,
        });
      } else {
        await createService({
          name,
          image,
          port: port ? parseInt(port, 10) : undefined,
          env_vars: envVars.filter((v) => v.key.trim() !== ''),
        });
      }

      toast.success(t('services.create.toasts.success'));
      onSuccess();
      onOpenChange(false);
    } catch (err: unknown) {
      const message = getErrorMessage(err, t('services.create.toasts.errorFallback'));
      setCreateError(message);
      toast.error(message);
    } finally {
      setCreating(false);
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
    if (createMode === 'template' && selectedTemplate?.id === tmpl.id) {
      setCreateMode('custom');
      setSelectedTemplate(null);
      setSelectedVersion('');
      setName('');
      return;
    }
    setCreateMode('template');
    setSelectedTemplate(tmpl);
    if (tmpl.versions && tmpl.versions.length > 0) {
      setSelectedVersion(tmpl.versions[0]);
    } else {
      setSelectedVersion('');
    }
    setName(`${tmpl.id}-${Math.random().toString(36).substring(2, 6)}`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{'Create resource'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 mt-4">
          <div>
            <h3 className="text-sm font-medium text-foreground mb-3">Templates</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {templates.map((tmpl) => (
                <button
                  key={tmpl.id}
                  onClick={() => openTemplate(tmpl)}
                  className={cn(
                    'flex flex-col items-center justify-center p-4 rounded-lg border transition-all',
                    createMode === 'template' && selectedTemplate?.id === tmpl.id
                      ? 'border-foreground bg-foreground/5'
                      : 'border-[hsl(var(--border))] hover:border-foreground/50 hover:bg-bg-subtle',
                  )}
                >
                  <Database className="h-6 w-6 mb-2 text-foreground/80" />
                  <span className="text-sm font-medium text-foreground">{tmpl.name}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="relative py-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-[hsl(var(--border))]" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-bg-panel px-2 text-foreground/80">or Custom</span>
            </div>
          </div>

          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {'Resource name'}
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={'my-database'}
                  required
                  className="max-w-md"
                />
              </div>

              {createMode === 'template' &&
                selectedTemplate &&
                selectedTemplate.versions &&
                selectedTemplate.versions.length > 0 && (
                  <div>
                    <label className="block text-sm font-medium text-foreground mb-1">
                      {'Version'}
                    </label>
                    <div className="max-w-md">
                      <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a version" />
                        </SelectTrigger>
                        <SelectContent>
                          {selectedTemplate.versions.map((v) => (
                            <SelectItem key={v} value={v}>
                              {v}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

              {createMode === 'custom' && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-2xl">
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">
                        {'Docker Image'}
                      </label>
                      <Input
                        value={image}
                        onChange={(e) => setImage(e.target.value)}
                        placeholder="postgres:15"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-foreground mb-1">
                        {'Port'}
                      </label>
                      <Input
                        value={port}
                        onChange={(e) => setPort(e.target.value)}
                        placeholder={'4000'}
                        type="number"
                      />
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between max-w-2xl mb-2">
                      <label className="block text-sm font-medium text-foreground">
                        {'Environment Variables'}
                      </label>
                      <Button type="button" variant="outline" size="sm" onClick={addEnvVar}>
                        <Plus className="h-3 w-3 mr-1" />
                        {'Add Variable'}
                      </Button>
                    </div>
                    <div className="space-y-2 max-w-2xl">
                      {envVars.map((env, i) => (
                        <div key={i} className="flex gap-2">
                          <Input
                            value={env.key}
                            onChange={(e) => updateEnvVar(i, 'key', e.target.value)}
                            placeholder={'KEY'}
                            className="flex-1"
                          />
                          <Input
                            value={env.value}
                            onChange={(e) => updateEnvVar(i, 'value', e.target.value)}
                            placeholder={'value'}
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

            <div className="pt-4 flex justify-end gap-2">
              <Button variant="ghost" type="button" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={creating || !name || (createMode === 'custom' && !image)}
              >
                {creating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                {creating ? 'Creating...' : 'Create resource'}
              </Button>
            </div>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
