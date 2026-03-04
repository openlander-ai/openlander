import { useState } from 'react';
import { useSetup } from '@/hooks/use-setup';
import { useSystemStats } from '@/hooks/use-system-stats';
import { configureLLM } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  Brain,
  Github,
  Cpu,
  MemoryStick,
  HardDrive,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Save,
} from 'lucide-react';

export function SettingsPage() {
  const { status, loading, refetch } = useSetup();
  const { stats } = useSystemStats();

  const [llmProvider, setLlmProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [llmError, setLlmError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleUpdateLLM = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setLlmError('');
    try {
      await configureLLM(llmProvider, apiKey);
      await refetch();
      setApiKey('');
    } catch {
      setLlmError('Failed to update LLM configuration.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-agent" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="font-display text-2xl font-bold text-primary-ol tracking-tight">Settings</h1>
        <p className="text-sm font-body text-secondary-ol mt-1">
          Manage your AI provider, connections, and system configuration.
        </p>
      </div>

      {/* AI Model */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-agent" />
          <h2 className="font-display text-lg font-semibold text-primary-ol">AI Model</h2>
        </div>

        {status?.llm.ok && (
          <div className="rounded-lg border border-success/20 bg-success/5 p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-success shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-body text-primary-ol">
                Connected to <strong>{status.llm.provider}</strong>
              </p>
              <p className="text-xs font-body text-muted-ol mt-0.5">Model: {status.llm.model}</p>
            </div>
            <Badge variant="outline" className="text-success border-success/30">
              Active
            </Badge>
          </div>
        )}

        <form onSubmit={handleUpdateLLM} className="space-y-3">
          <p className="text-xs font-body text-secondary-ol">
            {status?.llm.ok ? 'Switch to a different provider:' : 'Configure an AI provider:'}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'gemini', label: 'Google Gemini', badge: 'Free' },
              { value: 'openrouter', label: 'OpenRouter', badge: 'Free/Paid' },
              { value: 'anthropic', label: 'Anthropic Claude', badge: '' },
              { value: 'openai', label: 'OpenAI', badge: '' },
              { value: 'ollama', label: 'Ollama (Local)', badge: 'No Key' },
            ].map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setLlmProvider(p.value)}
                className={cn(
                  'text-left px-3 py-2.5 rounded-lg border text-sm font-body transition-all',
                  llmProvider === p.value
                    ? 'border-agent/50 bg-agent/10 text-primary-ol'
                    : 'border-border bg-bg-subtle/30 text-secondary-ol hover:border-border hover:bg-bg-subtle/50',
                )}
              >
                <span className="flex items-center justify-between">
                  {p.label}
                  {p.badge && (
                    <Badge variant="outline" className="text-[10px] ml-1 py-0">
                      {p.badge}
                    </Badge>
                  )}
                </span>
              </button>
            ))}
          </div>

          {llmProvider && llmProvider !== 'ollama' && (
            <Input
              type="password"
              placeholder="API Key"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="font-mono text-sm bg-bg-app border-border"
            />
          )}

          {llmError && <p className="text-xs font-body text-error">{llmError}</p>}

          {llmProvider && (
            <Button
              type="submit"
              disabled={saving || (llmProvider !== 'ollama' && !apiKey.trim())}
              size="sm"
              className="gap-1.5 bg-agent text-bg-app hover:bg-agent/90 font-body"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Update Provider
            </Button>
          )}
        </form>
      </section>

      {/* GitHub */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Github className="h-4 w-4 text-secondary-ol" />
          <h2 className="font-display text-lg font-semibold text-primary-ol">GitHub Connection</h2>
        </div>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-3">
          <p className="text-sm font-body text-secondary-ol">
            Connect your GitHub account to deploy private repositories.
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-xs font-body"
              onClick={() => window.open('/api/auth/github', '_blank')}
            >
              <Github className="h-3.5 w-3.5" />
              Connect GitHub
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-xs font-body text-muted-ol"
              onClick={refetch}
            >
              <RefreshCw className="h-3 w-3" />
              Refresh
            </Button>
          </div>
        </div>
      </section>

      {/* System Stats */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-secondary-ol" />
          <h2 className="font-display text-lg font-semibold text-primary-ol">System Resources</h2>
        </div>

        {stats ? (
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              icon={<Cpu className="h-4 w-4" />}
              label="CPU"
              value={`${typeof stats.cpu === 'number' ? stats.cpu.toFixed(0) : (stats.cpu?.usagePercent?.toFixed(0) ?? '—')}%`}
              color="text-agent"
            />
            <StatCard
              icon={<MemoryStick className="h-4 w-4" />}
              label="Memory"
              value={formatMemory(stats.memory)}
              color="text-warning"
            />
            <StatCard
              icon={<HardDrive className="h-4 w-4" />}
              label="Disk"
              value={formatDisk(stats.disk)}
              color="text-success"
            />
          </div>
        ) : (
          <p className="text-sm font-body text-muted-ol">Loading system stats...</p>
        )}
      </section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-2">
      <div className={cn('flex items-center gap-2 text-muted-ol', color)}>
        {icon}
        <span className="text-xs font-body uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-2xl font-mono font-bold text-primary-ol">{value}</p>
    </div>
  );
}

function formatMemory(
  mem: number | { usedMB?: number; totalMB?: number; usagePercent?: number },
): string {
  if (typeof mem === 'number') return `${(mem / (1024 * 1024 * 1024)).toFixed(1)}G`;
  if (mem?.usagePercent != null) return `${mem.usagePercent.toFixed(0)}%`;
  if (mem?.usedMB != null) return `${(mem.usedMB / 1024).toFixed(1)}G`;
  return '—';
}

function formatDisk(disk: unknown): string {
  if (!disk || typeof disk !== 'object') return '—';
  const d = disk as { usagePercent?: number; usedGB?: number };
  if (d.usagePercent != null) return `${d.usagePercent.toFixed(0)}%`;
  if (d.usedGB != null) return `${d.usedGB.toFixed(0)}G`;
  return '—';
}
