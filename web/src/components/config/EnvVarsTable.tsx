import { useState, useEffect, useCallback } from 'react';
import { useLanguage } from '@/i18n/context';
import { getProjectEnv, updateProjectEnv } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Eye, EyeOff, Plus, Trash2, ClipboardPaste, Save, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EnvVarsTableProps {
  projectId: string;
}

interface EnvVar {
  key: string;
  value: string;
  revealed: boolean;
}

export function EnvVarsTable({ projectId }: EnvVarsTableProps) {
  const { t } = useLanguage();
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [pasteMode, setPasteMode] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // Fetch env vars
  const fetchEnv = useCallback(async () => {
    try {
      const data = await getProjectEnv(projectId);
      setVars(
        Object.entries(data).map(([key, value]) => ({
          key,
          value,
          revealed: false,
        })),
      );
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchEnv();
  }, [fetchEnv]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const envMap: Record<string, string> = {};
      for (const v of vars) {
        if (v.key.trim()) {
          envMap[v.key.trim()] = v.value;
        }
      }
      await updateProjectEnv(projectId, envMap);
      setDirty(false);
    } catch (err) {
      console.error('Failed to save env vars:', err);
    } finally {
      setSaving(false);
    }
  };

  const addVar = () => {
    setVars((prev) => [...prev, { key: '', value: '', revealed: true }]);
    setDirty(true);
  };

  const removeVar = (index: number) => {
    setVars((prev) => prev.filter((_, i) => i !== index));
    setDirty(true);
  };

  const updateVar = (index: number, field: 'key' | 'value', val: string) => {
    setVars((prev) => prev.map((v, i) => (i === index ? { ...v, [field]: val } : v)));
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
        parsed.push({ key, value, revealed: false });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-agent" />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-body text-muted-ol">
          {vars.length} {vars.length !== 1 ? 'variables' : 'variable'}
        </p>
        <div className="flex items-center gap-2">
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

      {/* Env vars table */}
      {vars.length === 0 ? (
        <div className="text-center py-8">
          <p className="text-sm font-body text-secondary-ol">{t('envVars.noEnvVars')}</p>
          <p className="text-xs font-body text-muted-ol mt-1">{t('envVars.getStarted')}</p>
        </div>
      ) : (
        <div className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-[1fr_1fr_36px_36px] gap-2 px-2 pb-1 text-[10px] font-mono text-muted-ol uppercase tracking-wider">
            <span>{'Key'}</span>
            <span>{'Value'}</span>
            <span />
            <span />
          </div>
          {/* Rows */}
          {vars.map((v, index) => (
            <div
              key={index}
              className="grid grid-cols-[1fr_1fr_36px_36px] gap-2 items-center group"
            >
              <input
                type="text"
                value={v.key}
                onChange={(e) => updateVar(index, 'key', e.target.value)}
                placeholder={'KEY'}
                className={cn(
                  'px-2 py-1.5 rounded-md text-xs font-mono',
                  'bg-bg-app border border-border text-primary-ol',
                  'placeholder:text-muted-ol',
                  'focus:outline-none focus:ring-1 focus:ring-agent/40',
                )}
              />
              <input
                type={v.revealed ? 'text' : 'password'}
                value={v.value}
                onChange={(e) => updateVar(index, 'value', e.target.value)}
                placeholder={'value'}
                className={cn(
                  'px-2 py-1.5 rounded-md text-xs font-mono',
                  'bg-bg-app border border-border text-primary-ol',
                  'placeholder:text-muted-ol',
                  'focus:outline-none focus:ring-1 focus:ring-agent/40',
                )}
              />
              <button
                onClick={() => toggleReveal(index)}
                className="p-1.5 rounded text-muted-ol hover:text-secondary-ol transition-colors"
              >
                {v.revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => removeVar(index)}
                className="p-1.5 rounded text-muted-ol hover:text-error transition-colors opacity-0 group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
