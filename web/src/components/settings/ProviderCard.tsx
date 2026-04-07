import { Loader2, Trash2, Zap } from 'lucide-react';
import type { ProviderInfo } from '@/lib/api/index.js';
import { Button } from '@/components/ui/button.js';
import { cn } from '@/lib/utils.js';
import { getProviderDef } from './ai-settings-constants.js';

interface TestResult {
  ok: boolean;
  latencyMs?: number;
  error?: string;
}

interface ProviderCardProps {
  provider: ProviderInfo;
  isTesting: boolean;
  isDeleting: boolean;
  testResult?: TestResult;
  onTest: () => void;
  onDelete: () => void;
  testLabel: string;
  testSuccessLabel: string;
  testFailLabel: string;
}

export function ProviderCard({
  provider,
  isTesting,
  isDeleting,
  testResult,
  onTest,
  onDelete,
  testLabel,
  testSuccessLabel,
  testFailLabel,
}: ProviderCardProps) {
  const pDef = getProviderDef(provider.provider);

  return (
    <div className="rounded-lg border border-border bg-bg-subtle/50 p-4 flex flex-col gap-3 transition-colors hover:bg-bg-subtle">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-2 px-2 py-1 rounded bg-bg-app border border-border text-xs font-medium text-primary-ol shrink-0">
            <span className={cn('h-2 w-2 rounded-full shrink-0', pDef?.color ?? 'bg-gray-400')} />
            {pDef?.label || provider.provider}
          </div>
          <div className="text-sm font-mono text-muted-ol truncate">{provider.defaultModel}</div>
          {provider.hasApiKey && (
            <div className="text-xs font-mono text-muted-ol bg-bg-app px-2 py-0.5 rounded border border-border truncate max-w-[120px]">
              {provider.apiKeyPreview}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={onTest}
            disabled={isTesting}
            className="h-8 text-xs gap-1.5"
          >
            {isTesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
            {testLabel}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onDelete}
            disabled={isDeleting}
            className="h-8 w-8 p-0 text-muted-ol hover:text-error"
          >
            {isDeleting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
      {testResult && (
        <div
          className={cn(
            'rounded-md px-3 py-2 text-xs font-body',
            testResult.ok ? 'bg-success/10 text-success' : 'bg-error/10 text-error',
          )}
        >
          {testResult.ok
            ? testSuccessLabel.replace('{ms}', testResult.latencyMs?.toString() || '0')
            : testResult.error || testFailLabel}
        </div>
      )}
    </div>
  );
}
