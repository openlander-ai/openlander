import { useState, useEffect, useCallback } from 'react';
import { useSetup } from '@/hooks/use-setup';
import { useSystemStats } from '@/hooks/use-system-stats';
import {
  configureLLM,
  getGlobalSecrets,
  setGlobalSecret,
  deleteGlobalSecret,
  getOAuthStatus,
  disconnectOAuth,
  connectGithub,
  disconnectGithub,
  startGithubDeviceFlow,
  pollGithubDeviceFlow,
  type GlobalSecret,
  type OAuthStatus,
} from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { OAuthButton } from '@/components/setup/OAuthButton';
import { ProviderHelp } from '@/components/setup/ProviderHelp';
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
  Shield,
  Trash2,
  Plus,
  ExternalLink,
  Copy,
  Check,
} from 'lucide-react';

export function SettingsPage() {
  const { status, loading, refetch } = useSetup();
  const { stats } = useSystemStats();

  const [llmProvider, setLlmProvider] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [llmError, setLlmError] = useState('');
  const [saving, setSaving] = useState(false);
  const [secrets, setSecrets] = useState<GlobalSecret[]>([]);
  const [secretKey, setSecretKey] = useState('');
  const [secretValue, setSecretValue] = useState('');
  const [secretDesc, setSecretDesc] = useState('');
  const [secretSaving, setSecretSaving] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus | null>(null);
  const [githubToken, setGithubToken] = useState('');
  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubDisconnecting, setGithubDisconnecting] = useState(false);
  const [githubError, setGithubError] = useState('');
  // Device Flow state
  const [deviceFlow, setDeviceFlow] = useState<{
    userCode: string;
    verificationUri: string;
    deviceCode: string;
    interval: number;
  } | null>(null);
  const [deviceFlowPolling, setDeviceFlowPolling] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  const fetchOAuthStatus = useCallback(async () => {
    try {
      const data = await getOAuthStatus();
      setOauthStatus(data);
    } catch {
      /* ignore */
    }
  }, []);
  const fetchSecrets = useCallback(async () => {
    try {
      const data = await getGlobalSecrets();
      setSecrets(data.secrets);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchSecrets();
    fetchOAuthStatus();
  }, [fetchSecrets, fetchOAuthStatus]);

  const handleAddSecret = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secretKey.trim() || !secretValue.trim()) return;
    setSecretSaving(true);
    try {
      await setGlobalSecret(secretKey.trim(), secretValue, secretDesc.trim() || undefined);
      setSecretKey('');
      setSecretValue('');
      setSecretDesc('');
      await fetchSecrets();
    } catch {
      /* ignore */
    } finally {
      setSecretSaving(false);
    }
  };

  const handleDeleteSecret = async (key: string) => {
    try {
      await deleteGlobalSecret(key);
      await fetchSecrets();
    } catch {
      /* ignore */
    }
  };

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

  const handleConnectGithub = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!githubToken.trim()) return;
    setGithubConnecting(true);
    setGithubError('');
    try {
      await connectGithub(githubToken.trim());
      await refetch();
      setGithubToken('');
    } catch (err: any) {
      setGithubError(err.message || 'Failed to connect GitHub');
    } finally {
      setGithubConnecting(false);
    }
  };

  const handleDisconnectGithub = async () => {
    setGithubDisconnecting(true);
    setGithubError('');
    try {
      await disconnectGithub();
      await refetch();
    } catch (err: any) {
      setGithubError(err.message || 'Failed to disconnect GitHub');
    } finally {
      setGithubDisconnecting(false);
    }
  };

  // Device Flow handlers
  const handleStartDeviceFlow = async () => {
    setGithubError('');
    try {
      const response = await startGithubDeviceFlow();
      setDeviceFlow({
        userCode: response.user_code,
        verificationUri: response.verification_uri,
        deviceCode: response.device_code,
        interval: response.interval,
      });
      setDeviceFlowPolling(true);
    } catch {
      setGithubError('Failed to start GitHub authorization');
    }
  };

  const handleCopyCode = async () => {
    if (deviceFlow?.userCode) {
      await navigator.clipboard.writeText(deviceFlow.userCode);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    }
  };

  const handleCancelDeviceFlow = () => {
    setDeviceFlow(null);
    setDeviceFlowPolling(false);
    setGithubError('');
  };

  // Polling effect for Device Flow
  useEffect(() => {
    if (!deviceFlowPolling || !deviceFlow) return;

    const pollInterval = setInterval(async () => {
      try {
        const result = await pollGithubDeviceFlow(deviceFlow.deviceCode, deviceFlow.interval);

        if (result.status === 'complete') {
          clearInterval(pollInterval);
          setDeviceFlow(null);
          setDeviceFlowPolling(false);
          await refetch();
        } else if (result.status === 'slow_down') {
          setDeviceFlow((prev) =>
            prev ? { ...prev, interval: result.interval ?? prev.interval } : null,
          );
        } else if (
          result.status === 'expired' ||
          result.status === 'denied' ||
          result.status === 'error'
        ) {
          clearInterval(pollInterval);
          setDeviceFlow(null);
          setDeviceFlowPolling(false);
          setGithubError(result.message || `Authorization ${result.status}`);
        }
      } catch {
        // Silently continue polling on network errors
      }
    }, deviceFlow.interval * 1000);

    return () => clearInterval(pollInterval);
  }, [deviceFlowPolling, deviceFlow, refetch]);

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

          {llmProvider === 'anthropic' && <ProviderHelp provider="anthropic" />}
          {llmProvider === 'gemini' && <ProviderHelp provider="gemini" />}

          {(llmProvider === 'openai' || llmProvider === 'openrouter') && (
            <div className="space-y-3">
              {oauthStatus?.providers[llmProvider]?.connected ? (
                <div className="flex items-center justify-between p-3 rounded-lg border border-success/20 bg-success/5">
                  <div className="flex items-center gap-2 text-success">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="text-sm font-medium">Connected via OAuth</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="text-xs text-error hover:text-error hover:bg-error/10"
                    onClick={async () => {
                      try {
                        await disconnectOAuth(llmProvider);
                        await fetchOAuthStatus();
                        await refetch();
                      } catch (err) {
                        console.error(err);
                      }
                    }}
                  >
                    Disconnect
                  </Button>
                </div>
              ) : (
                <>
                  <OAuthButton
                    provider={llmProvider}
                    onSuccess={async () => {
                      await configureLLM(llmProvider, 'oauth');
                      await fetchOAuthStatus();
                      await refetch();
                    }}
                  />
                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t border-border" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-bg-app px-2 text-muted-ol font-body">Or use API Key</span>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}

          {llmProvider &&
            llmProvider !== 'ollama' &&
            !(
              (llmProvider === 'openai' || llmProvider === 'openrouter') &&
              oauthStatus?.providers[llmProvider]?.connected
            ) && (
              <Input
                type="password"
                placeholder="API Key"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                required={llmProvider !== 'openai' && llmProvider !== 'openrouter'}
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

      {/* Global Secrets */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-agent" />
          <h2 className="font-display text-lg font-semibold text-primary-ol">Global Secrets</h2>
        </div>
        <p className="text-xs font-body text-secondary-ol">
          Encrypted secrets shared across all projects. Project-specific env vars override these.
        </p>

        <div className="rounded-lg border border-[hsl(var(--border))] bg-bg-subtle/30 p-4 space-y-4">
          {/* Existing secrets list */}
          {secrets.length === 0 ? (
            <p className="text-sm font-body text-muted-ol">No global secrets configured.</p>
          ) : (
            <div className="space-y-2">
              {secrets.map((s) => (
                <div
                  key={s.key}
                  className="flex items-center justify-between gap-3 rounded-md border border-border bg-bg-app/50 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm text-primary-ol">{s.key}</span>
                      <span className="font-mono text-xs text-muted-ol">{s.maskedValue}</span>
                    </div>
                    {s.description && (
                      <p className="text-xs font-body text-muted-ol mt-0.5 truncate">
                        {s.description}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-muted-ol hover:text-error shrink-0"
                    onClick={() => handleDeleteSecret(s.key)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Add secret form */}
          <form onSubmit={handleAddSecret} className="space-y-2 pt-2 border-t border-border">
            <div className="grid grid-cols-2 gap-2">
              <Input
                placeholder="KEY_NAME"
                value={secretKey}
                onChange={(e) => setSecretKey(e.target.value)}
                className="font-mono text-sm bg-bg-app border-border"
              />
              <Input
                type="password"
                placeholder="Secret value"
                value={secretValue}
                onChange={(e) => setSecretValue(e.target.value)}
                className="font-mono text-sm bg-bg-app border-border"
              />
            </div>
            <Input
              placeholder="Description (optional)"
              value={secretDesc}
              onChange={(e) => setSecretDesc(e.target.value)}
              className="text-sm bg-bg-app border-border"
            />
            <Button
              type="submit"
              disabled={secretSaving || !secretKey.trim() || !secretValue.trim()}
              size="sm"
              className="gap-1.5 bg-agent text-bg-app hover:bg-agent/90 font-body"
            >
              {secretSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add Secret
            </Button>
          </form>
        </div>
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

          {status?.github?.ok ? (
            <div className="flex items-center justify-between p-3 rounded-lg border border-success/20 bg-success/5">
              <div className="flex items-center gap-2 text-success">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm font-medium">Connected as {status.github.username}</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-xs text-error hover:text-error hover:bg-error/10"
                onClick={handleDisconnectGithub}
                disabled={githubDisconnecting}
              >
                {githubDisconnecting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  'Disconnect'
                )}
              </Button>
            </div>
          ) : deviceFlow ? (
            // Device Flow active - show code
            <div className="space-y-4">
              <div className="text-center space-y-3">
                <p className="text-sm font-body text-secondary-ol">Enter this code on GitHub:</p>
                <p className="font-mono text-2xl tracking-[0.3em] text-primary-ol font-bold">
                  {deviceFlow.userCode}
                </p>
              </div>
              <div className="flex items-center justify-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(deviceFlow.verificationUri, '_blank')}
                  className="gap-1.5 font-body"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open GitHub
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyCode}
                  className="gap-1.5 font-body"
                >
                  {copiedCode ? (
                    <Check className="h-3.5 w-3.5 text-success" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                  {copiedCode ? 'Copied' : 'Copy Code'}
                </Button>
              </div>
              <div className="flex items-center justify-center gap-2 text-muted-ol">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span className="text-xs font-body">Waiting for authorization...</span>
              </div>
              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleCancelDeviceFlow}
                  className="text-xs font-body text-muted-ol"
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            // Not connected - show OAuth button + PAT fallback
            <div className="space-y-3">
              <Button
                type="button"
                onClick={handleStartDeviceFlow}
                size="sm"
                className="w-full gap-1.5 bg-agent text-bg-app hover:bg-agent/90 font-body"
              >
                <Github className="h-3.5 w-3.5" />
                Connect with GitHub
              </Button>

              <div className="relative my-4">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-[hsl(var(--border))]" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-bg-subtle/30 px-2 text-muted-ol font-body">or</span>
                </div>
              </div>

              <p className="text-xs font-body text-muted-ol">Enter a Personal Access Token:</p>
              <form onSubmit={handleConnectGithub} className="space-y-3">
                <div className="space-y-2">
                  <Input
                    type="password"
                    placeholder="ghp_..."
                    value={githubToken}
                    onChange={(e) => setGithubToken(e.target.value)}
                    className="font-mono text-sm bg-bg-app border-border"
                  />
                  <a
                    href="https://github.com/settings/tokens"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-body text-agent hover:underline inline-flex items-center gap-1"
                  >
                    Generate a token →
                  </a>
                </div>
                <Button
                  type="submit"
                  disabled={githubConnecting || !githubToken.trim()}
                  size="sm"
                  variant="outline"
                  className="gap-1.5 font-body"
                >
                  {githubConnecting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Github className="h-3.5 w-3.5" />
                  )}
                  Connect
                </Button>
              </form>

              {githubError && <p className="text-xs font-body text-error">{githubError}</p>}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5 text-xs font-body text-muted-ol"
                onClick={refetch}
              >
                <RefreshCw className="h-3 w-3" />
                Refresh
              </Button>
            </div>
          )}
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
