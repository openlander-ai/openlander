import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getProjectEnv,
  updateProjectEnv,
  getEnvironments,
  getEnvironmentEnvVars,
  updateEnvironmentEnvVars,
  generateEnvExample,
} from '@/lib/api';
import type { Environment } from '@/types';
import { cn } from '@/lib/utils';
import {
  Eye,
  EyeOff,
  Plus,
  Trash2,
  ClipboardPaste,
  Save,
  Loader2,
  FileText,
  Download,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EnvVarsTableProps {
  projectId: string;
}

interface EnvVar {
  key: string;
  value: string;
  revealed: boolean;
  source?: 'global' | 'project' | 'production' | 'environment';
  isOverride?: boolean;
}

export function EnvVarsTable({ projectId }: EnvVarsTableProps) {
  const { t } = useLanguage();
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [selectedEnvId, setSelectedEnvId] = useState<string>('');
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [envExampleMode, setEnvExampleMode] = useState(false);
  const [envExampleText, setEnvExampleText] = useState('');
  const [generatingExample, setGeneratingExample] = useState(false);

  const fetchEnvironments = useCallback(async () => {
    try {
      const envs = await getEnvironments(projectId);
      setEnvironments(envs);
    } catch (err) {
      console.error('Failed to fetch environments:', err);
    }
  }, [projectId]);

  const fetchEnv = useCallback(async () => {
    setLoading(true);
    try {
      if (!selectedEnvId) {
        const data = await getProjectEnv(projectId);
        setVars(
          Object.entries(data).map(([key, value]) => ({
            key,
            value,
            revealed: false,
            source: 'project',
          })),
        );
      } else {
        const data = await getEnvironmentEnvVars(projectId, selectedEnvId);
        setVars(
          Object.entries(data.envVars).map(([key, value]) => ({
            key,
            value,
            revealed: false,
            source: data.inheritance[key]?.source || 'environment',
            isOverride: data.inheritance[key]?.isOverride,
          })),
        );
      }
      setDirty(false);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedEnvId]);

  useEffect(() => {
    fetchEnvironments();
  }, [fetchEnvironments]);

  useEffect(() => {
    fetchEnv();
  }, [fetchEnv]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const envMap: Record<string, string> = {};
      for (const v of vars) {
        if (v.key.trim()) {
          if (!selectedEnvId || v.source === 'environment' || !v.source) {
            envMap[v.key.trim()] = v.value;
          }
        }
      }

      if (!selectedEnvId) {
        await updateProjectEnv(projectId, envMap);
      } else {
        await updateEnvironmentEnvVars(projectId, selectedEnvId, envMap);
      }

      setDirty(false);
      toast.success('Environment variables saved');
      fetchEnv();
    } catch (err) {
      console.error('Failed to save env vars:', err);
      toast.error('Failed to save environment variables');
    } finally {
      setSaving(false);
    }
  };

  const addVar = () => {
    setVars((prev) => [
      ...prev,
      { key: '', value: '', revealed: true, source: selectedEnvId ? 'environment' : 'project' },
    ]);
    setDirty(true);
  };

  const removeVar = (index: number) => {
    setVars((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const updateVar = (index: number, field: 'key' | 'value', val: string) => {
    setVars((prev) =>
      prev.map((v, i) => {
        if (i === index) {
          const newSource = selectedEnvId && v.source !== 'environment' ? 'environment' : v.source;
          return { ...v, [field]: val, source: newSource };
        }
        return v;
      }),
    );
    setDirty(true);
  };

  const toggleReveal = (index: number) => {
    setVars((prev) => prev.map((v, i) => (i === index ? { ...v, revealed: !v.revealed } : v)));
  };

  const handlePaste = () => {
    const lines = pasteText.split('\n');
    const parsed: EnvVar[] = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) {
        parsed.push({
          key,
          value,
          revealed: false,
          source: selectedEnvId ? 'environment' : 'project',
        });
      }
    }
    if (parsed.length > 0) {
      setVars((prev) => {
        // Merge: update existing keys, add new ones
        const existing = new Map(prev.map((v) => [v.key, v]));
        for (const p of parsed) {
          existing.set(p.key, p);
        }
        return Array.from(existing.values());
      });
      setDirty(true);
    }
    setPasteMode(false);
    setPasteText('');
  };

  const handleGenerateExample = async () => {
    setGeneratingExample(true);
    try {
      const envType = selectedEnvId
        ? environments.find((e) => e.id === selectedEnvId)?.type
        : undefined;
      const text = await generateEnvExample(projectId, envType);
      setEnvExampleText(text);
      setEnvExampleMode(true);
    } catch (err) {
      console.error('Failed to generate .env.example:', err);
      toast.error('Failed to generate .env.example');
    } finally {
      setGeneratingExample(false);
    }
  };

  const handleDownloadExample = () => {
    const blob = new Blob([envExampleText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '.env.example';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading && vars.length === 0) {
    return (
      <div className="space-y-4 p-4">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-24" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-7 w-24" />
            <Skeleton className="h-7 w-16" />
          </div>
        </div>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_1fr_36px_36px] gap-2 px-2 pb-1">
            <Skeleton className="h-3 w-12" />
            <Skeleton className="h-3 w-12" />
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_36px_36px] gap-2 items-center">
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-8 w-full rounded-md" />
              <Skeleton className="h-6 w-6 rounded" />
              <Skeleton className="h-6 w-6 rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <select
            value={selectedEnvId}
            onChange={(e) => setSelectedEnvId(e.target.value)}
            className="h-8 rounded-md border border-[hsl(var(--border))] bg-bg-panel px-2 text-xs font-body text-primary-ol capitalize"
          >
            <option value="">Project Defaults</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.type} ({env.branch})
              </option>
            ))}
          </select>
          <p className="text-xs font-body text-muted-ol">
            {vars.length} {vars.length !== 1 ? 'variables' : 'variable'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] font-body gap-1.5"
            onClick={handleGenerateExample}
            disabled={generatingExample}
          >
            {generatingExample ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <FileText className="h-3 w-3" />
            )}
            {'Generate .env.example'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] font-body gap-1.5"
            onClick={() => setPasteMode(!pasteMode)}
          >
            <ClipboardPaste className="h-3 w-3" />
            {'Paste .env'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[11px] font-body gap-1.5"
            onClick={addVar}
          >
            <Plus className="h-3 w-3" />
            {'Add'}
          </Button>
          {dirty && (
            <Button
              size="sm"
              className="h-7 text-[11px] font-body gap-1.5 bg-agent text-bg-app hover:bg-agent/90"
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              {'Save'}
            </Button>
          )}
        </div>
      </div>

      {/* Paste .env modal */}
      {pasteMode && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle p-3 space-y-2">
          <p className="text-[11px] font-body text-secondary-ol">{t('envVars.pasteDescription')}</p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'DATABASE_URL=postgresql://...\nAPI_KEY=sk-...\n# Comments are ignored'}
            rows={6}
            className={cn(
              'w-full rounded-md px-3 py-2 text-xs font-mono',
              'bg-bg-app border border-border text-primary-ol',
              'placeholder:text-muted-ol resize-none',
              'focus:outline-none focus:ring-1 focus:ring-agent/40',
            )}
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => {
                setPasteMode(false);
                setPasteText('');
              }}
            >
              {'Cancel'}
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px] bg-agent text-bg-app hover:bg-agent/90"
              onClick={handlePaste}
              disabled={!pasteText.trim()}
            >
              {'Parse & Import'}
            </Button>
          </div>
        </div>
      )}

      {/* Generate .env.example modal */}
      {envExampleMode && (
        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-body text-secondary-ol">
              Generated .env.example based on your repository and current environment variables.
            </p>
          </div>
          <textarea
            value={envExampleText}
            readOnly
            rows={8}
            className={cn(
              'w-full rounded-md px-3 py-2 text-xs font-mono',
              'bg-bg-app border border-border text-primary-ol',
              'resize-none focus:outline-none',
            )}
          />
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-[11px]"
              onClick={() => {
                setEnvExampleMode(false);
                setEnvExampleText('');
              }}
            >
              {'Close'}
            </Button>
            <Button
              size="sm"
              className="h-7 text-[11px] bg-agent text-bg-app hover:bg-agent/90 gap-1.5"
              onClick={handleDownloadExample}
            >
              <Download className="h-3 w-3" />
              {'Download'}
            </Button>
          </div>
        </div>
      )}

      {/* Env vars table */}
      {vars.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm font-body text-secondary-ol">{t('envVars.noEnvVars')}</p>
          <p className="text-xs font-body text-muted-ol mt-1">{t('envVars.getStarted')}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-[1fr_1fr_140px_36px_36px] gap-2 px-2 pb-1 text-[10px] font-mono text-muted-ol uppercase tracking-wider">
            <span>{'Key'}</span>
            <span>{'Value'}</span>
            <span>{'Source'}</span>
            <span />
            <span />
          </div>
          {/* Rows */}
          {vars.map((v, index) => {
            const isInherited = selectedEnvId && v.source !== 'environment';
            return (
              <div
                key={index}
                className="grid grid-cols-[1fr_1fr_140px_36px_36px] gap-2 items-center group"
              >
                <input
                  type="text"
                  value={v.key}
                  onChange={(e) => updateVar(index, 'key', e.target.value)}
                  placeholder={'KEY'}
                  readOnly={!!isInherited}
                  className={cn(
                    'px-2 py-1.5 rounded-md text-xs font-mono',
                    'bg-bg-app border border-border text-primary-ol',
                    'placeholder:text-muted-ol',
                    'focus:outline-none focus:ring-1 focus:ring-agent/40',
                    isInherited && 'text-muted-ol bg-bg-subtle cursor-not-allowed',
                  )}
                />
                <input
                  type={v.revealed ? 'text' : 'password'}
                  value={v.value}
                  onChange={(e) => updateVar(index, 'value', e.target.value)}
                  placeholder={'value'}
                  readOnly={!!isInherited}
                  className={cn(
                    'px-2 py-1.5 rounded-md text-xs font-mono',
                    'bg-bg-app border border-border text-primary-ol',
                    'placeholder:text-muted-ol',
                    'focus:outline-none focus:ring-1 focus:ring-agent/40',
                    isInherited && 'text-muted-ol bg-bg-subtle cursor-not-allowed',
                  )}
                />
                <div className="flex items-center">
                  {selectedEnvId && (
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.5 rounded font-body whitespace-nowrap',
                        v.source === 'global' && 'bg-purple-500/10 text-purple-500',
                        v.source === 'project' && 'bg-blue-500/10 text-blue-500',
                        v.source === 'production' && 'bg-orange-500/10 text-orange-500',
                        v.source === 'environment' &&
                          !v.isOverride &&
                          'bg-green-500/10 text-green-500 capitalize',
                        v.source === 'environment' &&
                          v.isOverride &&
                          'bg-yellow-500/10 text-yellow-500',
                      )}
                    >
                      {v.source === 'environment' && v.isOverride
                        ? 'Override'
                        : v.source === 'production'
                          ? 'Inherited from Production'
                          : v.source === 'project'
                            ? 'Inherited from Project'
                            : v.source === 'global'
                              ? 'Inherited from Global'
                              : v.source}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => toggleReveal(index)}
                  className="p-1.5 rounded text-muted-ol hover:text-secondary-ol transition-colors"
                >
                  {v.revealed ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
                {isInherited ? (
                  <button
                    onClick={() => {
                      setVars((prev) =>
                        prev.map((item, i) =>
                          i === index ? { ...item, source: 'environment', isOverride: true } : item,
                        ),
                      );
                      setDirty(true);
                    }}
                    className="p-1.5 rounded text-muted-ol hover:text-agent transition-colors opacity-0 group-hover:opacity-100"
                    title="Override this variable"
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={() => removeVar(index)}
                    className="p-1.5 rounded text-muted-ol hover:text-error transition-colors opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
