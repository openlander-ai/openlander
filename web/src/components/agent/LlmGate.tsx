import { useNavigate } from 'react-router-dom';
import { Bot, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LlmGate() {
  const navigate = useNavigate();
  return (
    <div data-testid="llm-not-configured" className="flex items-center justify-center h-full">
      <div className="text-center max-w-sm space-y-4">
        <div className="mx-auto h-12 w-12 rounded-full bg-bg-subtle flex items-center justify-center">
          <Bot className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-medium text-foreground">AI Agent requires an API key</h3>
        <p className="text-sm text-muted-foreground">
          Configure an LLM provider in Settings to use Agent Mode.
        </p>
        <Button onClick={() => navigate('/settings')} className="gap-2">
          <Settings className="h-4 w-4" /> Configure in Settings
        </Button>
      </div>
    </div>
  );
}
