import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ExternalLink, Loader2, AlertTriangle } from 'lucide-react';
import { startOAuthFlow } from '@/lib/api';
import { cn } from '@/lib/utils';

interface OAuthButtonProps {
  provider: 'openai' | 'openrouter';
  onSuccess: () => void;
  className?: string;
}

export function OAuthButton({ provider, onSuccess, className }: OAuthButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      // Ensure we only process messages from our own origin or expected popup
      if (e.data?.type === 'oauth-success' && e.data?.provider === provider) {
        setIsLoading(false);
        onSuccess();
      } else if (e.data?.type === 'oauth-error' && e.data?.provider === provider) {
        setIsLoading(false);
        setError(e.data.error || 'Authentication failed');
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [provider, onSuccess]);

  const handleOAuth = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const { url } = await startOAuthFlow(provider);

      // Open popup
      const width = 500;
      const height = 700;
      const left = window.screenX + (window.outerWidth - width) / 2;
      const top = window.screenY + (window.outerHeight - height) / 2;

      window.open(
        url,
        `${provider}-oauth`,
        `popup=yes,width=${width},height=${height},left=${left},top=${top}`,
      );

      // Note: We don't set isLoading(false) here because we're waiting for the postMessage
      // If the user closes the popup without completing, they can just click again
      // We could add a timer to check if the popup is closed, but keeping it simple for now
    } catch (err) {
      setIsLoading(false);
      setError(err instanceof Error ? err.message : 'Failed to start authentication');
    }
  };

  const providerName = provider === 'openai' ? 'OpenAI' : 'OpenRouter';

  return (
    <div className={cn('space-y-3', className)}>
      <Button
        onClick={handleOAuth}
        disabled={isLoading}
        className="w-full flex items-center justify-center gap-2"
        variant="outline"
      >
        {isLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <ExternalLink className="w-4 h-4" />
        )}
        Sign in with {providerName}
      </Button>

      {error && (
        <div className="text-error text-sm flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" />
          {error}
        </div>
      )}

      <p className="text-xs text-muted-ol text-center">
        ⚠ Using your subscription for personal development only.
      </p>
    </div>
  );
}
