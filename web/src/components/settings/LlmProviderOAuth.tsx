import { Button } from '@/components/ui/button';

interface LlmProviderOAuthProps {
  provider: 'google';
  label: string;
  description: string;
  onConnect: () => void;
  onDisconnect?: () => void;
  connected: boolean;
  loading?: boolean;
}

export function LlmProviderOAuth({
  label,
  description,
  onConnect,
  connected,
  loading,
}: LlmProviderOAuthProps) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border bg-bg-subtle/50 p-4">
      <div>
        <p className="text-sm font-medium text-primary-ol">{label}</p>
        <p className="text-xs text-muted-ol mt-1">{description}</p>
      </div>
      {connected ? (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-success">✓ Connected</span>
        </div>
      ) : (
        <Button
          onClick={onConnect}
          disabled={loading}
          size="sm"
          variant="outline"
          className="h-8 text-xs"
        >
          {loading ? 'Connecting...' : `Connect with ${label}`}
        </Button>
      )}
    </div>
  );
}
