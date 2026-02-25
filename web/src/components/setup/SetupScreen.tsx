import { useState, useCallback } from 'react';
import { useSetup } from '@/hooks/use-setup';
import { configureLLM, startTraefik, completeSetup } from '@/lib/api';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, XCircle, Loader2, Brain, Network, ArrowRight, Terminal, Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SetupScreen({ onComplete }: { onComplete: () => void }) {
  const { status, loading, refetch } = useSetup();
  const [configuringLLM, setConfiguringLLM] = useState(false);
  const [startingTraefik, setStartingTraefik] = useState(false);
  const [completing, setCompleting] = useState(false);

  // LLM Form State
  const [llmProvider, setLlmProvider] = useState('gemini');
  const [apiKey, setApiKey] = useState('');
  const [llmError, setLlmError] = useState('');

  if (loading || !status) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  const handleStartTraefik = async () => {
    setStartingTraefik(true);
    try {
      await startTraefik();
      await refetch();
    } catch (err) {
      console.error(err);
    } finally {
      setStartingTraefik(false);
    }
  };

  const handleConfigureLLM = async (e: React.FormEvent) => {
    e.preventDefault();
    setConfiguringLLM(true);
    setLlmError('');
    try {
      await configureLLM(llmProvider, apiKey);
      await refetch();
    } catch (err) {
      setLlmError('Failed to configure LLM. Check your API key.');
    } finally {
      setConfiguringLLM(false);
    }
  };

  const handleComplete = async () => {
    setCompleting(true);
    try {
      await completeSetup();
      onComplete();
    } catch (err) {
      console.error(err);
    } finally {
      setCompleting(false);
    }
  };

  const allReady = status.ready;

  return (
    <div className="flex items-center justify-center min-h-screen bg-background p-4">
      <Card className="w-full max-w-2xl border-border/50 shadow-2xl">
        <CardHeader className="text-center pb-8">
          <div className="mx-auto bg-primary/10 p-3 rounded-full w-fit mb-4">
            <Terminal className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">Welcome to OpenLander</CardTitle>
          <CardDescription className="text-lg mt-2">
            Let's get your deployment agent ready for takeoff.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Docker Status */}
          <div className="flex items-start gap-4 p-4 rounded-lg border bg-card/50">
            <div className="mt-1">
              {status.docker.ok ? (
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              ) : (
                <XCircle className="w-6 h-6 text-destructive" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">Docker Engine</h3>
                <Badge variant={status.docker.ok ? 'default' : 'destructive'}>
                  {status.docker.ok ? 'Running' : status.docker.state === 'not_installed' ? 'Not Installed' : status.docker.state === 'permission_denied' ? 'Permission Denied' : 'Stopped'}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                {status.docker.message}
              </p>
              {!status.docker.ok && (
                <div className="mt-3 space-y-3">
                  <DockerFixGuide state={status.docker.state} />
                  <Button onClick={refetch} variant="outline" size="sm">
                    Refresh Docker Status
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Traefik Status */}
          <div className="flex items-start gap-4 p-4 rounded-lg border bg-card/50">
            <div className="mt-1">
              {status.traefik.ok ? (
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              ) : (
                <Network className="w-6 h-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">Traefik Proxy</h3>
                <Badge variant={status.traefik.ok ? 'default' : 'secondary'}>
                  {status.traefik.ok ? 'Active' : 'Not Started'}
                </Badge>
              </div>
              <p className="text-muted-foreground text-sm">
                Handles routing and subdomains for your deployments.
              </p>
              {!status.traefik.ok && status.docker.ok && (
                <Button
                  onClick={handleStartTraefik}
                  disabled={startingTraefik}
                  className="mt-3"
                  size="sm"
                >
                  {startingTraefik && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Start Traefik Container
                </Button>
              )}
            </div>
          </div>

          {/* LLM Status */}
          <div className="flex items-start gap-4 p-4 rounded-lg border bg-card/50">
            <div className="mt-1">
              {status.llm.ok ? (
                <CheckCircle2 className="w-6 h-6 text-green-500" />
              ) : (
                <Brain className="w-6 h-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-lg">AI Model</h3>
                <Badge variant={status.llm.ok ? 'default' : 'secondary'}>
                  {status.llm.ok ? status.llm.provider : 'Not Configured'}
                </Badge>
              </div>

              {status.llm.ok ? (
                <p className="text-muted-foreground text-sm">
                  Connected to {status.llm.provider} ({status.llm.model}).
                </p>
              ) : (
                <div className="mt-3 space-y-4">
                  <p className="text-sm text-muted-foreground">
                    Select an AI provider to power the agent.
                  </p>
                  <form onSubmit={handleConfigureLLM} className="space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        value={llmProvider}
                        onChange={(e) => setLlmProvider(e.target.value)}
                      >
                        <option value="gemini">Google Gemini (Free)</option>
                        <option value="openrouter">OpenRouter (Free/Paid)</option>
                        <option value="anthropic">Anthropic Claude</option>
                        <option value="openai">OpenAI GPT-4</option>
                      </select>
                      <Input
                        type="password"
                        placeholder="API Key"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        required
                      />
                    </div>
                    {llmError && <p className="text-xs text-destructive">{llmError}</p>}
                    <Button type="submit" disabled={configuringLLM} size="sm">
                      {configuringLLM && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Configure Agent
                    </Button>
                  </form>
                </div>
              )}
            </div>
          </div>
        </CardContent>

        <CardFooter className="flex justify-end pt-6 border-t bg-muted/20">
          <Button
            size="lg"
            onClick={handleComplete}
            disabled={!allReady || completing}
            className={cn(
              'w-full md:w-auto transition-all',
              allReady ? 'opacity-100' : 'opacity-50',
            )}
          >
            {completing ? (
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
            ) : (
              <>
                Start Using OpenLander <ArrowRight className="w-5 h-5 ml-2" />
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}

/* Docker Install Guide ------------------------------------------------- */

const DOCKER_LINUX_CMD = 'curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER';
const DOCKER_MAC_CMD = 'brew install --cask docker';
const DOCKER_START_LINUX = 'sudo systemctl start docker';
const DOCKER_START_MAC = 'open -a Docker';
const DOCKER_PERM_CMD = 'sudo usermod -aG docker $USER && newgrp docker';
const DOCKER_AGENT_PROMPT = 'Install Docker on this machine and start the daemon';

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      // Modern clipboard API (requires secure context)
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback: textarea + execCommand
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: prompt user to copy manually
      window.prompt('Copy this command:', text);
    }
  }, [text]);
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded bg-muted hover:bg-muted/80 transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function DockerFixGuide({ state }: { state?: string }) {
  if (state === 'permission_denied') {
    return (
      <div className="space-y-3 text-sm">
        <div className="rounded-md border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">Fix: Add your user to the docker group</span>
            <CopyButton text={DOCKER_PERM_CMD} />
          </div>
          <code className="block text-xs bg-background rounded p-2 font-mono break-all">
            {DOCKER_PERM_CMD}
          </code>
          <p className="text-xs text-muted-foreground mt-1">
            Then log out and back in (or restart your terminal) for the group change to take effect.
          </p>
        </div>
        <AgentHint prompt="Add the current user to the docker group and restart the Docker daemon" />
      </div>
    );
  }

  if (state === 'not_running') {
    return (
      <div className="space-y-3 text-sm">
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">Linux / WSL2</span>
            <CopyButton text={DOCKER_START_LINUX} />
          </div>
          <code className="block text-xs bg-background rounded p-2 font-mono">
            {DOCKER_START_LINUX}
          </code>
        </div>
        <div className="rounded-md border bg-muted/30 p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="font-medium">macOS</span>
            <CopyButton text={DOCKER_START_MAC} />
          </div>
          <code className="block text-xs bg-background rounded p-2 font-mono">
            {DOCKER_START_MAC}
          </code>
        </div>
        <AgentHint prompt="Start the Docker daemon on this machine" />
      </div>
    );
  }

  // not_installed (default)
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium">Linux / WSL2</span>
          <CopyButton text={DOCKER_LINUX_CMD} />
        </div>
        <code className="block text-xs bg-background rounded p-2 font-mono break-all">
          {DOCKER_LINUX_CMD}
        </code>
        <p className="text-xs text-muted-foreground mt-1">
          After install, log out and back in (or run <code className="bg-muted px-1 rounded">newgrp docker</code>).
        </p>
      </div>
      <div className="rounded-md border bg-muted/30 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-medium">macOS</span>
          <CopyButton text={DOCKER_MAC_CMD} />
        </div>
        <code className="block text-xs bg-background rounded p-2 font-mono">
          {DOCKER_MAC_CMD}
        </code>
        <p className="text-xs text-muted-foreground mt-1">
          Or download{' '}
          <a href="https://www.docker.com/products/docker-desktop/" target="_blank" rel="noopener" className="underline hover:text-foreground">
            Docker Desktop
          </a>.
        </p>
      </div>
      <AgentHint prompt={DOCKER_AGENT_PROMPT} />
    </div>
  );
}

function AgentHint({ prompt }: { prompt: string }) {
  return (
    <div className="rounded-md border border-dashed bg-primary/5 p-3">
      <p className="text-xs text-muted-foreground">
        <strong>Using an AI coding tool?</strong> Paste this into your agent:
      </p>
      <div className="flex items-center justify-between mt-1">
        <code className="text-xs font-mono">{prompt}</code>
        <CopyButton text={prompt} />
      </div>
    </div>
  );
}
