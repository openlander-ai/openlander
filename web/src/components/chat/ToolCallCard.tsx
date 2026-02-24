import { useState } from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, CheckCircle2, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { UIToolCall } from '@/hooks/use-chat';

interface ToolCallCardProps {
  toolCall: UIToolCall;
}

export function ToolCallCard({ toolCall }: ToolCallCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { toolName, arguments: args, status, result, error } = toolCall;

  return (
    <Card className="w-full my-2 border-l-4 border-l-primary/20">
      <CardHeader className="p-3 pb-2">
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono text-xs">
              {toolName}
            </Badge>
            {status === 'pending' && <Loader2 className="h-4 w-4 animate-spin text-yellow-500" />}
            {status === 'success' && <CheckCircle2 className="h-4 w-4 text-green-500" />}
            {status === 'error' && <XCircle className="h-4 w-4 text-red-500" />}
          </div>
          <div className="text-muted-foreground hover:text-foreground transition-colors">
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-3 pt-0">
        {!isExpanded && (
          <div
            className="text-xs font-mono text-muted-foreground truncate cursor-pointer"
            onClick={() => setIsExpanded(true)}
          >
            {JSON.stringify(args)}
          </div>
        )}

        {isExpanded && (
          <div className="space-y-3 mt-2">
            <div>
              <div className="text-xs font-semibold mb-1 text-muted-foreground">Arguments</div>
              <pre className="bg-muted/50 p-2 rounded-md text-xs overflow-x-auto font-mono">
                {JSON.stringify(args, null, 2)}
              </pre>
            </div>

            {status === 'success' && result != null && (
              <div>
                <div className="text-xs font-semibold mb-1 text-muted-foreground">Result</div>
                <pre className="bg-muted/50 p-2 rounded-md text-xs overflow-x-auto max-h-60 font-mono">
                  {typeof result === 'string' ? result : JSON.stringify(result, null, 2)}
                </pre>
              </div>
            )}

            {status === 'error' && error && (
              <div>
                <div className="text-xs font-semibold mb-1 text-red-500">Error</div>
                <pre className="bg-red-50 dark:bg-red-900/20 p-2 rounded-md text-xs text-red-600 dark:text-red-400 overflow-x-auto font-mono">
                  {error}
                </pre>
              </div>
            )}
          </div>
        )}

        {!isExpanded && status === 'success' && result != null && (
          <div className="text-xs text-muted-foreground mt-1 truncate">
            → {typeof result === 'string' ? result : JSON.stringify(result)}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
