import { ExternalLink, Info } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProviderHelpProps {
  provider: string;
  className?: string;
}

export function ProviderHelp({ provider, className }: ProviderHelpProps) {
  if (provider === 'anthropic') {
    return (
      <div className={cn('p-4 rounded-lg border border-agent/20 bg-agent/5 space-y-2', className)}>
        <div className="flex items-start gap-2 text-agent">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Using Claude Code?</p>
            <p className="text-xs text-muted-ol">
              Run{' '}
              <code className="px-1 py-0.5 rounded bg-bg-subtle font-mono text-primary-ol">
                claude setup-token
              </code>{' '}
              in your terminal to get a token, then paste it below.
            </p>
            <a
              href="https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs flex items-center gap-1 hover:underline mt-2"
            >
              Learn more about Anthropic API <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  if (provider === 'gemini') {
    return (
      <div className={cn('p-4 rounded-lg border border-agent/20 bg-agent/5 space-y-2', className)}>
        <div className="flex items-start gap-2 text-agent">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Need a Gemini API key?</p>
            <p className="text-xs text-muted-ol">
              Google provides a generous free tier for Gemini models.
            </p>
            <a
              href="https://aistudio.google.com/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs flex items-center gap-1 hover:underline mt-2"
            >
              Get a free API key from Google AI Studio <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
